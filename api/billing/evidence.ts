/**
 * evidence.ts — the purchase timeline and the dispute/evidence package.
 *
 * Shows, from Syllo's own immutable records, that an authenticated account
 * bought X credits and received / consumed Y units of AI service at given times.
 * Only factual identifiers and metadata: no prompts, no AI output, no card data.
 * Never sent to Paddle automatically; an admin downloads it and decides.
 */
import type { CreditsSql } from '../ai/credits';

type Row = Record<string, any>;
const q = async (sql: CreditsSql, text: string, params: unknown[] = []) => (await sql.unsafe(text, params)) as Row[];

export interface EvidencePackage {
  generated_at: string;
  statement: string;
  purchase: {
    payment_id: string;
    environment: string;
    syllo_user_id: string | null;
    paddle_transaction_id: string | null;
    paddle_customer_id: string | null;
    package_id: string;
    package_version: number;
    amount_total: number | null;
    currency: string | null;
    purchased_at: string | null;
    status: string;
    refunded_amount: number;
    dispute_state: string;
    consumed_before_refund: boolean;
    terms_accepted: Record<string, unknown>;
  };
  credits: { purchased: number; consumed: number; reserved: number; revoked: number; unused: number; lot_state: string | null };
  service_delivery: {
    operation_count: number;
    first_operation_at: string | null;
    last_operation_at: string | null;
    operations: Array<{
      operation_id: string; endpoint: string; provider: string | null; model: string | null;
      delivered_at: string | null; credits_from_this_purchase: number;
      input_tokens: number | null; output_tokens: number | null; cached_tokens: number | null;
    }>;
  };
  paddle_events: Array<{ event_id: string; event_type: string; occurred_at: string; source: string; processing_status: string }>;
  adjustments: Array<{ adjustment_id: string; action: string; type: string | null; status: string; amount: number | null; currency: string | null; occurred_at: string; credits_revoked: number; accounting_state: string }>;
  policy_decisions: Array<{ decision_key: string; policy_version: string; decision: string; created_at: string; reasons: string[] }>;
}

const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
const num = (v: unknown) => (v == null ? null : Number(v));

export async function buildEvidence(sql: CreditsSql, paymentId: string): Promise<EvidencePackage | null> {
  if (!/^\d+$/.test(paymentId)) return null;
  const [pay] = await q(sql, 'SELECT * FROM public.payments WHERE id = $1', [paymentId]);
  if (!pay) return null;
  const [lot] = pay.lot_id == null ? [] : await q(sql, 'SELECT * FROM public.credit_lots WHERE id = $1', [pay.lot_id]);
  // Operations whose DELIVERED usage was allocated to this purchase's lot.
  const ops: Row[] = pay.lot_id == null ? [] : await q(sql, 
    `SELECT o.operation_id, o.endpoint, o.provider, o.model, o.finalized_at, o.input_tokens, o.output_tokens, o.cached_tokens,
            -al.amount AS credits
       FROM public.credit_allocations al
       JOIN public.credit_transactions t ON t.id = al.transaction_id AND t.kind = 'ai_usage'
       JOIN public.ai_operations o ON o.usage_transaction_id = t.id
      WHERE al.lot_id = $1
      ORDER BY o.finalized_at, o.operation_id`, [pay.lot_id]);
  const events = await q(sql, 
    `SELECT event_id, event_type, occurred_at, source, processing_status FROM public.paddle_events
      WHERE environment = $1 AND transaction_id = $2 ORDER BY occurred_at, received_at`,
    [pay.environment, pay.paddle_transaction_id]);
  const adjustments = await q(sql, 
    'SELECT * FROM public.payment_adjustments WHERE environment = $1 AND paddle_transaction_id = $2 ORDER BY occurred_at',
    [pay.environment, pay.paddle_transaction_id]);
  const decisions = await q(sql, 
    'SELECT decision_key, policy_version, decision, created_at, actions FROM public.billing_policy_decisions WHERE payment_id = $1 ORDER BY id',
    [paymentId]);

  const granted = Number(lot?.credits_granted ?? 0);
  const consumed = Number(lot?.credits_consumed ?? 0);
  const reserved = Number(lot?.credits_reserved ?? 0);
  const revoked = Number(lot?.credits_revoked ?? 0);
  const deliveredAt = ops.map((o) => iso(o.finalized_at)).filter(Boolean) as string[];
  return {
    generated_at: new Date().toISOString(),
    statement: `Authenticated Syllo account ${pay.user_id ?? '(deleted)'} purchased ${pay.credits_purchased} Syllo Credits `
      + `(Paddle transaction ${pay.paddle_transaction_id}) at ${iso(pay.completed_at) ?? 'n/a'} and subsequently consumed `
      + `${consumed} credits through ${ops.length} delivered AI operations`
      + (deliveredAt.length ? ` between ${deliveredAt[0]} and ${deliveredAt[deliveredAt.length - 1]}.` : '.'),
    purchase: {
      payment_id: String(pay.id), environment: pay.environment, syllo_user_id: pay.user_id,
      paddle_transaction_id: pay.paddle_transaction_id, paddle_customer_id: pay.paddle_customer_id,
      package_id: pay.package_id, package_version: Number(pay.package_version),
      amount_total: num(pay.amount_total), currency: pay.currency, purchased_at: iso(pay.completed_at),
      status: pay.status, refunded_amount: Number(pay.refunded_amount), dispute_state: pay.dispute_state,
      consumed_before_refund: Boolean(pay.consumed_before_refund), terms_accepted: pay.terms,
    },
    credits: { purchased: Number(pay.credits_purchased), consumed, reserved, revoked, unused: granted - consumed - reserved - revoked, lot_state: lot?.state ?? null },
    service_delivery: {
      operation_count: ops.length,
      first_operation_at: deliveredAt[0] ?? null,
      last_operation_at: deliveredAt[deliveredAt.length - 1] ?? null,
      operations: ops.map((o) => ({
        operation_id: o.operation_id, endpoint: o.endpoint, provider: o.provider, model: o.model,
        delivered_at: iso(o.finalized_at), credits_from_this_purchase: Number(o.credits),
        input_tokens: num(o.input_tokens), output_tokens: num(o.output_tokens), cached_tokens: num(o.cached_tokens),
      })),
    },
    paddle_events: events.map((e) => ({ event_id: e.event_id, event_type: e.event_type, occurred_at: iso(e.occurred_at)!, source: e.source, processing_status: e.processing_status })),
    adjustments: adjustments.map((a) => ({
      adjustment_id: a.paddle_adjustment_id, action: a.action, type: a.type, status: a.status, amount: num(a.amount), currency: a.currency,
      occurred_at: iso(a.occurred_at)!, credits_revoked: Number(a.credits_revoked), accounting_state: a.accounting_state,
    })),
    policy_decisions: decisions.map((d) => ({
      decision_key: d.decision_key, policy_version: d.policy_version, decision: d.decision, created_at: iso(d.created_at)!,
      reasons: (d.actions?.reasons ?? []) as string[],
    })),
  };
}

/** A short human-readable summary for reviewing a Paddle dispute. */
export function evidenceText(e: EvidencePackage): string {
  const p = e.purchase;
  // Paddle amounts are in the currency's lowest denomination; shown as-is, never re-scaled.
  const money = (v: number | null) => (v == null ? 'n/a' : `${v} ${p.currency ?? ''} (minor units)`);
  const lines = [
    'SYLLO — SERVICE DELIVERY EVIDENCE',
    `Generated: ${e.generated_at}`,
    '',
    e.statement,
    '',
    'PURCHASE',
    `  Syllo user id:          ${p.syllo_user_id ?? '(account deleted)'}`,
    `  Paddle transaction:     ${p.paddle_transaction_id}`,
    `  Paddle customer:        ${p.paddle_customer_id ?? 'n/a'}`,
    `  Environment:            ${p.environment}`,
    `  Package:                ${p.package_id} (v${p.package_version})`,
    `  Amount:                 ${money(p.amount_total)}`,
    `  Purchased at:           ${p.purchased_at ?? 'n/a'}`,
    `  Status:                 ${p.status} (refunded ${money(p.refunded_amount)}, dispute: ${p.dispute_state})`,
    `  Terms accepted:         ${Object.entries(p.terms_accepted ?? {}).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    '',
    'CREDITS FROM THIS PURCHASE',
    `  Purchased ${e.credits.purchased} · consumed ${e.credits.consumed} · in flight ${e.credits.reserved} · revoked ${e.credits.revoked} · unused ${e.credits.unused}`,
    '',
    `AI SERVICE DELIVERED (${e.service_delivery.operation_count} operations)`,
    ...e.service_delivery.operations.map((o) =>
      `  ${o.delivered_at}  ${o.operation_id}  ${o.endpoint}  ${o.model ?? ''}  credits=${o.credits_from_this_purchase}  tokens in/out=${o.input_tokens ?? '?'}/${o.output_tokens ?? '?'}`),
    '',
    'PADDLE EVENTS',
    ...e.paddle_events.map((ev) => `  ${ev.occurred_at}  ${ev.event_type}  ${ev.event_id}  (${ev.processing_status})`),
    '',
    'ADJUSTMENTS (refunds / disputes)',
    ...(e.adjustments.length ? e.adjustments.map((a) =>
      `  ${a.occurred_at}  ${a.action}/${a.type ?? '-'}  ${a.status}  ${money(a.amount)}  credits revoked=${a.credits_revoked}  (${a.accounting_state})`) : ['  none']),
    '',
    'AUTOMATED DECISIONS',
    ...(e.policy_decisions.length ? e.policy_decisions.map((d) => `  ${d.created_at}  ${d.decision}  [${d.policy_version}]  ${d.reasons.join('; ')}`) : ['  none']),
    '',
    'No conversation content is retained or included.',
  ];
  return lines.join('\n');
}
