import fs from 'fs';
import path from 'path';
import {
  PLANNER_SCHEMA_VERSION,
  checkPlannerSchema,
  migratePlannerSchema,
  type PlannerSchemaSql,
} from '../../api/ai/postgres/planner_schema';

const migrationPath = path.resolve(
  process.cwd(),
  'scripts/migrations/planner/001_planner_state.sql',
);

describe('durable planner schema', () => {
  test('defines every authoritative record with additive constraints', () => {
    const migration = fs.readFileSync(migrationPath, 'utf8');

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS planner_schema_versions');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS planner_boards');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS planner_apply_receipts');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS planner_academic_contexts');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS planner_proposals');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS planner_proposal_candidates');
    expect(migration).toContain('PRIMARY KEY (owner_hash, program_id)');
    expect(migration).toContain('UNIQUE (owner_hash, program_id, idempotency_key)');
    expect(migration).toContain('REFERENCES planner_proposals(proposal_id) ON DELETE CASCADE');
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|data\//i);
  });

  test.each([
    [[], 'missing'],
    [[{ version: PLANNER_SCHEMA_VERSION }], 'current'],
    [[{ version: PLANNER_SCHEMA_VERSION + 1 }], 'mismatch'],
    [[{ version: PLANNER_SCHEMA_VERSION - 1 }], 'mismatch'],
  ] as const)('reports schema rows %p as %s', async (rows, expected) => {
    const sql: PlannerSchemaSql = {
      unsafe: jest.fn().mockResolvedValue(rows),
    };

    await expect(checkPlannerSchema(sql)).resolves.toBe(expected);
    expect(sql.unsafe).toHaveBeenCalledTimes(1);
  });

  test('executes the reviewed migration as one explicit operation', async () => {
    const sql: PlannerSchemaSql = {
      unsafe: jest.fn().mockResolvedValue([]),
    };

    await migratePlannerSchema(sql, 'BEGIN; SELECT 1; COMMIT;');

    expect(sql.unsafe).toHaveBeenCalledWith('BEGIN; SELECT 1; COMMIT;');
  });
});
