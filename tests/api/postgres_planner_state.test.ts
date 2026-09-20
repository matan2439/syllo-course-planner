import {
  createPostgresPlannerState,
  type PlannerPostgresSql,
} from '../../api/ai/postgres/postgres_planner_state';
import { PostgresBoardRepository } from '../../api/ai/postgres/postgres_board_repository';
import { PostgresAcademicContextStore } from '../../api/ai/postgres/postgres_academic_context_store';
import { PostgresProposalStore } from '../../api/ai/postgres/postgres_proposal_store';
import { PostgresAuthoritativeApplyStore } from '../../api/ai/postgres/postgres_authoritative_apply_store';

const sql = (schemaRows: Record<string, unknown>[]): PlannerPostgresSql => ({
  unsafe: jest.fn().mockResolvedValue(schemaRows),
  begin: jest.fn(),
});

describe('Postgres planner state bundle', () => {
  test('creates every authoritative adapter over one shared SQL boundary', () => {
    const boundary = sql([{ version: 1 }]);
    const state = createPostgresPlannerState(boundary);

    expect(state.boardRepository).toBeInstanceOf(PostgresBoardRepository);
    expect(state.academicContextStore).toBeInstanceOf(PostgresAcademicContextStore);
    expect(state.proposalStore).toBeInstanceOf(PostgresProposalStore);
    expect(state.authoritativeApplyStore).toBeInstanceOf(PostgresAuthoritativeApplyStore);
  });

  test.each([
    [[], 'PLANNER_SCHEMA_MISMATCH'],
    [[{ version: 2 }], 'PLANNER_SCHEMA_MISMATCH'],
  ] as const)('fails closed for incompatible schema rows %p', async (rows, code) => {
    const state = createPostgresPlannerState(sql([...rows]));
    await expect(state.ensureSchemaCurrent()).rejects.toMatchObject({ code });
  });

  test('accepts the exact current planner schema', async () => {
    const state = createPostgresPlannerState(sql([{ version: 1 }]));
    await expect(state.ensureSchemaCurrent()).resolves.toBeUndefined();
  });
});
