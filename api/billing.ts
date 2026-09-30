/**
 * /api/billing/* — one Vercel function for all billing routes (keeps the
 * function count flat). Routed by the `route` query param set by the vercel.json
 * rewrite (or by the URL path in the local dev server).
 *
 *   GET  /api/billing/packages   public: purchasable packages (no prices — Paddle shows those)
 *   POST /api/billing/checkout   signed-in: create the Paddle transaction server-side
 *   POST /api/billing/webhook    Paddle only: signature-verified events
 *   GET  /api/billing/status     signed-in: one of MY checkouts (after Paddle.js reports success)
 *   GET  /api/billing/me         signed-in: my balance and per-purchase consumed / unused
 *   POST /api/billing/refund-request  signed-in: ask for a refund of MY purchase → an admin case (never a Paddle refund)
 *   GET  /api/billing/reconcile  Vercel Cron only (Authorization: Bearer CRON_SECRET)
 *   *    /api/billing/admin/*    developers only (see billing/admin.ts)
 *
 * The browser never tells the server a price, a credit amount, a user id or a
 * payment outcome. Credits change only after a verified Paddle event.
 */
import { timingSafeEqual } from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifiedUserId } from './ai/auth_session';
import { getCreditBalance, lotSummary, type BillingSql } from './ai/credits';
import { billingSql } from './ai/metering';
import { creditCatalog, packageById } from './billing/catalog';
import {
  paddleApi, paddleConfig, verifyPaddleSignature, PaddleConfigError,
  type PaddleApi, type PaddleConfig, type PaddleEvent,
} from './billing/paddle';
import { handleAdmin, isAdmin } from './billing/admin';
import { processPaddleEvent, raiseAlert } from './billing/process_event';
import { reconcile } from './billing/reconcile';
import { IMMEDIATE_SERVICE_CONSENT_VERSION, LEGAL_VERSIONS, type AcceptedTerms } from '../shared/billing/legal_versions';

export interface BillingDeps {
  sql?: () => BillingSql | null;
  verifyUser?: (req: VercelRequest, res: VercelResponse) => Promise<string | null>;
  config?: () => PaddleConfig;
  api?: (config: PaddleConfig) => PaddleApi;
  env?: NodeJS.ProcessEnv;
}

type Json = Record<string, unknown>;
const REFUND_REASON_MAX = 2000;
const REFUND_REQUESTS_PER_PAYMENT = 5;
const fail = (res: VercelResponse, status: number, code: string, extra: Json = {}) => res.status(status).json({ ok: false, code, ...extra });

/** The exact bytes Paddle signed. @vercel/node buffers the body and replays the stream. */
export function readRawBody(req: VercelRequest): Promise<string> {
  const pre = (req as unknown as { rawBody?: string }).rawBody;
  if (typeof pre === 'string') return Promise.resolve(pre);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer | string) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function routeOf(req: VercelRequest): string {
  const q = req.query?.route;
  if (typeof q === 'string' && q) return q;
  if (Array.isArray(q) && q.length) return q.join('/');
  const path = (req.url ?? '').split('?')[0];
  return path.replace(/^\/api\/billing\/?/, '');
}

export function createBillingHandler(deps: BillingDeps = {}) {
  const getSql = deps.sql ?? billingSql;
  const verifyUser = deps.verifyUser ?? ((req: VercelRequest, res: VercelResponse) => verifiedUserId(req, res));
  const getConfig = deps.config ?? (() => paddleConfig(deps.env));
  const getApi = deps.api ?? ((config: PaddleConfig) => paddleApi(config));

  async function webhook(req: VercelRequest, res: VercelResponse) {
    let config: PaddleConfig;
    try { config = getConfig(); } catch { return fail(res, 503, 'BILLING_NOT_CONFIGURED'); }
    const raw = await readRawBody(req);
    const header = req.headers['paddle-signature'];
    if (!verifyPaddleSignature(raw, Array.isArray(header) ? header[0] : header, config.webhookSecret)) {
      console.warn('[billing] webhook signature rejected');
      // Visible in the admin console (one alert per hour): a rotated/mismatched secret rejects every real event.
      const sql = getSql();
      if (sql) {
        await raiseAlert(sql, { severity: 'critical', code: 'webhook_failing', dedupeKey: `webhook_signature:${new Date().toISOString().slice(0, 13)}`,
          details: { reason: 'signature rejected' } }).catch(() => {});
      }
      return fail(res, 401, 'INVALID_SIGNATURE');
    }
    let event: PaddleEvent;
    try { event = JSON.parse(raw); } catch { return fail(res, 400, 'INVALID_JSON'); }
    if (typeof event?.event_id !== 'string' || typeof event.event_type !== 'string'
      || typeof event.occurred_at !== 'string' || typeof event.data !== 'object' || !event.data) {
      return fail(res, 400, 'INVALID_EVENT');
    }
    const sql = getSql();
    if (!sql) return fail(res, 503, 'DATABASE_UNAVAILABLE');
    try {
      const status = await processPaddleEvent({ sql, environment: config.environment, source: 'webhook', env: deps.env }, event);
      return res.status(200).json({ ok: true, status });
    } catch (error) {
      // Not durably processed → non-2xx so Paddle retries (at-least-once delivery).
      console.error('[billing] webhook processing failed:', (error as Error)?.message);
      return fail(res, 500, 'PROCESSING_FAILED');
    }
  }

  async function checkout(req: VercelRequest, res: VercelResponse, userId: string, sql: BillingSql) {
    if (!String(req.headers['content-type'] ?? '').includes('application/json')) return fail(res, 415, 'JSON_REQUIRED');
    let config: PaddleConfig;
    try { config = getConfig(); } catch { return fail(res, 503, 'BILLING_NOT_CONFIGURED'); }
    const body = (req.body ?? {}) as Json;
    const pkg = packageById(body.package_id, deps.env);
    if (!pkg) return fail(res, 400, 'UNKNOWN_PACKAGE');
    if (body.disclosure_version !== LEGAL_VERSIONS.purchaseDisclosure || body.accepted !== true) {
      return fail(res, 400, 'DISCLOSURE_REQUIRED', { disclosure_version: LEGAL_VERSIONS.purchaseDisclosure });
    }
    if (IMMEDIATE_SERVICE_CONSENT_VERSION && body.immediate_service_consent !== true) return fail(res, 400, 'CONSENT_REQUIRED');
    const profile = (await sql.unsafe('SELECT payment_risk_state FROM public.profiles WHERE id = $1', [userId]))[0];
    if (profile?.payment_risk_state === 'payment_risk_restricted') return fail(res, 403, 'PURCHASE_RESTRICTED');

    const terms: AcceptedTerms = {
      supplier_terms: LEGAL_VERSIONS.supplierTerms,
      refund_policy: LEGAL_VERSIONS.refundPolicy,
      privacy_policy: LEGAL_VERSIONS.privacyPolicy,
      purchase_disclosure: LEGAL_VERSIONS.purchaseDisclosure,
      immediate_service_consent: IMMEDIATE_SERVICE_CONSENT_VERSION && body.immediate_service_consent === true ? IMMEDIATE_SERVICE_CONSENT_VERSION : null,
      accepted_at: new Date().toISOString(),
    };
    const [payment] = await sql.unsafe(
      `INSERT INTO public.payments (environment, user_id, package_id, package_version, credits_purchased, paddle_price_id, terms)
       VALUES ($1, $2, $3, $4, $5, $6, $7::text::jsonb) RETURNING id`,
      [config.environment, userId, pkg.id, pkg.version, pkg.credits, pkg.paddlePriceId, JSON.stringify(terms)]);
    try {
      // custom_data is set server-side on a server-created transaction: the buyer cannot redirect the grant.
      const txn = await getApi(config).createTransaction({
        priceId: pkg.paddlePriceId,
        customData: { syllo_user_id: userId, syllo_payment_id: String(payment.id) },
      });
      await sql.unsafe('UPDATE public.payments SET paddle_transaction_id = $2, updated_at = now() WHERE id = $1', [payment.id, txn.id]);
      return res.status(200).json({ ok: true, transaction_id: txn.id, payment_id: String(payment.id) });
    } catch (error) {
      console.error('[billing] create transaction failed:', (error as Error)?.message);
      await sql.unsafe(`UPDATE public.payments SET checkout_state = 'canceled', updated_at = now() WHERE id = $1`, [payment.id]);
      return fail(res, 502, 'CHECKOUT_UNAVAILABLE');
    }
  }

  async function status(req: VercelRequest, res: VercelResponse, userId: string, sql: BillingSql) {
    const txnId = String(req.query?.transaction_id ?? '');
    const [row] = await sql.unsafe(
      `SELECT status, credits_purchased, lot_id IS NOT NULL AS credited FROM public.payments
        WHERE user_id = $1 AND paddle_transaction_id = $2`, [userId, txnId]);
    if (!row) return fail(res, 404, 'NOT_FOUND');
    return res.status(200).json({
      ok: true, status: row.status, credited: Boolean(row.credited), credits: Number(row.credits_purchased),
      balance: await getCreditBalance(sql, userId),
    });
  }

  async function me(res: VercelResponse, userId: string, sql: BillingSql) {
    const lots = await lotSummary(sql, userId);
    const payments = await sql.unsafe(
      `SELECT p.id, p.package_id, p.credits_purchased, p.status, p.currency, p.amount_total, p.refunded_amount, p.completed_at, p.lot_id,
              a.case_status AS refund_case_status, a.created_at AS refund_requested_at
         FROM public.payments p
         LEFT JOIN public.billing_alerts a ON a.dedupe_key = 'refund_request:' || p.id
        WHERE p.user_id = $1 AND p.checkout_state = 'completed' ORDER BY p.completed_at DESC`, [userId]);
    const byLot = new Map(lots.map((l) => [l.lotId, l]));
    return res.status(200).json({
      ok: true,
      balance: await getCreditBalance(sql, userId),
      purchases: payments.map((p) => {
        const lot = p.lot_id == null ? undefined : byLot.get(String(p.lot_id));
        return {
          payment_id: String(p.id), package_id: p.package_id, status: p.status, completed_at: p.completed_at,
          currency: p.currency, amount_total: p.amount_total == null ? null : Number(p.amount_total),
          refunded_amount: Number(p.refunded_amount),
          credits: { purchased: Number(p.credits_purchased), consumed: lot?.consumed ?? 0, in_use: lot?.reserved ?? 0,
            unused: lot?.unused ?? 0, revoked: lot?.revoked ?? 0 },
          refund_request: p.refund_case_status == null ? null : { case_status: p.refund_case_status, requested_at: p.refund_requested_at },
        };
      }),
    });
  }

  /**
   * A customer asks for a refund of one of THEIR completed purchases. This only
   * opens (or re-opens) the admin case for that payment — the money is decided and
   * refunded by staff in Paddle, and credits follow Paddle's adjustment webhook.
   */
  async function refundRequest(req: VercelRequest, res: VercelResponse, userId: string, sql: BillingSql) {
    if (!String(req.headers['content-type'] ?? '').includes('application/json')) return fail(res, 415, 'JSON_REQUIRED');
    const body = (req.body ?? {}) as Json;
    const paymentId = String(body.payment_id ?? '');
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!/^\d{1,18}$/.test(paymentId)) return fail(res, 400, 'INVALID_PAYMENT');
    if (reason.length < 3 || reason.length > REFUND_REASON_MAX) return fail(res, 400, 'REASON_REQUIRED', { max: REFUND_REASON_MAX });
    // Own, completed payments only; anything else is indistinguishable from "not found".
    const [pay] = await sql.unsafe(
      `SELECT id, status, lot_id FROM public.payments WHERE id = $1 AND user_id = $2 AND checkout_state = 'completed'`, [paymentId, userId]);
    if (!pay) return fail(res, 404, 'NOT_FOUND');
    if (pay.status === 'refunded' || pay.status === 'chargeback') return fail(res, 409, 'ALREADY_REFUNDED');
    const lot = pay.lot_id == null ? undefined : (await lotSummary(sql, userId)).find((l) => l.lotId === String(pay.lot_id));
    const [profile] = await sql.unsafe('SELECT email FROM public.profiles WHERE id = $1', [userId]);
    const requestedAt = new Date().toISOString();
    const details = { source: 'customer', requested_at: requestedAt, payment_status: pay.status,
      // What was used when the customer asked — the live figures keep moving.
      credits_at_request: lot ? { consumed: lot.consumed, in_use: lot.reserved, unused: lot.unused, revoked: lot.revoked } : null };
    const note = JSON.stringify([{ at: requestedAt, by: 'customer', text: reason }]);
    // One case per payment. A repeat request updates it (and re-opens a resolved
    // one); capped so a single customer cannot grow a case without bound.
    const [row] = await sql.unsafe(
      `INSERT INTO public.billing_alerts (severity, code, dedupe_key, payment_id, user_id, details, reason, customer_email, notes)
       VALUES ('review', 'refund_request', $1, $2, $3, jsonb_set($4::text::jsonb, '{request_count}', '1'), $5, $6, $7::text::jsonb)
       ON CONFLICT (dedupe_key) DO UPDATE SET
         details = EXCLUDED.details || jsonb_build_object('request_count', COALESCE((billing_alerts.details->>'request_count')::int, 1) + 1),
         reason = EXCLUDED.reason,
         customer_email = COALESCE(EXCLUDED.customer_email, billing_alerts.customer_email),
         -- Re-opening keeps the earlier resolution in the case history.
         notes = billing_alerts.notes
           || CASE WHEN billing_alerts.status = 'resolved' THEN jsonb_build_array(jsonb_build_object('at', billing_alerts.resolved_at,
                'by', billing_alerts.resolved_by::text, 'text', 'resolved: ' || COALESCE(billing_alerts.resolution_note, ''))) ELSE '[]'::jsonb END
           || EXCLUDED.notes,
         case_status = CASE WHEN billing_alerts.status = 'resolved' THEN 'open' ELSE billing_alerts.case_status END,
         status = 'open', resolved_at = NULL, resolved_by = NULL, resolution_note = NULL
       WHERE COALESCE((billing_alerts.details->>'request_count')::int, 1) < $8
       RETURNING id, case_status`,
      [`refund_request:${pay.id}`, pay.id, userId, JSON.stringify(details), reason, profile?.email ?? null, note, REFUND_REQUESTS_PER_PAYMENT]);
    if (!row) return fail(res, 429, 'TOO_MANY_REQUESTS');
    return res.status(200).json({ ok: true, case_id: String(row.id), case_status: row.case_status });
  }

  /** Vercel Cron → scheduled reconciliation. No public trigger: the secret is required. */
  async function cron(req: VercelRequest, res: VercelResponse) {
    const secret = (deps.env ?? process.env).CRON_SECRET ?? '';
    const given = Buffer.from(String(req.headers.authorization ?? ''));
    const expected = Buffer.from(`Bearer ${secret}`);
    if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) return fail(res, 401, 'UNAUTHORIZED');
    let config: PaddleConfig;
    try { config = getConfig(); } catch { return fail(res, 503, 'BILLING_NOT_CONFIGURED'); }
    const sql = getSql();
    if (!sql) return fail(res, 503, 'DATABASE_UNAVAILABLE');
    const report = await reconcile({ sql, environment: config.environment, api: getApi(config), trigger: 'cron', env: deps.env });
    return res.status(200).json({ ok: true, run_id: report.runId, status: report.status, findings: report.findings.length });
  }

  async function admin(route: string, req: VercelRequest, res: VercelResponse) {
    const userId = await verifyUser(req, res);
    if (!userId) return fail(res, 401, 'SIGN_IN_REQUIRED');
    const sql = getSql();
    if (!sql) return fail(res, 503, 'DATABASE_UNAVAILABLE');
    if (!(await isAdmin(sql, userId))) return fail(res, 403, 'FORBIDDEN');
    let config: PaddleConfig | null = null;
    try { config = getConfig(); } catch { /* the console still works without Paddle; reconciliation does not */ }
    return handleAdmin(route, req, res, {
      sql, actorId: userId, environment: config?.environment ?? null,
      api: config ? () => getApi(config!) : null, env: deps.env,
    });
  }

  return async function billingHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    const route = routeOf(req);
    try {
      if (route === 'webhook' && req.method === 'POST') { await webhook(req, res); return; }
      if (route === 'packages' && req.method === 'GET') {
        let environment: string | null = null;
        try { environment = getConfig().environment; } catch { /* not configured: empty list */ }
        const packages = environment ? creditCatalog(deps.env).filter((p) => p.active) : [];
        res.status(200).json({ ok: true, environment, packages: packages.map((p) => ({ id: p.id, name_he: p.nameHe, credits: p.credits, paddle_price_id: p.paddlePriceId })) });
        return;
      }
      if (route === 'reconcile' && req.method === 'GET') { await cron(req, res); return; }
      if (route.startsWith('admin/')) { await admin(route.slice('admin/'.length), req, res); return; }
      const routes: Record<string, string> = { checkout: 'POST', status: 'GET', me: 'GET', 'refund-request': 'POST' };
      if (routes[route] !== req.method) { fail(res, 404, 'NOT_FOUND'); return; }
      const userId = await verifyUser(req, res);
      if (!userId) { fail(res, 401, 'SIGN_IN_REQUIRED'); return; }
      const sql = getSql();
      if (!sql) { fail(res, 503, 'DATABASE_UNAVAILABLE'); return; }
      if (route === 'checkout') await checkout(req, res, userId, sql);
      else if (route === 'status') await status(req, res, userId, sql);
      else if (route === 'refund-request') await refundRequest(req, res, userId, sql);
      else await me(res, userId, sql);
    } catch (error) {
      if (error instanceof PaddleConfigError) { fail(res, 503, 'BILLING_NOT_CONFIGURED'); return; }
      console.error('[billing] unexpected error:', (error as Error)?.message);
      if (!res.headersSent) fail(res, 500, 'INTERNAL_ERROR');
    }
  };
}

export default createBillingHandler();
