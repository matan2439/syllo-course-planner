/**
 * S0 — RED: there is no authoritative server Apply.
 *
 * The C5 session established, by tracing the persistence boundary, that Apply
 * mutates React state and nothing else. This suite states the same gap as a
 * CAPABILITY assertion against the real handlers, so it fails for behavioural
 * reasons rather than because a module is missing:
 *
 *   1. a successful Generate leaves the server holding NOTHING it could later
 *      re-resolve — no proposal id reaches the client, so there is no handle
 *      by which an Apply could name a server-validated candidate;
 *   2. consequently the only thing a client could send at Apply time is the
 *      plan itself, which is exactly what must not be trusted;
 *   3. and no committed board exists server-side for a session to re-read, so
 *      nothing can survive a refresh.
 *
 * Each assertion below is about what the SERVER retains and returns. None of
 * them names a module that does not exist yet.
 */
jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn(() => BOARD) }));
jest.mock('../../api/ai/evidence_loader', () => ({
  loadPreparedEvidenceDocuments: jest.fn(() => []),
}));

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';
const ELECTIVES = ['E1', 'E2', 'E3', 'E4'];

const BOARD = {
  semesters: [SEM_A, SEM_B].map((id) => ({ semester_id: id, courses: [] })),
  metadata: {
    board_data_version: 'apply-authority-1',
    completed_course_ids: [],
    program_requirements_categories: { total_required_hours: 8, categories: [] },
    program_repository_courses: ELECTIVES.map((id) => ({
      course_id: id, name_he: `קורס ${id}`, weekly_hours: 4, is_mandatory: false,
      course_type: 'elective', placement_policy: 'elective',
      offered_semesters: [SEM_A, SEM_B], prerequisites: [],
    })),
  },
};

function makeRes() {
  const res: any = {
    statusCode: 0, setHeader: jest.fn().mockReturnThis(),
    status: jest.fn(function (this: any, c: number) { this.statusCode = c; return this; }),
    json: jest.fn(function (this: any, b: any) { this._body = b; return this; }),
    write: jest.fn(), end: jest.fn(),
  };
  return res;
}
async function generate(body: any) {
  const res = makeRes();
  await handler({ method: 'POST', body, headers: {} } as any, res);
  return res;
}

const request = (over: Record<string, unknown> = {}) => ({
  program_id: 'test_program_grounded_preview_2027',
  // Completed-course status resolved legitimately, exactly as the journey sends
  // it once the student confirms — otherwise the handler correctly asks for
  // clarification and there is no proposal to be authoritative about.
  plan_context: {
    personal_status: {
      completed: [], currently_taking: [],
      completed_knowledge: { status: 'known', provenance: 'explicit_user' },
    },
  },
  preferences: { disallowed_course_ids: [] },
  session_token: randomUUID(),
  use_academic_decision_agent: true,
  preference_profile: { version: 1, preferences: [] },
  ...over,
});

beforeAll(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
afterAll(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });

/**
 * The capability the epic must deliver, stated as one integration property:
 * a Generate must hand back a handle the SERVER can later resolve to the exact
 * validated candidate set it produced.
 */
describe('S0 — the server retains no authoritative proposal', () => {
  test('a successful Generate returns a server proposal receipt', async () => {
    const res = await generate(request());
    expect(res.statusCode).toBe(200);

    const decision = res._body?.academicDecision;
    expect(decision?.outcome).toBe('proposal');

    // A handle by which Apply could name a server-held candidate set.
    const receipt = decision?.proposal;
    expect(receipt).toBeDefined();
    expect(typeof receipt?.proposalId).toBe('string');
    expect(receipt.proposalId.length).toBeGreaterThan(0);
    // …and the candidate ids the server will accept, so the client never has to
    // send a plan.
    expect(Array.isArray(receipt?.candidateIds)).toBe(true);
    expect(receipt.candidateIds.length).toBeGreaterThan(0);
    // …bound to the versions an Apply must still match. `null` is the correct
    // base version for a session that has never committed a board — it is a
    // real expected value, not a missing one.
    expect(receipt).toHaveProperty('baseBoardVersion');
    expect(receipt.baseBoardVersion === null || typeof receipt.baseBoardVersion === 'string').toBe(true);
    expect(typeof receipt?.profileVersion).toBe('number');
    expect(typeof receipt?.expiresAt).toBe('number');
    // The receipt carries NO plan: the client cannot become the source of truth
    // by echoing one back.
    expect(JSON.stringify(receipt)).not.toContain('semester');
  });

  test('the proposal is owned by a server-issued session, not a client-chosen key', async () => {
    const res = await generate(request());
    const receipt = res._body?.academicDecision?.proposal;
    expect(receipt).toBeDefined();
    // The owner must NOT be the client-supplied session_token: a caller that
    // picks its own ownership key can claim any other caller's proposals.
    expect(receipt?.ownerId).toBeUndefined();
    // Instead the server must have issued its own session identity.
    const setCookie = res.setHeader.mock.calls.find((c: unknown[]) => String(c[0]).toLowerCase() === 'set-cookie');
    expect(setCookie).toBeDefined();
  });
});
