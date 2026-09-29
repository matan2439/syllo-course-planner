/**
 * admin.ts — the internal billing console API (/api/billing/admin/*).
 *
 * Authorization is server-side: a verified Supabase user whose profiles.role is
 * 'developer'. Every mutation requires a reason and is written to
 * billing_admin_actions. Balance changes go through apply_credit_transaction as
 * a new 'admin_adjustment' ledger row — history is never edited.
 */
import { randomUUID } from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { BillingSql } from '../ai/credits';
import { buildEvidence, evidenceText, type EvidencePackage } from './evidence';
import type { PaddleApi, PaddleEnvironment } from './paddle';
import { reconcile } from './reconcile';

export interface AdminContext {
  sql: BillingSql;
  actorId: string;
  environment: PaddleEnvironment | null;
  api: (() => PaddleApi) | null;
  env?: NodeJS.ProcessEnv;
}

const q = async (sql: BillingSql, text: string, params: unknown[] = []) => (await sql.unsafe(text, params)) as Array<Record<string, any>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (res: VercelResponse, status: number, code: string) => res.status(status).json({ ok: false, code });
const reasonOf = (body: Record<string, unknown>) => (typeof body.reason === 'string' && body.reason.trim().length >= 3 ? body.reason.trim() : null);

export async function isAdmin(sql: BillingSql, userId: string): Promise<boolean> {
  const [row] = await q(sql, 'SELECT role FROM public.profiles WHERE id = $1', [userId]);
  return row?.role === 'developer';
}

async function audit(sql: BillingSql, ctx: AdminContext, action: string, target: string, reason: string, details: unknown = {}) {
  await q(sql, 
    'INSERT INTO public.billing_admin_actions (actor_id, action, target, reason, details) VALUES ($1, $2, $3, $4, $5::jsonb)',
    [ctx.actorId, action, target, reason, JSON.stringify(details)]);
}

export async function overview(sql: BillingSql) {
  const [counts] = await q(sql, `
    SELECT COUNT(*) FILTER (WHERE checkout_state = 'completed')::int                 AS purchases,
           COUNT(*) FILTER (WHERE status = 'refunded')::int                          AS refunds,
           COUNT(*) FILTER (WHERE status = 'partially_refunded')::int                AS partial_refunds,
           COUNT(*) FILTER (WHERE dispute_state IN ('warning', 'chargeback'))::int   AS disputes,
           COUNT(*) FILTER (WHERE consumed_before_refund)::int                        AS refunds_after_consumption,
           COALESCE(SUM(credits_purchased) FILTER (WHERE checkout_state = 'completed'), 0)::int AS credits_sold
      FROM public.payments`);
  const money = await q(sql, `
    SELECT currency, COALESCE(SUM(amount_total), 0)::bigint AS gross, COALESCE(SUM(refunded_amount), 0)::bigint AS refunded
      FROM public.payments WHERE checkout_state = 'completed' GROUP BY currency ORDER BY currency`);
  const [lots] = await q(sql, `
    SELECT COALESCE(SUM(credits_consumed), 0)::int AS consumed,
           COALESCE(SUM(credits_granted - credits_consumed - credits_reserved - credits_revoked), 0)::int AS unused,
           COALESCE(SUM(credits_revoked), 0)::int AS revoked
      FROM public.credit_lots WHERE source_class = 'purchased'`);
  const alerts = await q(sql, `SELECT severity, COUNT(*)::int AS n FROM public.billing_alerts WHERE status = 'open' GROUP BY severity`);
  const [violations] = await q(sql, 'SELECT COUNT(*)::int AS n FROM public.billing_invariant_violations');
  const [lastRun] = await q(sql, 'SELECT id, trigger, started_at, finished_at, status, checked, repaired, escalated FROM public.billing_reconciliation_runs ORDER BY id DESC LIMIT 1');
  const open = Object.fromEntries(alerts.map((a) => [a.severity, Number(a.n)]));
  const critical = (open.critical ?? 0) + Number(violations.n);
  return {
    // NORMAL / REVIEW REQUIRED / CRITICAL INTEGRATION ERROR
    health: critical > 0 ? 'critical' : (open.review ?? 0) > 0 ? 'review' : 'normal',
    payments: counts,
    // Paddle's own totals (grand_total incl. tax, before Paddle fees) — no derived tax/net figures.
    money_by_currency: money.map((m) => ({ currency: m.currency, gross: Number(m.gross), refunded: Number(m.refunded) })),
    purchased_credits: lots,
    open_alerts: { review: open.review ?? 0, critical: open.critical ?? 0 },
    invariant_violations: Number(violations.n),
    last_reconciliation: lastRun ?? null,
  };
}

/** One ordered story per purchase: checkout → grant → usage → refunds/disputes → state. */
export function timeline(e: EvidencePackage, createdAt: string) {
  const items: Array<{ at: string; kind: string; label: string }> = [{ at: createdAt, kind: 'checkout', label: 'checkout created' }];
  for (const ev of e.paddle_events) items.push({ at: ev.occurred_at, kind: 'paddle_event', label: `${ev.event_type} (${ev.processing_status})` });
  if (e.purchase.purchased_at) items.push({ at: e.purchase.purchased_at, kind: 'grant', label: `${e.credits.purchased} credits granted` });
  for (const op of e.service_delivery.operations) {
    if (op.delivered_at) items.push({ at: op.delivered_at, kind: 'usage', label: `${op.credits_from_this_purchase} credit(s) consumed · ${op.endpoint}` });
  }
  for (const a of e.adjustments) items.push({ at: a.occurred_at, kind: 'adjustment', label: `${a.action}/${a.type ?? '-'} ${a.status} · ${a.credits_revoked} credits revoked` });
  for (const d of e.policy_decisions) items.push({ at: d.created_at, kind: 'decision', label: `${d.decision} [${d.policy_version}]` });
  items.sort((a, b) => a.at.localeCompare(b.at));
  items.push({ at: e.generated_at, kind: 'state', label: `now: ${e.purchase.status}, ${e.credits.unused} unused / ${e.credits.consumed} consumed` });
  return items;
}

export async function handleAdmin(route: string, req: VercelRequest, res: VercelResponse, ctx: AdminContext): Promise<void> {
  const { sql } = ctx;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const id = String(req.query?.id ?? body.id ?? '');

  if (req.method === 'GET' && route === 'overview') { res.status(200).json({ ok: true, ...(await overview(sql)) }); return; }

  if (req.method === 'GET' && route === 'payments') {
    const status = typeof req.query?.status === 'string' ? req.query.status : null;
    const rows = await q(sql, 
      `SELECT p.id, p.environment, p.user_id, p.package_id, p.paddle_transaction_id, p.status, p.currency, p.amount_total, p.refunded_amount,
              p.credits_purchased, p.created_at, p.completed_at, l.credits_consumed, l.credits_revoked,
              EXISTS (SELECT 1 FROM public.billing_alerts a WHERE a.payment_id = p.id AND a.status = 'open' AND a.severity = 'review') AS manual_review_required
         FROM public.payments p LEFT JOIN public.credit_lots l ON l.id = p.lot_id
        WHERE ($1::text IS NULL OR p.status = $1) ORDER BY p.id DESC LIMIT 200`, [status]);
    res.status(200).json({ ok: true, payments: rows });
    return;
  }

  if (req.method === 'GET' && (route === 'payment' || route === 'evidence')) {
    const evidence = await buildEvidence(sql, id);
    if (!evidence) { fail(res, 404, 'NOT_FOUND'); return; }
    if (route === 'evidence') {
      const text = req.query?.format === 'text';
      res.setHeader('Content-Disposition', `attachment; filename="syllo-evidence-${id}.${text ? 'txt' : 'json'}"`);
      if (text) { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.status(200).send(evidenceText(evidence)); }
      else res.status(200).json(evidence);
      return;
    }
    const [pay] = await q(sql, 'SELECT created_at FROM public.payments WHERE id = $1', [id]);
    const alerts = await q(sql, 'SELECT * FROM public.billing_alerts WHERE payment_id = $1 ORDER BY id', [id]);
    const [risk] = evidence.purchase.syllo_user_id
      ? await q(sql, 
        `SELECT pr.payment_risk_state, ri.* FROM public.profiles pr LEFT JOIN public.account_risk_indicators ri ON ri.user_id = pr.id WHERE pr.id = $1`,
        [evidence.purchase.syllo_user_id])
      : [];
    res.status(200).json({ ok: true, evidence, timeline: timeline(evidence, new Date(pay.created_at).toISOString()), alerts, risk: risk ?? null });
    return;
  }

  if (req.method === 'GET' && route === 'alerts') {
    const rows = await q(sql, 
      `SELECT * FROM public.billing_alerts WHERE status = $1 ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END, id DESC LIMIT 200`,
      [req.query?.status === 'resolved' ? 'resolved' : 'open']);
    res.status(200).json({ ok: true, alerts: rows });
    return;
  }

  if (req.method !== 'POST') { fail(res, 404, 'NOT_FOUND'); return; }
  const reason = reasonOf(body);
  if (!reason) { fail(res, 400, 'REASON_REQUIRED'); return; }

  if (route === 'alerts/resolve') {
    const [row] = await q(sql, 
      `UPDATE public.billing_alerts SET status = 'resolved', resolved_by = $2, resolution_note = $3, resolved_at = now()
        WHERE id = $1 AND status = 'open' RETURNING id`, [id, ctx.actorId, reason]);
    if (!row) { fail(res, 404, 'NOT_FOUND'); return; }
    await audit(sql, ctx, 'resolve_alert', `alert:${id}`, reason);
    res.status(200).json({ ok: true });
    return;
  }

  if (route === 'risk-state') {
    const state = body.state;
    if (!UUID.test(String(body.user_id)) || !['normal', 'review_required', 'payment_risk_restricted'].includes(String(state))) { fail(res, 400, 'INVALID_REQUEST'); return; }
    const [row] = await q(sql, 'SELECT payment_risk_state FROM public.profiles WHERE id = $1', [body.user_id]);
    if (!row) { fail(res, 404, 'NOT_FOUND'); return; }
    await q(sql, 'UPDATE public.profiles SET payment_risk_state = $2 WHERE id = $1', [body.user_id, state]);
    await audit(sql, ctx, 'set_risk_state', `user:${body.user_id}`, reason, { from: row.payment_risk_state, to: state });
    res.status(200).json({ ok: true });
    return;
  }

  if (route === 'adjust') {
    const delta = Number(body.delta);
    if (!UUID.test(String(body.user_id)) || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100_000) { fail(res, 400, 'INVALID_REQUEST'); return; }
    const reference = `admin:${randomUUID()}`;
    const [r] = await q(sql, 'SELECT status, balance FROM public.apply_credit_transaction($1, $2, $3, $4, $5::jsonb)',
      [body.user_id, delta, 'admin_adjustment', reference, JSON.stringify({ reason, actor_id: ctx.actorId })]);
    if (r.status !== 'applied') { fail(res, 409, r.status === 'insufficient' ? 'INSUFFICIENT_CREDITS' : 'NOT_APPLIED'); return; }
    await audit(sql, ctx, 'credit_adjustment', `user:${body.user_id}`, reason, { delta, reference });
    res.status(200).json({ ok: true, balance: Number(r.balance) });
    return;
  }

  if (route === 'reconcile') {
    if (!ctx.environment || !ctx.api) { fail(res, 503, 'BILLING_NOT_CONFIGURED'); return; }
    await audit(sql, ctx, 'run_reconciliation', 'billing', reason);
    const report = await reconcile({ sql, environment: ctx.environment, api: ctx.api(), trigger: 'admin', actorId: ctx.actorId, env: ctx.env });
    res.status(200).json({ ok: true, ...report });
    return;
  }

  fail(res, 404, 'NOT_FOUND');
}
