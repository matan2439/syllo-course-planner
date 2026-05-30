/**
 * Server-side AI quota helpers.
 *
 * All DB operations go through the postgres package (Node.js runtime only).
 * These functions are exported so they can be unit-tested independently.
 *
 * Quota rule:
 *   remaining = FREE_LIMIT + credits_paid - credits_used
 *   allowed   = remaining > 0
 *
 * Connection notes:
 *   ssl: 'require'   — Supabase production connections always need TLS.
 *   prepare: false   — Supabase PgBouncer (port 6543, transaction mode)
 *                      does not support prepared statements.
 *   connect_timeout  — fail fast instead of hanging the Vercel function.
 *   sql.end()        — always close the single-use connection in finally.
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
  prepare: false,   // required for Supabase PgBouncer transaction mode
  ssl: 'require',   // Supabase always requires TLS in production
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
  console.log('[quota] checkAndEnsureSession started — token present:', !!sessionToken);
  const sql = postgres(dbUrl, PG_OPTS);
  try {
    console.log('[quota] DB query started');
    const rows = await sql<Array<{ credits_used: number; credits_paid: number }>>`
      INSERT INTO anonymous_sessions (session_token)
      VALUES (${sessionToken})
      ON CONFLICT (session_token)
      DO UPDATE SET last_seen_at = now()
      RETURNING credits_used, credits_paid
    `;

    if (!rows[0]) {
      // Should not happen — UPSERT...RETURNING always returns a row.
      // Guard defensively to prevent a TypeError from being mistaken for a DB error.
      throw new Error('UPSERT_NO_ROWS: INSERT...ON CONFLICT...RETURNING returned no rows');
    }

    const { credits_used, credits_paid } = rows[0];
    const remaining = Math.max(0, FREE_LIMIT + credits_paid - credits_used);
    console.log('[quota] DB query complete — credits_used:', credits_used, 'remaining:', remaining);
    return {
      allowed: remaining > 0,
      credits_used,
      credits_paid,
      free_limit: FREE_LIMIT,
      remaining,
    };
  } catch (err) {
    // Log with the error class name so it is searchable in Vercel logs.
    // Example searches: "PostgresError", "TypeError", "Error"
    const errClass = (err as any)?.constructor?.name ?? 'UnknownError';
    const errMsg   = err instanceof Error ? err.message : String(err);
    const errCode  = (err as any)?.code ?? '';
    console.error(`[quota] DB error [${errClass}] code=${errCode}:`, errMsg);
    throw err;  // re-throw so runQuotaCheck can record DB_ERROR
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
  } catch (err) {
    const errClass = (err as any)?.constructor?.name ?? 'UnknownError';
    console.error(`[quota] incrementCreditsUsed error [${errClass}]:`, err instanceof Error ? err.message : String(err));
    throw err;
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
  } catch (err) {
    const errClass = (err as any)?.constructor?.name ?? 'UnknownError';
    console.error(`[quota] logUsageEvent error [${errClass}]:`, err instanceof Error ? err.message : String(err));
    // Non-fatal: don't re-throw
  } finally {
    await sql.end({ timeout: 5 });
  }
}
