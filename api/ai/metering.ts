/**
 * metering.ts — one AI operation, from admission to "service delivered".
 *
 * Every paid-AI call is metered. There is no free quota for customers:
 *
 *   open    → anonymous: refused (401 AUTH_REQUIRED)
 *             signed in: RESERVE CREDITS_PER_OPERATION purchased credits, or
 *             refuse (402 INSUFFICIENT_CREDITS); billing_exempt developers pass
 *             as 'exempt' (recorded, nothing charged)
 *   deliver → a reply reached the user = SERVICE DELIVERED: the reservation
 *             becomes consumption (finalize_ai_credits)
 *   release → anything else (error, empty run, conflict): credits returned
 *
 * Delivery is decided server-side only. Billing failures fail CLOSED (503), except
 * in local development with no DATABASE_URL, where there is nothing to meter.
 * Which lots may be spent (never a customer's internal/dev lots) is enforced in SQL:
 * scripts/migrations/billing/005_billing_closeout.sql.
 */
import { randomUUID } from 'crypto';
import postgres from 'postgres';
import { waitUntil } from '@vercel/functions';
import { verifiedUserId } from './auth_session';
import { finalizeCredits, releaseCredits, reserveCredits, type BillingSql, type CreditsSql, type OperationUsage } from './credits';
import { PG_OPTS } from './_quota';
import type { OwnerRequestLike, OwnerResponseLike } from './session_owner';
import { CREDITS_PER_REPLY } from '../../shared/billing/pricing';

export const CREDITS_PER_OPERATION = CREDITS_PER_REPLY;
/** The metering unit in force; stored per operation (ai_operations.pricing_version default, billing/005). */
export const METERING_VERSION = 'v1-1credit-per-reply';

export interface MeteredOperation {
  /** How this operation is paid for. 'unmetered_dev' = local dev without a database. */
  funding: 'credits' | 'exempt' | 'unmetered_dev';
  /** The result reached the user. Idempotent; never throws. */
  deliver(usage?: OperationUsage): Promise<void>;
  /** Not delivered. A no-op after deliver(). Never throws. */
  release(reason?: string): Promise<void>;
}

export type MeterRefusal = 'auth_required' | 'insufficient' | 'unavailable';

const UNMETERED_DEV: MeteredOperation = { funding: 'unmetered_dev', deliver: async () => {}, release: async () => {} };

let shared: BillingSql | null | undefined;
/** A small shared pool for billing calls; null when no DATABASE_URL (local dev). */
export function billingSql(): BillingSql | null {
  if (shared === undefined) {
    const url = (process.env.DATABASE_URL ?? '').trim();
    shared = url ? (postgres(url, { ...PG_OPTS, max: 3 }) as unknown as BillingSql) : null;
  }
  return shared;
}

/** Deployed on Vercel (preview or production): metering is mandatory. */
const deployed = () => Boolean(process.env.VERCEL || process.env.VERCEL_ENV);

export interface MeteringDeps {
  verifyUser?: (req: OwnerRequestLike, res: OwnerResponseLike) => Promise<string | null>;
  sql?: () => CreditsSql | null;
  deployed?: () => boolean;
}

/** Admit one AI operation, or say why it must be refused. */
export async function openMeteredOperation(
  req: OwnerRequestLike,
  res: OwnerResponseLike,
  opts: { endpoint: string; model: string },
  deps: MeteringDeps = {},
): Promise<MeteredOperation | { refused: MeterRefusal }> {
  const sql = (deps.sql ?? billingSql)();
  if (!sql) return (deps.deployed ?? deployed)() ? { refused: 'unavailable' } : UNMETERED_DEV;
  const userId = await (deps.verifyUser ?? verifiedUserId)(req, res);
  if (!userId) return { refused: 'auth_required' };

  const operationId = randomUUID();
  let status: string;
  try {
    ({ status } = await reserveCredits(sql, {
      userId, operationId, credits: CREDITS_PER_OPERATION, endpoint: opts.endpoint, provider: 'openai', model: opts.model,
    }));
  } catch (error) {
    console.error('[metering] reserve failed:', (error as Error)?.constructor?.name, (error as Error)?.message);
    return { refused: 'unavailable' };
  }
  if (status === 'insufficient') return { refused: 'insufficient' };

  // Settled exactly once. Vercel freezes the instance when the response ends, so
  // the settlement is also registered with waitUntil (a no-op outside Vercel);
  // callers that must charge BEFORE answering simply await deliver().
  let settlement: Promise<void> | null = null;
  const settle = (label: string, fn: () => Promise<unknown>): Promise<void> => {
    if (settlement) return settlement;
    settlement = fn().then(() => {}, (error) => {
      // A reservation left open is surfaced by reconciliation (stale reserved ops).
      console.error(`[metering] ${label} failed for ${operationId}:`, (error as Error)?.message);
    });
    waitUntil(settlement);
    return settlement;
  };
  return {
    funding: status === 'exempt' ? 'exempt' : 'credits',
    deliver: (usage = {}) => settle('finalize', () => finalizeCredits(sql, operationId, { model: opts.model, ...usage })),
    release: (reason = 'not_delivered') => settle('release', async () => {
      await releaseCredits(sql, operationId);
      await sql.unsafe(
        "UPDATE public.ai_operations SET release_reason = $2 WHERE operation_id = $1 AND state = 'released'",
        [operationId, reason.slice(0, 200)],
      );
    }),
  };
}

const REFUSALS: Record<MeterRefusal, { status: number; code: string; message_he: string }> = {
  auth_required: { status: 401, code: 'AUTH_REQUIRED', message_he: 'יש להתחבר (תפריט החשבון) כדי להשתמש בעוזר ה-AI.' },
  insufficient: { status: 402, code: 'INSUFFICIENT_CREDITS', message_he: 'אין מספיק קרדיטים. אפשר לרכוש קרדיטים מתפריט החשבון.' },
  unavailable: { status: 503, code: 'BILLING_UNAVAILABLE', message_he: 'לא ניתן לאמת קרדיטים כרגע. נא לנסות שוב.' },
};

/** The one wire shape every AI endpoint answers a refusal with. */
export function sendMeterRefusal(
  res: { status(code: number): { json(body: unknown): unknown } },
  refusal: MeterRefusal,
): void {
  const { status, ...body } = REFUSALS[refusal];
  res.status(status).json({ ok: false, ...body });
}
