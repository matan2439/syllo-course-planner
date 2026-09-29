/**
 * process_event.ts — the single processor for trusted Paddle events.
 *
 * Called by the webhook (after signature verification) and by reconciliation
 * (with events rebuilt from Paddle's API). Guarantees:
 *
 *   - event-level idempotency: paddle_events.event_id is the primary key and a
 *     finished event is never processed twice;
 *   - grant-level idempotency: the purchase grant's ledger reference is
 *     `paddle:<env>:<transaction id>` (UNIQUE(kind, reference)), so a webhook racing
 *     reconciliation, or two deliveries of different events for one transaction,
 *     still grant exactly once;
 *   - durability: the event row is committed BEFORE processing; a processing
 *     failure is recorded as 'failed' and re-thrown so Paddle retries;
 *   - atomicity: each event is processed in ONE transaction holding the user's
 *     credit_accounts row lock (the same lock AI metering takes), so a refund, a
 *     chargeback and an AI call can never interleave inconsistently;
 *   - out-of-order safety: payment status is derived (see 003_payments.sql),
 *     'completed' never regresses, adjustment statuses only move forward, and an
 *     adjustment that arrives before its purchase waits and is applied the moment
 *     the purchase is granted.
 */
import type { BillingSql, CreditsSql } from '../ai/credits';
import { packageByPriceId } from './catalog';
import { minimizeEntity, type PaddleEnvironment, type PaddleEvent } from './paddle';
import { POLICY_VERSION, decideAdjustment, type AdjustmentFacts } from './refund_policy';

export type { BillingSql };

export interface ProcessContext {
  sql: BillingSql;
  environment: PaddleEnvironment;
  source: 'webhook' | 'reconciliation';
  /** Env for the package catalog (price ids). */
  env?: NodeJS.ProcessEnv;
}

export type ProcessStatus = 'processed' | 'duplicate' | 'ignored' | 'deferred' | 'manual_review';

const FINISHED = new Set(['processed', 'ignored', 'deferred', 'manual_review']);

type Row = Record<string, any>;
const one = async (sql: CreditsSql, q: string, p: unknown[] = []): Promise<Row | undefined> => (await sql.unsafe(q, p))[0];

export async function processPaddleEvent(ctx: ProcessContext, event: PaddleEvent): Promise<ProcessStatus> {
  const data = event.data ?? {};
  const isAdjustment = event.event_type.startsWith('adjustment.');
  await ctx.sql.unsafe(
    `INSERT INTO public.paddle_events (event_id, environment, event_type, occurred_at, source, transaction_id, adjustment_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text::jsonb) ON CONFLICT (event_id) DO NOTHING`,
    [event.event_id, ctx.environment, event.event_type, event.occurred_at, ctx.source,
     isAdjustment ? data.transaction_id ?? null : data.id ?? null, isAdjustment ? data.id ?? null : null,
     JSON.stringify(minimizeEntity(event.event_type, data))],
  );
  const stored = await one(ctx.sql, 'SELECT processing_status FROM public.paddle_events WHERE event_id = $1', [event.event_id]);
  if (stored && FINISHED.has(stored.processing_status)) return 'duplicate';

  try {
    return await ctx.sql.begin(async (tx) => {
      const locked = await one(tx, 'SELECT processing_status FROM public.paddle_events WHERE event_id = $1 FOR UPDATE', [event.event_id]);
      if (locked && FINISHED.has(locked.processing_status)) return 'duplicate' as const;
      const status = await dispatch(tx, ctx, event);
      await tx.unsafe(
        `UPDATE public.paddle_events SET processing_status = $2, attempts = attempts + 1, last_error = NULL, processed_at = now()
          WHERE event_id = $1`,
        [event.event_id, status === 'duplicate' ? 'processed' : status],
      );
      return status;
    });
  } catch (error) {
    await ctx.sql.unsafe(
      `UPDATE public.paddle_events SET processing_status = 'failed', attempts = attempts + 1, last_error = $2 WHERE event_id = $1`,
      [event.event_id, String((error as Error)?.message ?? error).slice(0, 500)],
    ).catch(() => {});
    throw error;
  }
}

async function dispatch(tx: CreditsSql, ctx: ProcessContext, event: PaddleEvent): Promise<ProcessStatus> {
  // Webhook-simulator events (signed, but demo data) are stored as evidence of
  // delivery and never touch money or credits.
  if (event.event_id.startsWith('ntfsimevt_')) return 'ignored';
  if (event.event_type.startsWith('transaction.')) return handleTransaction(tx, ctx, event);
  if (event.event_type === 'adjustment.created' || event.event_type === 'adjustment.updated') return handleAdjustment(tx, ctx, event);
  return 'ignored';
}

export async function raiseAlert(tx: CreditsSql, alert: {
  severity: 'review' | 'critical'; code: string; dedupeKey: string; paymentId?: string | number | null; userId?: string | null; details?: unknown;
}): Promise<void> {
  await tx.unsafe(
    `INSERT INTO public.billing_alerts (severity, code, dedupe_key, payment_id, user_id, details)
     VALUES ($1, $2, $3, $4, $5, $6::text::jsonb) ON CONFLICT (dedupe_key) DO NOTHING`,
    [alert.severity, alert.code, alert.dedupeKey, alert.paymentId ?? null, alert.userId ?? null, JSON.stringify(alert.details ?? {})],
  );
}

// ── transactions ────────────────────────────────────────────────────────────
async function handleTransaction(tx: CreditsSql, ctx: ProcessContext, event: PaddleEvent): Promise<ProcessStatus> {
  const d = event.data;
  const txnId = String(d.id ?? '');
  const pay = await one(tx,
    'SELECT * FROM public.payments WHERE environment = $1 AND paddle_transaction_id = $2 FOR UPDATE',
    [ctx.environment, txnId]);
  if (!pay) {
    // Not a checkout this deployment created (other environment, foreign or tampered transaction).
    await raiseAlert(tx, { severity: 'critical', code: 'user_mapping_failed', dedupeKey: `mapping:${ctx.environment}:${txnId}`,
      details: { transaction_id: txnId, event_id: event.event_id, reason: 'no local checkout for this transaction' } });
    return 'manual_review';
  }
  const custom = d.custom_data ?? {};
  if (!pay.user_id || custom.syllo_user_id !== pay.user_id || String(custom.syllo_payment_id ?? '') !== String(pay.id)) {
    await raiseAlert(tx, { severity: 'critical', code: 'user_mapping_failed', dedupeKey: `mapping:${ctx.environment}:${txnId}`,
      paymentId: pay.id, userId: pay.user_id, details: { transaction_id: txnId, event_id: event.event_id, reason: 'custom_data does not match the checkout' } });
    return 'manual_review';
  }

  if (d.status === 'completed') return completePurchase(tx, ctx, pay, event);
  if (pay.checkout_state === 'completed') return 'processed'; // completed never regresses
  if (d.status === 'canceled') {
    await tx.unsafe(`UPDATE public.payments SET checkout_state = 'canceled', updated_at = now() WHERE id = $1`, [pay.id]);
  } else if (event.event_type === 'transaction.payment_failed' && pay.checkout_state === 'checkout_created') {
    // The buyer may retry in the same checkout; a later completion overrides this.
    await tx.unsafe(`UPDATE public.payments SET checkout_state = 'failed', updated_at = now() WHERE id = $1`, [pay.id]);
  }
  return 'processed';
}

async function completePurchase(tx: CreditsSql, ctx: ProcessContext, pay: Row, event: PaddleEvent): Promise<ProcessStatus> {
  const d = event.data;
  const items: any[] = Array.isArray(d.items) ? d.items : [];
  const priceId = items[0]?.price?.id ?? items[0]?.price_id;
  const pkg = packageByPriceId(priceId, ctx.env);
  const totals = d.details?.totals ?? {};
  const amount = Number(totals.grand_total ?? totals.total);
  const problem =
    items.length !== 1 || Number(items[0]?.quantity ?? 1) !== 1 ? 'transaction must contain exactly one package, quantity 1'
    : !pkg ? 'price id is not in this deployment\'s catalog'
    : priceId !== pay.paddle_price_id || pkg.id !== pay.package_id ? 'price does not match the package chosen at checkout'
    : !Number.isFinite(amount) || amount < 0 || !totals.currency_code ? 'transaction totals missing'
    : null;
  if (problem) {
    await raiseAlert(tx, { severity: 'critical', code: 'unknown_price', dedupeKey: `price:${ctx.environment}:${d.id}`,
      paymentId: pay.id, userId: pay.user_id, details: { transaction_id: d.id, price_id: priceId ?? null, problem } });
    return 'manual_review';
  }

  await tx.unsafe(
    `UPDATE public.payments SET checkout_state = 'completed', completed_at = COALESCE(completed_at, $2::timestamptz),
            amount_total = $3, currency = $4, totals = $5::text::jsonb, paddle_customer_id = COALESCE($6, paddle_customer_id), updated_at = now()
      WHERE id = $1`,
    [pay.id, event.occurred_at, amount, totals.currency_code, JSON.stringify(totals), d.customer_id ?? null],
  );
  if (pay.lot_id == null) {
    // Credits are usable the moment this commits — no waiting period, no lock.
    const grant = await one(tx,
      'SELECT status, transaction_id FROM public.apply_credit_transaction($1, $2, $3, $4, $5::text::jsonb)',
      [pay.user_id, pay.credits_purchased, 'purchase', `paddle:${ctx.environment}:${d.id}`,
       JSON.stringify({ payment_id: String(pay.id), package_id: pay.package_id, paddle_transaction_id: d.id })]);
    const lot = await one(tx, 'SELECT id FROM public.credit_lots WHERE grant_transaction_id = $1', [grant!.transaction_id]);
    await tx.unsafe('UPDATE public.credit_lots SET payment_id = $2 WHERE id = $1', [lot!.id, pay.id]);
    await tx.unsafe('UPDATE public.payments SET lot_id = $2 WHERE id = $1', [pay.id, lot!.id]);
  }

  // Refunds/disputes that arrived before this purchase are applied now, in order.
  const waiting = await tx.unsafe(
    `SELECT * FROM public.payment_adjustments WHERE environment = $1 AND paddle_transaction_id = $2
        AND accounting_state IN ('pending', 'awaiting_purchase') ORDER BY occurred_at, paddle_adjustment_id`,
    [ctx.environment, d.id]);
  const fresh = await one(tx, 'SELECT * FROM public.payments WHERE id = $1', [pay.id]);
  let status: ProcessStatus = 'processed';
  for (const adj of waiting) {
    if ((await applyAdjustment(tx, fresh!, adj, event.event_id)) === 'manual_review') status = 'manual_review';
  }
  return status;
}

// ── adjustments (refunds, chargebacks, …) ───────────────────────────────────
const RANK: Record<string, number> = { pending_approval: 0, approved: 1, rejected: 1, reversed: 2 };

async function handleAdjustment(tx: CreditsSql, ctx: ProcessContext, event: PaddleEvent): Promise<ProcessStatus> {
  const d = event.data;
  const amount = d.totals?.total != null ? Number(d.totals.total) : null;
  const currency = d.currency_code ?? d.totals?.currency_code ?? null;
  const existing = await one(tx, 'SELECT * FROM public.payment_adjustments WHERE paddle_adjustment_id = $1 FOR UPDATE', [d.id]);
  if (existing) {
    const incoming = RANK[d.status] ?? -1;
    const known = RANK[existing.status] ?? -1;
    if (incoming < known) return 'ignored'; // an older event: never regress
    if (incoming === known && d.status !== existing.status) {
      await raiseAlert(tx, { severity: 'review', code: 'manual_review', dedupeKey: `conflict:${d.id}`, paymentId: existing.payment_id,
        details: { adjustment_id: d.id, reason: `conflicting statuses ${existing.status} / ${d.status}` } });
      return 'manual_review';
    }
    if (d.status === existing.status && !['pending', 'awaiting_purchase'].includes(existing.accounting_state)) return 'processed';
    await tx.unsafe(
      `UPDATE public.payment_adjustments SET status = $2, type = $3, amount = $4, currency = $5,
              occurred_at = GREATEST(occurred_at, $6::timestamptz), accounting_state = 'pending', updated_at = now()
        WHERE paddle_adjustment_id = $1`,
      [d.id, d.status, d.type ?? null, amount, currency, event.occurred_at]);
  } else {
    await tx.unsafe(
      `INSERT INTO public.payment_adjustments
         (paddle_adjustment_id, environment, paddle_transaction_id, action, type, status, amount, currency, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [d.id, ctx.environment, d.transaction_id, d.action, d.type ?? null, d.status, amount, currency, event.occurred_at]);
  }

  const pay = await one(tx,
    'SELECT * FROM public.payments WHERE environment = $1 AND paddle_transaction_id = $2 FOR UPDATE',
    [ctx.environment, d.transaction_id]);
  if (!pay || pay.checkout_state !== 'completed' || pay.lot_id == null) {
    // Refund before purchase: wait. The purchase applies it; reconciliation escalates if it never comes.
    await tx.unsafe(`UPDATE public.payment_adjustments SET accounting_state = 'awaiting_purchase', payment_id = $2 WHERE paddle_adjustment_id = $1`,
      [d.id, pay?.id ?? null]);
    return 'deferred';
  }
  const adj = await one(tx, 'SELECT * FROM public.payment_adjustments WHERE paddle_adjustment_id = $1', [d.id]);
  return applyAdjustment(tx, pay, adj!, event.event_id);
}

async function applyAdjustment(tx: CreditsSql, pay: Row, adj: Row, eventId: string): Promise<ProcessStatus> {
  const decisionKey = `adj:${adj.paddle_adjustment_id}:${adj.status}`;
  if (await one(tx, 'SELECT 1 FROM public.billing_policy_decisions WHERE decision_key = $1', [decisionKey])) return 'processed';

  // Lock order = AI metering's: account row first, then the lot.
  await tx.unsafe('SELECT 1 FROM public.credit_accounts WHERE user_id = $1 FOR UPDATE', [pay.user_id]);
  const lot = await one(tx, 'SELECT * FROM public.credit_lots WHERE id = $1 FOR UPDATE', [pay.lot_id]);
  const prior = await one(tx,
    `SELECT COALESCE(SUM(amount), 0) AS refunded, COALESCE(SUM(credits_revoked), 0) AS revoked
       FROM public.payment_adjustments
      WHERE payment_id = $1 AND action = 'refund' AND status = 'approved' AND accounting_state = 'applied'
        AND paddle_adjustment_id <> $2`,
    [pay.id, adj.paddle_adjustment_id]);
  const risk = await one(tx, 'SELECT * FROM public.account_risk_indicators WHERE user_id = $1', [pay.user_id]);

  const granted = Number(lot!.credits_granted);
  const consumed = Number(lot!.credits_consumed);
  const reserved = Number(lot!.credits_reserved);
  const revoked = Number(lot!.credits_revoked);
  const facts: AdjustmentFacts = {
    adjustment: {
      id: adj.paddle_adjustment_id, action: adj.action, type: adj.type, status: adj.status,
      amount: adj.amount == null ? null : Number(adj.amount), currency: adj.currency,
    },
    payment: {
      id: String(pay.id), amountTotal: pay.amount_total == null ? null : Number(pay.amount_total), currency: pay.currency,
      refundedBefore: Number(prior!.refunded), disputeState: pay.dispute_state,
    },
    lot: { granted, consumed, reserved, revoked, unused: granted - consumed - reserved - revoked },
    refundRevokedBefore: Number(prior!.revoked),
    risk: {
      refundAfterConsumptionCount: Number(risk?.refund_after_consumption_count ?? 0),
      chargebackCount: Number(risk?.chargeback_count ?? 0),
    },
  };
  const outcome = decideAdjustment(facts);

  let creditsRevoked = 0;
  const result: Record<string, unknown> = {};
  for (const action of outcome.actions) {
    switch (action.type) {
      case 'REVOKE_UNUSED_ENTITLEMENT': {
        const r = await one(tx, 'SELECT * FROM public.revoke_lot_credits($1, $2, $3, $4, $5, $6::text::jsonb)', [
          lot!.id, action.credits, action.kind, decisionKey, action.close,
          JSON.stringify({ payment_id: String(pay.id), adjustment_id: adj.paddle_adjustment_id, policy_version: POLICY_VERSION }),
        ]);
        creditsRevoked = Number(r!.revoked_now) + Number(r!.pending_added);
        Object.assign(result, { revoked_now: Number(r!.revoked_now), pending_added: Number(r!.pending_added), unrevocable: Number(r!.unrevocable) });
        break;
      }
      case 'MARK_CONSUMED_BEFORE_REFUND':
        await tx.unsafe('UPDATE public.payments SET consumed_before_refund = true, updated_at = now() WHERE id = $1', [pay.id]);
        break;
      case 'SET_DISPUTE_STATE':
        await tx.unsafe('UPDATE public.payments SET dispute_state = $2, updated_at = now() WHERE id = $1', [pay.id, action.state]);
        break;
      case 'RAISE_ALERT':
        await raiseAlert(tx, { severity: action.severity, code: action.code, dedupeKey: `${action.code}:${adj.paddle_adjustment_id}`,
          paymentId: pay.id, userId: pay.user_id, details: { adjustment_id: adj.paddle_adjustment_id, decision: outcome.decision, reasons: outcome.reasons } });
        break;
      case 'FLAG_ACCOUNT_REVIEW':
        // Review, never restriction: 'payment_risk_restricted' is only ever set by an admin.
        await tx.unsafe(`UPDATE public.profiles SET payment_risk_state = 'review_required' WHERE id = $1 AND payment_risk_state = 'normal'`, [pay.user_id]);
        break;
      case 'RECORD_CONSUMED_SERVICE':
        // Consumed credits are already immutable history (ai_operations + allocations); the decision log records the count.
        break;
    }
  }

  const accountingState = outcome.decision === 'MANUAL_REVIEW_REQUIRED' ? 'manual_review'
    : outcome.decision === 'RECORD_ONLY' ? 'recorded' : 'applied';
  await tx.unsafe(
    `UPDATE public.payment_adjustments SET accounting_state = $2, credits_revoked = $3, payment_id = $4, updated_at = now()
      WHERE paddle_adjustment_id = $1`,
    [adj.paddle_adjustment_id, accountingState, creditsRevoked, pay.id]);
  await tx.unsafe(
    `UPDATE public.payments SET updated_at = now(), refunded_amount = (
       SELECT COALESCE(SUM(amount), 0) FROM public.payment_adjustments
        WHERE payment_id = $1 AND action = 'refund' AND status = 'approved' AND accounting_state = 'applied')
      WHERE id = $1`,
    [pay.id]);
  await tx.unsafe(
    `INSERT INTO public.billing_policy_decisions (decision_key, policy_version, payment_id, adjustment_id, event_id, facts, decision, actions, result)
     VALUES ($1, $2, $3, $4, $5, $6::text::jsonb, $7, $8::text::jsonb, $9::text::jsonb)`,
    [decisionKey, outcome.policyVersion, pay.id, adj.paddle_adjustment_id, eventId, JSON.stringify(facts), outcome.decision,
     JSON.stringify({ actions: outcome.actions, reasons: outcome.reasons, analysis: outcome.analysis }), JSON.stringify(result)]);
  return accountingState === 'manual_review' ? 'manual_review' : 'processed';
}
