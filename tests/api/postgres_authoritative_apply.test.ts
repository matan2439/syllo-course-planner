import {
  PostgresAuthoritativeApplyStore,
  type PlannerAtomicApplySql,
  type PlannerAtomicApplyTransaction,
} from '../../api/ai/postgres/postgres_authoritative_apply_store';

type Row = Record<string, unknown>;

class AtomicApplySqlDouble implements PlannerAtomicApplySql, PlannerAtomicApplyTransaction {
  readonly writes: string[] = [];
  proposal: Row | null = {
    proposal_id: 'prop_1', program_id: 'mechanical_engineering_2027',
    created_at: new Date(1_799_999_000_000), expires_at: new Date(1_800_007_200_000),
    superseded_by: null, base_board_version: null, profile_version: 4,
    academic_status_digest: 'as_123', constraint_fingerprint: 'constraints_123',
    apply_eligible: true,
  };
  candidate: Row | null = {
    candidate_id: 'cand_1',
    semesters_json: [{ semesterId: 'A', courseIds: ['C1'] }],
    normalized_identity: '[["C1","A"]]', valid: true, applyable: true,
  };
  board: Row | null = null;
  receipt: Row | null = null;

  async begin<T>(fn: (tx: PlannerAtomicApplyTransaction) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async unsafe(query: string): Promise<Row[]> {
    if (query.includes('pg_advisory_xact_lock')) return [];
    if (query.includes('FROM planner_apply_receipts')) return this.receipt ? [this.receipt] : [];
    if (query.includes('FROM planner_proposals')) return this.proposal ? [this.proposal] : [];
    if (query.includes('FROM planner_proposal_candidates')) return this.candidate ? [this.candidate] : [];
    if (query.includes('FROM planner_boards')) return this.board ? [this.board] : [];
    if (query.includes('INSERT INTO planner_boards')) { this.writes.push('board'); return []; }
    if (query.includes('INSERT INTO planner_apply_receipts')) { this.writes.push('receipt'); return []; }
    throw new Error(`Unexpected query: ${query}`);
  }
}

const request = () => ({
  ownerId: 'A'.repeat(43),
  programId: 'mechanical_engineering_2027',
  proposalId: 'prop_1',
  candidateId: 'cand_1',
  expectedBoardVersion: null,
  expectedProfileVersion: 4,
  expectedAcademicStatusDigest: 'as_123',
  idempotencyKey: 'apply-request-1',
  now: 1_800_000_000_000,
  validateStoredCandidate: () => ({ valid: true, constraintFingerprint: 'constraints_123' }),
});

describe('PostgresAuthoritativeApplyStore', () => {
  test('commits the stored candidate and receipt in one transaction', async () => {
    const sql = new AtomicApplySqlDouble();
    const result = await new PostgresAuthoritativeApplyStore(sql).apply(request());

    expect(result).toMatchObject({
      ok: true,
      replayed: false,
      proposalId: 'prop_1',
      candidateId: 'cand_1',
      board: {
        version: 'bv_1',
        semesters: [{ semesterId: 'A', courseIds: ['C1'] }],
      },
    });
    expect(sql.writes).toEqual(['board', 'receipt']);
  });

  test('rejects a fabricated candidate before any board mutation', async () => {
    const sql = new AtomicApplySqlDouble();
    sql.candidate = null;

    await expect(new PostgresAuthoritativeApplyStore(sql).apply({
      ...request(), candidateId: 'fabricated',
    })).resolves.toEqual({ ok: false, reason: 'CANDIDATE_NOT_IN_PROPOSAL' });
    expect(sql.writes).toEqual([]);
  });

  test('rejects a stored candidate whose normalized identity no longer matches its plan', async () => {
    const sql = new AtomicApplySqlDouble();
    sql.candidate = { ...sql.candidate!, normalized_identity: 'tampered-identity' };

    await expect(new PostgresAuthoritativeApplyStore(sql).apply(request())).resolves.toEqual({
      ok: false,
      reason: 'CANDIDATE_IDENTITY_MISMATCH',
    });
    expect(sql.writes).toEqual([]);
  });

  test('returns the locked authoritative board when the expected base is stale', async () => {
    const sql = new AtomicApplySqlDouble();
    sql.proposal = { ...sql.proposal!, base_board_version: 'bv_2' };
    sql.board = {
      program_id: 'mechanical_engineering_2027',
      version_number: 2,
      semesters_json: [{ semesterId: 'A', courseIds: ['CURRENT'] }],
      updated_at: new Date(1_799_999_900_000),
      last_proposal_id: 'prop_previous',
      last_candidate_id: 'cand_previous',
      last_idempotency_key: 'apply-previous',
      last_applied_at: new Date(1_799_999_900_000),
    };

    await expect(new PostgresAuthoritativeApplyStore(sql).apply({
      ...request(), expectedBoardVersion: 'bv_1',
    })).resolves.toMatchObject({
      ok: false,
      reason: 'BOARD_VERSION_CONFLICT',
      board: {
        version: 'bv_2',
        semesters: [{ semesterId: 'A', courseIds: ['CURRENT'] }],
      },
    });
    expect(sql.writes).toEqual([]);
  });

  test('revalidates the stored plan and rejects it when authoritative validation no longer passes', async () => {
    const sql = new AtomicApplySqlDouble();
    const validateStoredCandidate = jest.fn().mockReturnValue({
      valid: false,
      constraintFingerprint: 'constraints_123',
    });

    await expect(new PostgresAuthoritativeApplyStore(sql).apply({
      ...request(), validateStoredCandidate,
    })).resolves.toEqual({ ok: false, reason: 'CANDIDATE_NOT_APPLYABLE' });
    expect(validateStoredCandidate).toHaveBeenCalledWith([
      { semesterId: 'A', courseIds: ['C1'] },
    ]);
    expect(sql.writes).toEqual([]);
  });

  test('rejects a candidate when current authoritative constraints have a different fingerprint', async () => {
    const sql = new AtomicApplySqlDouble();

    await expect(new PostgresAuthoritativeApplyStore(sql).apply({
      ...request(),
      validateStoredCandidate: () => ({
        valid: true,
        constraintFingerprint: 'constraints_changed',
      }),
    })).resolves.toEqual({ ok: false, reason: 'CONSTRAINT_FINGERPRINT_MISMATCH' });
    expect(sql.writes).toEqual([]);
  });

  test('replays an identical receipt once and cannot take owner identity from stored JSON', async () => {
    const sql = new AtomicApplySqlDouble();
    sql.receipt = {
      proposal_id: 'prop_1',
      candidate_id: 'cand_1',
      committed_board_json: {
        ownerId: 'B'.repeat(43),
        programId: 'mechanical_engineering_2027',
        version: 'bv_1',
        semesters: [{ semesterId: 'A', courseIds: ['C1'] }],
        updatedAt: 1_800_000_000_000,
      },
    };

    await expect(new PostgresAuthoritativeApplyStore(sql).apply(request())).resolves.toMatchObject({
      ok: true,
      replayed: true,
      board: { ownerId: 'A'.repeat(43), version: 'bv_1' },
    });
    expect(sql.writes).toEqual([]);
  });

  test('rejects reuse of an idempotency key for a different candidate', async () => {
    const sql = new AtomicApplySqlDouble();
    sql.receipt = {
      proposal_id: 'prop_1',
      candidate_id: 'cand_original',
      committed_board_json: {},
    };

    await expect(new PostgresAuthoritativeApplyStore(sql).apply(request())).resolves.toEqual({
      ok: false,
      reason: 'IDEMPOTENCY_CONFLICT',
    });
    expect(sql.writes).toEqual([]);
  });

  test('fails closed when persisted proposal expiry is malformed', async () => {
    const sql = new AtomicApplySqlDouble();
    sql.proposal = { ...sql.proposal!, expires_at: 'not-a-timestamp' };

    await expect(new PostgresAuthoritativeApplyStore(sql).apply(request())).resolves.toEqual({
      ok: false,
      reason: 'PROPOSAL_EXPIRED',
    });
    expect(sql.writes).toEqual([]);
  });

  test.each([
    ['superseded proposal', { proposal: { superseded_by: 'prop_new' } }, {}, 'PROPOSAL_SUPERSEDED'],
    ['expired proposal', { proposal: { expires_at: new Date(1_799_999_999_999) } }, {}, 'PROPOSAL_EXPIRED'],
    ['stale profile', {}, { expectedProfileVersion: 5 }, 'PROFILE_VERSION_MISMATCH'],
    ['stale academic status', {}, { expectedAcademicStatusDigest: 'as_changed' }, 'ACADEMIC_STATUS_MISMATCH'],
    ['invalid candidate', { candidate: { valid: false } }, {}, 'CANDIDATE_NOT_APPLYABLE'],
  ])('rejects %s before mutation', async (_label, state, inputOverride, reason) => {
    const sql = new AtomicApplySqlDouble();
    if ('proposal' in state) sql.proposal = { ...sql.proposal!, ...state.proposal };
    if ('candidate' in state) sql.candidate = { ...sql.candidate!, ...state.candidate };

    await expect(new PostgresAuthoritativeApplyStore(sql).apply({
      ...request(),
      ...inputOverride,
    })).resolves.toMatchObject({ ok: false, reason });
    expect(sql.writes).toEqual([]);
  });
});
