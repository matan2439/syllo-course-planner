/**
 * reconcile.ts — scheduled comparison of Paddle's truth with Syllo's records.
 *
 * Paddle state is fetched per known checkout and fed through the SAME processor
 * as webhooks (as synthetic, idempotent events). A missed webhook (completed
 * payment without a grant, a refund or chargeback not reflected locally) is
 * therefore repaired by exactly the code path that normally handles it, with
 * the same idempotency, locking and audit trail. Local invariants are then
 * checked. Deterministic → repaired and recorded; ambiguous → review alert;
 * integration failure → critical alert. History is never edited in place.
 */
import type { BillingSql, CreditsSql } from '../ai/credits';
import type { PaddleApi, PaddleEnvironment } from './paddle';
import { processPaddleEvent, raiseAlert } from './process_event';

export interface ReconcileContext {
  sql: BillingSql;
  environment: PaddleEnvironment;
  api: PaddleApi;
  trigger: 'cron' | 'admin';
  actorId?: string | null;
  env?: NodeJS.ProcessEnv;
}

const q = async (sql: CreditsSql, text: string, params: unknown[] = []) => (await sql.unsafe(text, params)) as Array<Record<string, any>>;

export interface Finding { code: string; subject: string; outcome: 'repaired' | 'escalated' | 'ok'; detail?: string }

// ponytail: bounded batch per run; a backlog drains over successive runs. Page by id if volume ever needs it.
const BATCH = 200;
const STALE_CHECKOUT_DAYS = 7;
const STALE_RESERVATION_MINUTES = 60;

export async function reconcile(ctx: ReconcileContext): Promise<{ runId: string; status: string; findings: Finding[] }> {
  const [run] = await q(ctx.sql, 
    'INSERT INTO public.billing_reconciliation_runs (trigger, actor_id) VALUES ($1, $2) RETURNING id', [ctx.trigger, ctx.actorId ?? null]);
  const findings: Finding[] = [];
  let checked = 0;
  const day = new Date().toISOString().slice(0, 10);
  try {
    // 1) Paddle vs local, per checkout that can still change: open checkouts (30 days)
    //    and completed purchases young enough for refunds/chargebacks (180 days).
    const payments = await q(ctx.sql, 
      `SELECT id, paddle_transaction_id, checkout_state, lot_id, created_at FROM public.payments
        WHERE environment = $1 AND paddle_transaction_id IS NOT NULL
          AND ((checkout_state IN ('checkout_created', 'failed') AND created_at > now() - interval '30 days')
            OR (checkout_state = 'completed' AND completed_at > now() - interval '180 days'))
        ORDER BY updated_at LIMIT ${BATCH}`, [ctx.environment]);
    for (const pay of payments) {
      checked += 1;
      const txnId = String(pay.paddle_transaction_id);
      try {
        const txn = await ctx.api.getTransaction(txnId);
        const before = pay.lot_id;
        const status = await processPaddleEvent({ ...ctx, source: 'reconciliation' }, {
          event_id: `recon:txn:${txnId}:${txn.status}:${txn.updated_at ?? ''}`,
          event_type: txn.status === 'completed' ? 'transaction.completed' : txn.status === 'canceled' ? 'transaction.canceled' : 'transaction.updated',
          occurred_at: txn.updated_at ?? new Date().toISOString(),
          data: txn,
        });
        if (txn.status === 'completed' && before == null && status === 'processed') {
          findings.push({ code: 'completed_payment_without_grant', subject: `payment:${pay.id}`, outcome: 'repaired' });
        } else if (status === 'manual_review') {
          findings.push({ code: 'transaction_needs_review', subject: `payment:${pay.id}`, outcome: 'escalated' });
        }
        if (['draft', 'ready'].includes(txn.status) && Date.now() - new Date(pay.created_at).getTime() > STALE_CHECKOUT_DAYS * 86_400_000) {
          await q(ctx.sql, 
            `UPDATE public.payments SET checkout_state = 'expired', updated_at = now() WHERE id = $1 AND checkout_state IN ('checkout_created', 'failed')`, [pay.id]);
          findings.push({ code: 'stale_pending_checkout', subject: `payment:${pay.id}`, outcome: 'repaired', detail: 'marked expired' });
        }
        for (const adj of await ctx.api.listAdjustments(txnId)) {
          const s = await processPaddleEvent({ ...ctx, source: 'reconciliation' }, {
            event_id: `recon:adj:${adj.id}:${adj.status}`,
            event_type: 'adjustment.updated',
            occurred_at: adj.updated_at ?? adj.created_at ?? new Date().toISOString(),
            data: adj,
          });
          if (s === 'processed') findings.push({ code: 'adjustment_not_reflected', subject: `adjustment:${adj.id}`, outcome: 'repaired' });
          if (s === 'manual_review') findings.push({ code: 'adjustment_needs_review', subject: `adjustment:${adj.id}`, outcome: 'escalated' });
        }
      } catch (error) {
        findings.push({ code: 'paddle_fetch_failed', subject: `payment:${pay.id}`, outcome: 'escalated', detail: (error as Error)?.message });
        await raiseAlert(ctx.sql, { severity: 'critical', code: 'reconciliation_failed', dedupeKey: `recon_fetch:${pay.id}:${day}`,
          paymentId: pay.id, details: { error: (error as Error)?.message } });
      }
    }

    // 2) AI calls that died without delivering: their reservations are released (deterministic).
    const stale = await q(ctx.sql, 
      `SELECT operation_id FROM public.ai_operations WHERE state = 'reserved' AND reserved_at < now() - interval '${STALE_RESERVATION_MINUTES} minutes' LIMIT ${BATCH}`);
    for (const op of stale) {
      await q(ctx.sql, 'SELECT status FROM public.release_ai_credits($1)', [op.operation_id]);
      findings.push({ code: 'stale_reservation', subject: `operation:${op.operation_id}`, outcome: 'repaired', detail: 'released (not delivered)' });
    }

    // 3) Local invariants — never auto-edited: a violation means a bug or a manual change.
    for (const v of await q(ctx.sql, 'SELECT * FROM public.billing_invariant_violations')) {
      findings.push({ code: v.code, subject: v.subject, outcome: 'escalated' });
      await raiseAlert(ctx.sql, { severity: 'critical', code: 'ledger_invariant', dedupeKey: `invariant:${v.code}:${v.subject}`,
        paymentId: v.payment_id, userId: v.user_id, details: { violation: v.code, subject: v.subject } });
    }

    // 4) Integration health.
    for (const a of await q(ctx.sql, 
      `SELECT paddle_adjustment_id, payment_id FROM public.payment_adjustments
        WHERE accounting_state = 'awaiting_purchase' AND created_at < now() - interval '24 hours'`)) {
      findings.push({ code: 'adjustment_without_purchase', subject: `adjustment:${a.paddle_adjustment_id}`, outcome: 'escalated' });
      await raiseAlert(ctx.sql, { severity: 'review', code: 'manual_review', dedupeKey: `orphan_adjustment:${a.paddle_adjustment_id}`,
        paymentId: a.payment_id, details: { adjustment_id: a.paddle_adjustment_id, reason: 'refund/dispute for a purchase that never completed locally' } });
    }
    await checkWebhookHealth(ctx.sql, findings, day);

    const escalated = findings.filter((f) => f.outcome === 'escalated').length;
    const repaired = findings.filter((f) => f.outcome === 'repaired').length;
    const status = escalated ? 'issues' : 'ok';
    await q(ctx.sql, 
      `UPDATE public.billing_reconciliation_runs SET finished_at = now(), status = $2, checked = $3, repaired = $4, escalated = $5, findings = $6::text::jsonb WHERE id = $1`,
      [run.id, status, checked, repaired, escalated, JSON.stringify(findings)]);
    return { runId: String(run.id), status, findings };
  } catch (error) {
    await q(ctx.sql, 
      `UPDATE public.billing_reconciliation_runs SET finished_at = now(), status = 'failed', findings = $2::text::jsonb WHERE id = $1`,
      [run.id, JSON.stringify([...findings, { code: 'run_failed', subject: 'reconciliation', outcome: 'escalated', detail: (error as Error)?.message }])]);
    await raiseAlert(ctx.sql, { severity: 'critical', code: 'reconciliation_failed', dedupeKey: `recon_run:${day}`, details: { error: (error as Error)?.message } });
    throw error;
  }
}

async function checkWebhookHealth(sql: CreditsSql, findings: Finding[], day: string) {
  const [failing] = await q(sql, 
    `SELECT COUNT(*)::int AS n FROM public.paddle_events
      WHERE processing_status = 'failed' AND (attempts >= 3 OR received_at < now() - interval '1 hour')`);
  if (failing.n > 0) {
    findings.push({ code: 'webhook_failing', subject: 'paddle_events', outcome: 'escalated', detail: `${failing.n} events stuck in failed` });
    await raiseAlert(sql, { severity: 'critical', code: 'webhook_failing', dedupeKey: `webhook_failing:${day}`, details: { failed_events: failing.n } });
  }
}
