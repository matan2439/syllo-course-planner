/**
 * Persistence helpers for planner runs (planner_runs table).
 *
 * A run row is created at the start of a planning request (status 'running')
 * and updated to a terminal status ('done' | 'blocked' | 'failed') with the full
 * trace, candidates, selected plan, validation report and explanation when the
 * run finishes. All trace/report artifacts are stored as JSONB.
 *
 * Connection options mirror _quota.ts (Supabase PgBouncer transaction mode).
 */

import postgres from 'postgres';

const PG_OPTS = {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 10,
  prepare: false,   // required for Supabase PgBouncer transaction mode
  ssl: 'require',   // Supabase always requires TLS in production
} as const;

export type PlannerRunStatus = 'running' | 'done' | 'blocked' | 'failed';

export interface PlannerRunRow {
  id: string;
  session_token: string;
  program_id: string;
  orchestrator: string;
  status: PlannerRunStatus;
  trace_json: unknown;
  candidates_json: unknown;
  selected_plan_json: unknown;
  validation_report_json: unknown;
  explanation_json: unknown;
  error_text: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

/** Create a 'running' planner_runs row and return its id. */
export async function createRun(
  dbUrl: string,
  run: { session_token: string; program_id: string; orchestrator: string },
): Promise<string> {
  const sql = postgres(dbUrl, PG_OPTS);
  try {
    const rows = await sql<Array<{ id: string }>>`
      INSERT INTO planner_runs (session_token, program_id, orchestrator)
      VALUES (${run.session_token}, ${run.program_id}, ${run.orchestrator})
      RETURNING id
    `;
    if (!rows[0]) throw new Error('createRun: INSERT...RETURNING returned no rows');
    return rows[0].id;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export interface RunFinalState {
  status: PlannerRunStatus;
  trace?: unknown;
  candidates?: unknown;
  selectedPlan?: unknown;
  validationReport?: unknown;
  explanation?: unknown;
  error?: string;
}

/** Update a run row to its terminal state with the produced artifacts. */
export async function markRunFinal(dbUrl: string, id: string, final: RunFinalState): Promise<void> {
  const sql = postgres(dbUrl, PG_OPTS);
  try {
    await sql`
      UPDATE planner_runs
      SET    status                 = ${final.status},
             trace_json             = ${sql.json((final.trace ?? null) as any)},
             candidates_json        = ${sql.json((final.candidates ?? null) as any)},
             selected_plan_json     = ${sql.json((final.selectedPlan ?? null) as any)},
             validation_report_json = ${sql.json((final.validationReport ?? null) as any)},
             explanation_json       = ${sql.json((final.explanation ?? null) as any)},
             error_text             = ${final.error ?? null},
             updated_at             = now(),
             finished_at            = now()
      WHERE  id = ${id}
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Fetch a persisted run by id (for reload / download). */
export async function getRun(dbUrl: string, id: string): Promise<PlannerRunRow | null> {
  const sql = postgres(dbUrl, PG_OPTS);
  try {
    const rows = await sql<PlannerRunRow[]>`
      SELECT * FROM planner_runs WHERE id = ${id} LIMIT 1
    `;
    return rows[0] ?? null;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
