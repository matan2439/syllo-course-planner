/**
 * credits.ts — server-side access to the Syllo Credits ledger.
 *
 * Every rule (atomicity, per-user locking, idempotency, no overdraft, billing
 * exemption) lives in `public.apply_credit_transaction` — see
 * scripts/migrations/billing/001_credits.sql. This module only validates inputs
 * at the boundary and maps the result. It must be called with a user id the
 * server verified (`verifiedUserId` in auth_session.ts), never one from a request body.
 */

export interface CreditsSql {
  unsafe(query: string, parameters?: readonly unknown[]): Promise<Array<Record<string, unknown>>>;
}

export type CreditKind =
  | 'purchase' | 'promo_grant' | 'subscription_grant'
  | 'admin_adjustment' | 'refund' | 'ai_usage';

export type CreditStatus = 'applied' | 'replayed' | 'exempt' | 'insufficient';

export interface CreditTransactionInput {
  userId: string;
  /** Positive = credits added, negative = credits spent. Never zero. */
  delta: number;
  kind: CreditKind;
  /** External/event id. Same (kind, reference) is applied at most once. */
  reference?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreditTransactionResult {
  status: CreditStatus;
  /** Balance after the call (unchanged unless status is 'applied'). */
  balance: number;
  transactionId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT32_MAX = 2_147_483_647;

function assertUserId(userId: string): void {
  if (!UUID.test(userId)) throw new TypeError('credits: userId must be a verified auth user uuid');
}

export async function applyCreditTransaction(
  sql: CreditsSql,
  input: CreditTransactionInput,
): Promise<CreditTransactionResult> {
  assertUserId(input.userId);
  if (!Number.isInteger(input.delta) || input.delta === 0 || Math.abs(input.delta) > INT32_MAX) {
    throw new TypeError('credits: delta must be a non-zero integer');
  }
  const rows = await sql.unsafe(
    'SELECT status, balance, transaction_id FROM public.apply_credit_transaction($1, $2, $3, $4, $5::jsonb)',
    [input.userId, input.delta, input.kind, input.reference ?? null, JSON.stringify(input.metadata ?? {})],
  );
  const row = rows[0];
  return {
    status: row.status as CreditStatus,
    balance: Number(row.balance),
    transactionId: row.transaction_id == null ? null : String(row.transaction_id),
  };
}

/**
 * The entry point for AI metering: spend `credits` for one operation.
 * `operationId` makes retries safe (a repeated id is 'replayed', never charged twice).
 * 'exempt' = billing_exempt account: record usage/cost elsewhere, nothing deducted.
 * 'insufficient' = not enough credits, nothing deducted.
 */
export function chargeCredits(
  sql: CreditsSql,
  charge: { userId: string; credits: number; operationId: string; metadata?: Record<string, unknown> },
): Promise<CreditTransactionResult> {
  if (!Number.isInteger(charge.credits) || charge.credits <= 0) {
    throw new TypeError('credits: charge must be a positive integer');
  }
  if (!charge.operationId) throw new TypeError('credits: operationId is required');
  return applyCreditTransaction(sql, {
    userId: charge.userId,
    delta: -charge.credits,
    kind: 'ai_usage',
    reference: charge.operationId,
    metadata: charge.metadata,
  });
}

export async function getCreditBalance(sql: CreditsSql, userId: string): Promise<number> {
  assertUserId(userId);
  const rows = await sql.unsafe('SELECT balance FROM public.credit_accounts WHERE user_id = $1', [userId]);
  return rows[0] ? Number(rows[0].balance) : 0;
}
