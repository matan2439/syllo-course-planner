/**
 * metering.ts — one AI operation, from admission to "service delivered".
 *
 * The free quota (`_quota.ts`) is unchanged and is spent first. Only when it is
 * exhausted does a signed-in user spend Syllo Credits: CREDITS_PER_OPERATION per
 * delivered result — the same unit the free quota counts.
 *
 *   open    → free quota left: record the op (evidence only, nothing held)
 *             quota exhausted: RESERVE credits (held, not yet spent) or refuse
 *   deliver → the result was persisted/streamed to the user = SERVICE DELIVERED:
 *             reserved credits become consumed (finalize_ai_credits)
 *   release → anything else (error, empty run, timeout): credits returned
 *
 * Delivery is decided server-side only. Screenshots, copies and downloads are
 * never signals: whatever reached the user may be kept, which is why the credit is
 * consumed at delivery, not later. Anonymous visitors keep the old quota-only flow.
 */
import { randomUUID } from 'crypto';
import postgres from 'postgres';
import { verifiedUserId } from './auth_session';
import { finalizeCredits, releaseCredits, reserveCredits, type BillingSql, type CreditsSql, type OperationUsage } from './credits';
import { PG_OPTS } from './_quota';
import type { OwnerRequestLike, OwnerResponseLike } from './session_owner';

export const CREDITS_PER_OPERATION = 1;

export interface MeteredOperation {
  /** How this operation is paid for. */
  funding: 'anonymous' | 'free_quota' | 'credits' | 'exempt';
  /** The result reached the user. Idempotent; never throws. */
  deliver(usage?: OperationUsage): Promise<void>;
  /** Not delivered. A no-op after deliver(). Never throws. */
  release(): Promise<void>;
}

const ANONYMOUS: MeteredOperation = { funding: 'anonymous', deliver: async () => {}, release: async () => {} };

let shared: BillingSql | null | undefined;
/** A small shared pool for billing calls; null when no DATABASE_URL (local dev). */
export function billingSql(): BillingSql | null {
  if (shared === undefined) {
    const url = (process.env.DATABASE_URL ?? '').trim();
    shared = url ? (postgres(url, { ...PG_OPTS, max: 3 }) as unknown as BillingSql) : null;
  }
  return shared;
}

export interface MeteringDeps {
  verifyUser?: (req: OwnerRequestLike, res: OwnerResponseLike) => Promise<string | null>;
  sql?: () => CreditsSql | null;
}

/**
 * Admit one AI operation. Returns null when it must be refused (free quota
 * exhausted and no credits, or not signed in) — callers answer with today's 429.
 */
export async function openMeteredOperation(
  req: OwnerRequestLike,
  res: OwnerResponseLike,
  opts: { endpoint: string; model: string; freeQuotaAllowed: boolean },
  deps: MeteringDeps = {},
): Promise<MeteredOperation | null> {
  const fallback = opts.freeQuotaAllowed ? ANONYMOUS : null;
  const userId = await (deps.verifyUser ?? verifiedUserId)(req, res);
  if (!userId) return fallback;
  const sql = (deps.sql ?? billingSql)();
  if (!sql) return fallback;

  const operationId = randomUUID();
  const credits = opts.freeQuotaAllowed ? 0 : CREDITS_PER_OPERATION;
  let status: string;
  try {
    ({ status } = await reserveCredits(sql, {
      userId, operationId, credits, endpoint: opts.endpoint, provider: 'openai', model: opts.model,
    }));
  } catch (error) {
    // Billing tables unavailable: behave exactly like before credits existed.
    console.error('[metering] reserve failed:', (error as Error)?.constructor?.name, (error as Error)?.message);
    return fallback;
  }
  if (status === 'insufficient') return null;

  let settled = false;
  const settle = async (label: string, fn: () => Promise<unknown>) => {
    if (settled) return;
    settled = true;
    try {
      await fn();
    } catch (error) {
      // A reservation left open is surfaced by reconciliation (stale reserved ops).
      console.error(`[metering] ${label} failed for ${operationId}:`, (error as Error)?.message);
    }
  };
  return {
    funding: credits === 0 ? 'free_quota' : status === 'exempt' ? 'exempt' : 'credits',
    deliver: (usage = {}) => settle('finalize', () => finalizeCredits(sql, operationId, { model: opts.model, ...usage })),
    release: () => settle('release', () => releaseCredits(sql, operationId)),
  };
}
