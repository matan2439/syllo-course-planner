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

// ── AI metering: reserve → finalize (service delivered) | release ────────────
// All rules live in scripts/migrations/billing/002_credit_lots.sql.

export type ReserveStatus = 'applied' | 'replayed' | 'exempt' | 'insufficient';

export interface ReserveInput {
  userId: string;
  operationId: string;
  /** 0 = a free-quota operation, recorded for evidence only (nothing held). */
  credits: number;
  endpoint: string;
  provider?: string | null;
  model?: string | null;
}

export async function reserveCredits(sql: CreditsSql, input: ReserveInput): Promise<{ status: ReserveStatus; available: number }> {
  assertUserId(input.userId);
  if (!Number.isInteger(input.credits) || input.credits < 0) throw new TypeError('credits: reserve must be a non-negative integer');
  if (!input.operationId) throw new TypeError('credits: operationId is required');
  const rows = await sql.unsafe(
    'SELECT status, available FROM public.reserve_ai_credits($1, $2, $3, $4, $5, $6)',
    [input.userId, input.operationId, input.credits, input.endpoint, input.provider ?? null, input.model ?? null],
  );
  return { status: rows[0].status as ReserveStatus, available: Number(rows[0].available) };
}

/** Provider usage for one operation; unknown fields stay null (cost is never estimated). */
export interface OperationUsage {
  provider?: string;
  model?: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cached_tokens?: number | null;
  provider_cost_usd?: number | null;
}

/** The service was delivered: reserved credits become consumed. 'released' = too late, nothing charged. */
export async function finalizeCredits(
  sql: CreditsSql, operationId: string, usage: OperationUsage = {},
): Promise<{ status: 'applied' | 'replayed' | 'released'; balance: number }> {
  const rows = await sql.unsafe(
    'SELECT status, balance FROM public.finalize_ai_credits($1, $2::jsonb)',
    [operationId, JSON.stringify(usage)],
  );
  return { status: rows[0].status as 'applied' | 'replayed' | 'released', balance: Number(rows[0].balance) };
}

/** Not delivered: the reservation is returned (or revoked, if its lot was refunded meanwhile). */
export async function releaseCredits(sql: CreditsSql, operationId: string): Promise<void> {
  await sql.unsafe('SELECT status FROM public.release_ai_credits($1)', [operationId]);
}

export interface LotSummary {
  lotId: string;
  sourceClass: 'purchased' | 'promotional' | 'subscription' | 'internal';
  paymentId: string | null;
  granted: number;
  consumed: number;
  reserved: number;
  revoked: number;
  unused: number;
  state: 'active' | 'revoked';
  createdAt: string;
}

/** Per-lot provenance for one user: what was granted, consumed, revoked and is still unused. */
export async function lotSummary(sql: CreditsSql, userId: string): Promise<LotSummary[]> {
  assertUserId(userId);
  const rows = await sql.unsafe(
    `SELECT id, source_class, payment_id, credits_granted, credits_consumed, credits_reserved, credits_revoked, state, created_at
       FROM public.credit_lots WHERE user_id = $1 ORDER BY created_at, id`,
    [userId],
  );
  return rows.map((r) => {
    const granted = Number(r.credits_granted);
    const consumed = Number(r.credits_consumed);
    const reserved = Number(r.credits_reserved);
    const revoked = Number(r.credits_revoked);
    return {
      lotId: String(r.id),
      sourceClass: r.source_class as LotSummary['sourceClass'],
      paymentId: r.payment_id == null ? null : String(r.payment_id),
      granted, consumed, reserved, revoked,
      unused: granted - consumed - reserved - revoked,
      state: r.state as LotSummary['state'],
      createdAt: new Date(r.created_at as string).toISOString(),
    };
  });
}

/** Token usage of an OpenAI Agents SDK run (`result.state.usage`); cost is never estimated. */
export function usageFromAgentRun(usage: {
  inputTokens?: number; outputTokens?: number; inputTokensDetails?: unknown;
} | undefined): OperationUsage {
  if (!usage) return {};
  const details = Array.isArray(usage.inputTokensDetails) ? usage.inputTokensDetails : [usage.inputTokensDetails];
  const cached = details.reduce((sum: number, d) => sum + Number((d as Record<string, number> | undefined)?.cached_tokens ?? 0), 0);
  return {
    input_tokens: usage.inputTokens ?? null,
    output_tokens: usage.outputTokens ?? null,
    cached_tokens: cached,
  };
}
