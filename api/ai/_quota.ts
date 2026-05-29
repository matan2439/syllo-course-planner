/**
 * Server-side AI quota helpers.
 *
 * All DB operations go through the postgres package (Node.js runtime only).
 * These functions are exported so they can be unit-tested independently.
 *
 * Quota rule:
 *   remaining = FREE_LIMIT + credits_paid - credits_used
 *   allowed   = remaining > 0
 */

import postgres from 'postgres';

export const FREE_LIMIT = parseInt(process.env.AI_FREE_QUOTA ?? '5', 10);

export interface QuotaStatus {
  allowed: boolean;
  credits_used: number;
  credits_paid: number;
  free_limit: number;
  remaining: number;
}

/** Shared postgres connection options for short-lived serverless calls. */
const PG_OPTS = {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 10,
  prepare: false, // required for Supabase PgBouncer transaction mode
} as const;

/**
 * UPSERT a session row and return the current quota status.
 *
 * Creates the session if it does not exist yet (first request from this browser).
 * Updates last_seen_at on every call.
 */
export async function checkAndEnsureSession(
  sessionToken: string,
  dbUrl: string,
): Promise<QuotaStatus> {
  const sql = postgres(dbUrl, PG_OPTS);
  try {
    const rows = await sql<Array<{ credits_used: number; credits_paid: number }>>`
      INSERT INTO anonymous_sessions (session_token)
      VALUES (${sessionToken})
      ON CONFLICT (session_token)
      DO UPDATE SET last_seen_at = now()
      RETURNING credits_used, credits_paid
    `;
    const { credits_used, credits_paid } = rows[0];
    const remaining = Math.max(0, FREE_LIMIT + credits_paid - credits_used);
    return {
      allowed: remaining > 0,
      credits_used,
      credits_paid,
      free_limit: FREE_LIMIT,
      remaining,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Increment credits_used by 1 for a session.
 * Called AFTER a successful AI response — never before.
 */
export async function incrementCreditsUsed(
  sessionToken: string,
  dbUrl: string,
): Promise<void> {
  const sql = postgres(dbUrl, PG_OPTS);
  try {
    await sql`
      UPDATE anonymous_sessions
      SET    credits_used = credits_used + 1,
             last_seen_at = now()
      WHERE  session_token = ${sessionToken}
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Insert one row into ai_usage_events after a completed AI request.
 * Failures here are non-fatal — logged but not propagated.
 */
export async function logUsageEvent(
  sessionToken: string,
  model: string,
  dbUrl: string,
): Promise<void> {
  const sql = postgres(dbUrl, PG_OPTS);
  try {
    await sql`
      INSERT INTO ai_usage_events (session_token, model)
      VALUES (${sessionToken}, ${model})
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
