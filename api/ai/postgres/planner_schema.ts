export const PLANNER_SCHEMA_VERSION = 1;

export type PlannerSchemaStatus = 'current' | 'missing' | 'mismatch';

export interface PlannerSchemaSql {
  unsafe(query: string): Promise<readonly Record<string, unknown>[]>;
}

export async function checkPlannerSchema(sql: PlannerSchemaSql): Promise<PlannerSchemaStatus> {
  let rows: readonly Record<string, unknown>[];
  try {
    rows = await sql.unsafe(
      'SELECT version FROM planner_schema_versions ORDER BY version DESC LIMIT 1',
    );
  } catch {
    return 'missing';
  }
  if (rows.length === 0) return 'missing';
  return Number(rows[0].version) === PLANNER_SCHEMA_VERSION ? 'current' : 'mismatch';
}

export async function migratePlannerSchema(
  sql: PlannerSchemaSql,
  migrationSql: string,
): Promise<void> {
  await sql.unsafe(migrationSql);
}
