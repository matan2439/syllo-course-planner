const atomicApply = jest.fn();
const ensurePlannerStorageReady = jest.fn();
const legacyLoad = jest.fn();
const legacyCommit = jest.fn();
const legacyProposalGet = jest.fn();

jest.mock('../../api/ai/apply_runtime', () => ({
  academicStatusDigest: jest.fn(() => 'as_expected'),
  ensurePlannerStorageReady,
  getAuthoritativeApplyStore: jest.fn(() => ({ apply: atomicApply })),
  getBoardRepository: jest.fn(() => ({ load: legacyLoad, commit: legacyCommit })),
  getProposalStore: jest.fn(() => ({ get: legacyProposalGet })),
  storageKind: jest.fn(() => 'postgres'),
}));

jest.mock('../../api/ai/authoritative_candidate_validation', () => ({
  validateAuthoritativeCandidate: jest.fn(async () => ({
    valid: true,
    constraintFingerprint: 'cf_expected',
  })),
}), { virtual: true });

import handler from '../../api/ai/apply-plan';
import { SESSION_COOKIE } from '../../api/ai/session_owner';

function response() {
  return {
    statusCode: 0,
    headersSent: false,
    _body: undefined as unknown,
    _headers: {} as Record<string, unknown>,
    setHeader: jest.fn(function (this: any, key: string, value: unknown) {
      this._headers[key] = value;
      return this;
    }),
    getHeader: jest.fn(function (this: any, key: string) { return this._headers[key]; }),
    status: jest.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
    json: jest.fn(function (this: any, body: unknown) { this._body = body; return this; }),
  } as any;
}

describe('Postgres Apply handler dispatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    atomicApply.mockResolvedValue({
      ok: true,
      replayed: false,
      proposalId: 'prop_1',
      candidateId: 'cand_1',
      board: {
        ownerId: 's'.repeat(48),
        programId: 'tau_mechanical_engineering_2027',
        version: 'bv_1',
        semesters: [{ semesterId: 'year_3_semester_a', courseIds: ['0368-3001'] }],
        updatedAt: 1,
      },
    });
  });

  test('routes POST through one authoritative atomic store operation', async () => {
    const ownerId = 's'.repeat(48);
    const res = response();
    await handler({
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE}=${ownerId}` },
      query: {},
      body: {
        program_id: 'tau_mechanical_engineering_2027',
        proposal_id: 'prop_1',
        candidate_id: 'cand_1',
        expected_board_version: null,
        expected_profile_version: 4,
        idempotency_key: 'idem_apply_1',
        academic_status: { completed: [] },
      },
    } as any, res);

    expect(ensurePlannerStorageReady).toHaveBeenCalledTimes(1);
    expect(atomicApply).toHaveBeenCalledTimes(1);
    expect(atomicApply).toHaveBeenCalledWith(expect.objectContaining({
      ownerId,
      programId: 'tau_mechanical_engineering_2027',
      proposalId: 'prop_1',
      candidateId: 'cand_1',
      expectedBoardVersion: null,
      expectedProfileVersion: 4,
      expectedAcademicStatusDigest: 'as_expected',
      idempotencyKey: 'idem_apply_1',
      validateStoredCandidate: expect.any(Function),
    }));
    expect(legacyProposalGet).not.toHaveBeenCalled();
    expect(legacyLoad).not.toHaveBeenCalled();
    expect(legacyCommit).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res._body).toEqual(expect.objectContaining({
      ok: true,
      appliedProposalId: 'prop_1',
      appliedCandidateId: 'cand_1',
    }));
  });
});
