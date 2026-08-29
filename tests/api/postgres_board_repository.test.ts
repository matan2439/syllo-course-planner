import {
  PostgresBoardRepository,
  type PlannerBoardSql,
  type PlannerBoardTransaction,
} from '../../api/ai/postgres/postgres_board_repository';
import type { CommitInput } from '../../api/ai/board_repository';

type Row = Record<string, unknown>;

class BoardSqlDouble implements PlannerBoardSql, PlannerBoardTransaction {
  readonly executedQueries: string[] = [];
  private boards = new Map<string, Row>();
  private receipts = new Map<string, Row>();
  private queue: Promise<void> = Promise.resolve();

  async begin<T>(fn: (tx: PlannerBoardTransaction) => Promise<T>): Promise<T> {
    const prior = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await prior;
    const boards = structuredClone(this.boards);
    const receipts = structuredClone(this.receipts);
    try {
      return await fn(this);
    } catch (error) {
      this.boards = boards;
      this.receipts = receipts;
      throw error;
    } finally {
      release();
    }
  }

  async unsafe(query: string, parameters: readonly unknown[] = []): Promise<Row[]> {
    this.executedQueries.push(query);
    if (query.includes('pg_advisory_xact_lock')) return [];
    const key = `${parameters[0]}::${parameters[1]}`;
    if (query.includes('FROM planner_apply_receipts')) {
      const row = this.receipts.get(`${key}::${parameters[2]}`);
      return row ? [structuredClone(row)] : [];
    }
    if (query.includes('FROM planner_boards')) {
      const row = this.boards.get(key);
      return row ? [structuredClone(row)] : [];
    }
    if (query.includes('INSERT INTO planner_boards')) {
      const [ownerHash, programId, versionNumber, semesters, proposalId,
        candidateId, idempotencyKey, appliedAt] = parameters;
      const row = {
        owner_hash: ownerHash, program_id: programId, version_number: versionNumber,
        semesters_json: JSON.parse(String(semesters)), updated_at: new Date(Number(appliedAt)),
        last_proposal_id: proposalId, last_candidate_id: candidateId,
        last_idempotency_key: idempotencyKey, last_applied_at: new Date(Number(appliedAt)),
      };
      this.boards.set(key, row);
      return [structuredClone(row)];
    }
    if (query.includes('INSERT INTO planner_apply_receipts')) {
      const [ownerHash, programId, idempotencyKey, proposalId, candidateId,
        versionNumber, boardJson, appliedAt] = parameters;
      this.receipts.set(`${ownerHash}::${programId}::${idempotencyKey}`, {
        owner_hash: ownerHash, program_id: programId, idempotency_key: idempotencyKey,
        proposal_id: proposalId, candidate_id: candidateId,
        produced_version_number: versionNumber,
        committed_board_json: JSON.parse(String(boardJson)),
        applied_at: new Date(Number(appliedAt)),
      });
      return [];
    }
    throw new Error(`Unexpected query: ${query}`);
  }
}

const OWNER = 'A'.repeat(43);
const PROGRAM = 'mechanical_engineering_2027';
const input = (overrides: Partial<CommitInput> = {}): CommitInput => ({
  ownerId: OWNER,
  programId: PROGRAM,
  expectedVersion: null,
  semesters: [{ semesterId: 'B', courseIds: ['C2', 'C1', 'C1'] }],
  proposalId: 'prop_1',
  candidateId: 'cand_1',
  idempotencyKey: 'apply_1',
  ...overrides,
});

describe('PostgresBoardRepository', () => {
  test('persists a normalized repository-minted board across instances', async () => {
    const sql = new BoardSqlDouble();
    const committed = await new PostgresBoardRepository(sql, { clock: () => 1_800_000_000_000 })
      .commit(input());
    expect(committed).toMatchObject({ ok: true, replayed: false, board: { version: 'bv_1' } });

    expect(await new PostgresBoardRepository(sql).load(OWNER, PROGRAM)).toMatchObject({
      version: 'bv_1',
      semesters: [{ semesterId: 'B', courseIds: ['C1', 'C2'] }],
      lastApply: { proposalId: 'prop_1', candidateId: 'cand_1' },
    });
  });

  test('identical retry returns the original committed result without incrementing', async () => {
    const sql = new BoardSqlDouble();
    const repo = new PostgresBoardRepository(sql, { clock: () => 1_800_000_000_000 });
    const first = await repo.commit(input());
    const retry = await repo.commit(input());

    expect(retry).toEqual(first.ok ? { ...first, replayed: true } : first);
    expect((await repo.load(OWNER, PROGRAM))?.version).toBe('bv_1');
  });

  test('rejects incompatible idempotency reuse and stale base versions', async () => {
    const sql = new BoardSqlDouble();
    const repo = new PostgresBoardRepository(sql);
    await repo.commit(input());

    await expect(repo.commit(input({ candidateId: 'hostile' }))).resolves.toMatchObject({
      ok: false, reason: 'IDEMPOTENCY_CONFLICT',
    });
    await expect(repo.commit(input({ idempotencyKey: 'apply_2', expectedVersion: null })))
      .resolves.toMatchObject({ ok: false, reason: 'BOARD_VERSION_CONFLICT' });
    expect((await repo.load(OWNER, PROGRAM))?.version).toBe('bv_1');
  });

  test('allows exactly one of two concurrent commits from the same base version', async () => {
    const sql = new BoardSqlDouble();
    const repo = new PostgresBoardRepository(sql);
    const [left, right] = await Promise.all([
      repo.commit(input({ candidateId: 'left', idempotencyKey: 'left' })),
      repo.commit(input({ candidateId: 'right', idempotencyKey: 'right' })),
    ]);

    expect([left, right].filter((result) => result.ok)).toHaveLength(1);
    expect((await repo.load(OWNER, PROGRAM))?.version).toBe('bv_1');
    expect(sql.executedQueries.some((query) => query.includes('pg_advisory_xact_lock'))).toBe(true);
  });

  test('isolates owners and programs', async () => {
    const sql = new BoardSqlDouble();
    const repo = new PostgresBoardRepository(sql);
    await repo.commit(input());

    expect(await repo.load('B'.repeat(43), PROGRAM)).toBeNull();
    expect(await repo.load(OWNER, 'electrical_engineering_2027')).toBeNull();
  });
});
