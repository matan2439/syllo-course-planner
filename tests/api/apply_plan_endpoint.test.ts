/**
 * S2 — the authoritative Apply endpoint.
 *
 * The single property everything here serves: the committed board is built from
 * the SERVER's stored candidate, never from anything in the request. So the
 * suite drives the real `generate-plan` handler to create a real proposal, then
 * attacks the real `apply-plan` handler with fabricated ids, other people's
 * proposals, stale versions, replays and races.
 */
// Program-AWARE, so a second program is genuinely a different board with
// genuinely different candidate identities — otherwise a "foreign candidate"
// test would silently be handing back one of this proposal's own ids.
jest.mock('../../api/ai/board_loader', () => ({
  loadLocalBoardJson: jest.fn((programId: string) =>
    programId === OTHER_PROGRAM ? OTHER_BOARD : BOARD),
}));
jest.mock('../../api/ai/evidence_loader', () => ({
  loadPreparedEvidenceDocuments: jest.fn(() => MOCK_DOCUMENTS),
}));

import generateHandler from '../../api/ai/generate-plan';
import applyHandler from '../../api/ai/apply-plan';
import { randomUUID } from 'crypto';
import { getBoardRepository, getProposalStore, resetApplyRuntime } from '../../api/ai/apply_runtime';
import { SESSION_COOKIE } from '../../api/ai/session_owner';
import type { SyllabusDocument } from '../../api/ai/syllabus_source';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';
const YEAR = 2027;
const ELECTIVES = ['E1', 'E2', 'E3', 'E4'];
const PROGRAM = 'test_program_grounded_preview_2027';

const BOARD = {
  semesters: [SEM_A, SEM_B].map((id) => ({ semester_id: id, courses: [] })),
  metadata: {
    board_data_version: 'apply-endpoint-1',
    completed_course_ids: [],
    program_requirements_categories: { total_required_hours: 8, categories: [] },
    program_repository_courses: ELECTIVES.map((id) => ({
      course_id: id, name_he: `קורס ${id}`, weekly_hours: 4, is_mandatory: false,
      course_type: 'elective', placement_policy: 'elective',
      offered_semesters: [SEM_A, SEM_B], prerequisites: [],
    })),
  },
};

const OTHER_PROGRAM = 'test_program_other_2027';
/** A disjoint course universe, so its candidate identities cannot collide. */
const OTHER_BOARD = {
  semesters: [SEM_A, SEM_B].map((id) => ({ semester_id: id, courses: [] })),
  metadata: {
    board_data_version: 'apply-endpoint-other-1',
    completed_course_ids: [],
    program_requirements_categories: { total_required_hours: 8, categories: [] },
    program_repository_courses: ['X1', 'X2'].map((id) => ({
      course_id: id, name_he: `קורס ${id}`, weekly_hours: 4, is_mandatory: false,
      course_type: 'elective', placement_policy: 'elective',
      offered_semesters: [SEM_A, SEM_B], prerequisites: [],
    })),
  },
};

const CONTENT: Record<string, string> = {
  E1: 'תכן הנדסי בלבד.',
  E2: 'תכן הנדסי בלבד.',
  E3: 'תכן הנדסי, הכרת זרוע רובוטית, קינמטיקה ישירה והפוכה, זיהוי מערכת, משוב כוח.',
  E4: 'תכן הנדסי, מעבר חום וזרימה במחליפי החום.',
};
const DELIVERY: Record<string, string> = { E1: 'שיעור', E2: 'פרוייקט', E3: 'שיעור', E4: 'מעבדה' };
const doc = (courseId: string): SyllabusDocument => ({
  institutionId: 'tau.ac.il', courseId, academicYear: YEAR,
  sourceUrl: `https://ims.tau.ac.il/x?course=${courseId}`,
  contentHash: `sha_apply_${courseId}`, retrievedAt: '2026-08-15T00:00:00.000Z',
  labeledFields: { 'מספר קורס': [courseId], 'אופן ההוראה': [DELIVERY[courseId]] },
  text: `אופן ההוראה ${DELIVERY[courseId]} תוכן הקורס ומטרתו ${CONTENT[courseId]} מטלות הקורס`,
});
let MOCK_DOCUMENTS: SyllabusDocument[] = [];

function makeRes() {
  const res: any = {
    statusCode: 0, _headers: {} as Record<string, unknown>,
    setHeader: jest.fn(function (this: any, k: string, v: unknown) { this._headers[k] = v; return this; }),
    getHeader: jest.fn(function (this: any, k: string) { return this._headers[k]; }),
    status: jest.fn(function (this: any, c: number) { this.statusCode = c; return this; }),
    json: jest.fn(function (this: any, b: any) { this._body = b; return this; }),
    write: jest.fn(), end: jest.fn(),
  };
  return res;
}

const ACADEMIC_STATUS = {
  completed: [], currently_taking: [],
  completed_knowledge: { status: 'known', provenance: 'explicit_user' },
};

async function generate(ownerCookie: string, over: Record<string, unknown> = {}) {
  const res = makeRes();
  await generateHandler({
    method: 'POST',
    headers: { cookie: `${SESSION_COOKIE}=${ownerCookie}` },
    body: {
      program_id: PROGRAM,
      plan_context: { personal_status: ACADEMIC_STATUS },
      preferences: { disallowed_course_ids: [] },
      session_token: randomUUID(),
      use_academic_decision_agent: true,
      preference_profile: { version: 3, preferences: [] },
      ...over,
    },
  } as any, res);
  return res;
}

async function apply(ownerCookie: string, body: Record<string, unknown>) {
  const res = makeRes();
  await applyHandler({
    method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${ownerCookie}` }, body, query: {},
  } as any, res);
  return res;
}

async function loadBoard(ownerCookie: string, programId = PROGRAM) {
  const res = makeRes();
  await applyHandler({
    method: 'GET', headers: { cookie: `${SESSION_COOKIE}=${ownerCookie}` }, query: { program_id: programId },
  } as any, res);
  return res;
}

const OWNER = 'o'.repeat(48);
const OTHER = 'p'.repeat(48);

/** A well-formed Apply for the given receipt + candidate. */
const applyBody = (receipt: any, candidateId: string, over: Record<string, unknown> = {}) => ({
  program_id: PROGRAM,
  proposal_id: receipt.proposalId,
  candidate_id: candidateId,
  expected_board_version: receipt.baseBoardVersion,
  expected_profile_version: receipt.profileVersion,
  idempotency_key: `idem_${candidateId}_${receipt.proposalId}`,
  academic_status: ACADEMIC_STATUS,
  ...over,
});

const receiptOf = (res: any) => res._body?.academicDecision?.proposal;
const altsOf = (res: any) => res._body?.academicDecision?.candidates?.alternatives ?? [];

beforeAll(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
afterAll(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });
beforeEach(() => { MOCK_DOCUMENTS = ELECTIVES.map(doc); resetApplyRuntime(); });

// ── the happy path, and what it actually commits ────────────────────────────

describe('S2 — a valid Apply commits the SERVER’s stored candidate', () => {
  test('it commits, mints v1, and returns the authoritative board', async () => {
    const gen = await generate(OWNER);
    const receipt = receiptOf(gen);
    const alternatives = altsOf(gen);
    expect(alternatives.length).toBeGreaterThanOrEqual(2);

    // Deliberately NOT the recommendation — the student's actual choice.
    const chosen = alternatives.find((a: any) => !a.recommended)!;
    const res = await apply(OWNER, applyBody(receipt, chosen.candidateId));

    expect(res.statusCode).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(res._body.replayed).toBe(false);
    expect(res._body.appliedCandidateId).toBe(chosen.candidateId);
    expect(res._body.board.version).toBe('bv_1');
    // The committed content is the stored plan for that candidate.
    const stored = (await getProposalStore().get(receipt.proposalId))!
      .candidates.find((c) => c.candidateId === chosen.candidateId)!;
    expect(res._body.board.semesters).toEqual(stored.semesters);
  });

  test('a plan in the request body is REFUSED, not ignored', async () => {
    const gen = await generate(OWNER);
    const receipt = receiptOf(gen);
    const chosen = altsOf(gen)[0];

    const res = await apply(OWNER, applyBody(receipt, chosen.candidateId, {
      semesters: [{ semesterId: SEM_A, courseIds: ['HOSTILE'] }],
    }));
    // Silently ignoring it would let a caller believe they had influenced the
    // commit; the schema is strict, so it is a typed rejection.
    expect(res.statusCode).toBe(400);
    expect(res._body.code).toBe('INVALID_REQUEST');
    expect(await getBoardRepository().load(OWNER, PROGRAM)).toBeNull();
  });

  test('the committed board reads back for the same session', async () => {
    const gen = await generate(OWNER);
    const chosen = altsOf(gen).find((a: any) => !a.recommended)!;
    await apply(OWNER, applyBody(receiptOf(gen), chosen.candidateId));

    const read = await loadBoard(OWNER);
    expect(read._body.ok).toBe(true);
    expect(read._body.board.version).toBe('bv_1');
    expect(read._body.board.semesters).toEqual(chosen.semesters);
  });

  test('a second Apply from the NEW base version commits on top', async () => {
    const gen1 = await generate(OWNER);
    const first = altsOf(gen1)[0];
    const applied = await apply(OWNER, applyBody(receiptOf(gen1), first.candidateId));
    expect(applied._body.board.version).toBe('bv_1');

    // A fresh Generate now sees the committed board as its base.
    const gen2 = await generate(OWNER);
    expect(receiptOf(gen2).baseBoardVersion).toBe('bv_1');
    const second = altsOf(gen2)[0];
    const res = await apply(OWNER, applyBody(receiptOf(gen2), second.candidateId));
    expect(res._body.ok).toBe(true);
    expect(res._body.board.version).toBe('bv_2');
  });
});

// ── rejections ──────────────────────────────────────────────────────────────

describe('S2 — every rejection is typed and changes nothing', () => {
  test('a FABRICATED candidate id is rejected', async () => {
    const gen = await generate(OWNER);
    const res = await apply(OWNER, applyBody(receiptOf(gen), 'cand_deadbeef'));
    expect(res.statusCode).toBe(409);
    expect(res._body.code).toBe('CANDIDATE_NOT_IN_PROPOSAL');
    expect(await getBoardRepository().load(OWNER, PROGRAM)).toBeNull();
  });

  test('a candidate from ANOTHER proposal is rejected', async () => {
    const mine = await generate(OWNER);
    // A second Generate for a different program yields ids not in `mine`.
    const other = await generate(OWNER, { program_id: OTHER_PROGRAM });
    const foreignId = receiptOf(other)?.candidateIds?.[0];
    expect(foreignId).toBeTruthy();
    // The premise: it really is not one of mine.
    expect(receiptOf(mine).candidateIds).not.toContain(foreignId);

    const res = await apply(OWNER, applyBody(receiptOf(mine), foreignId));
    expect(res._body.ok).toBe(false);
    expect(res._body.code).toBe('CANDIDATE_NOT_IN_PROPOSAL');
  });

  test('another SESSION cannot apply my proposal, and learns nothing about it', async () => {
    const gen = await generate(OWNER);
    const chosen = altsOf(gen)[0];
    const res = await apply(OTHER, applyBody(receiptOf(gen), chosen.candidateId));

    // Same shape as a genuine not-found: never confirm someone else's record.
    expect(res.statusCode).toBe(404);
    expect(res._body.code).toBe('SESSION_MISMATCH');
    expect(JSON.stringify(res._body)).not.toContain(chosen.candidateId);
    expect(await getBoardRepository().load(OWNER, PROGRAM)).toBeNull();
    expect(await getBoardRepository().load(OTHER, PROGRAM)).toBeNull();
  });

  test('a SUPERSEDED proposal is rejected', async () => {
    const first = await generate(OWNER);
    const chosen = altsOf(first)[0];
    await generate(OWNER); // supersedes the first

    const res = await apply(OWNER, applyBody(receiptOf(first), chosen.candidateId));
    expect(res.statusCode).toBe(409);
    expect(res._body.code).toBe('PROPOSAL_SUPERSEDED');
  });

  test('an UNKNOWN proposal id is rejected', async () => {
    const gen = await generate(OWNER);
    const res = await apply(OWNER, applyBody({ ...receiptOf(gen), proposalId: 'prop_nope' }, altsOf(gen)[0].candidateId));
    expect(res.statusCode).toBe(404);
    expect(res._body.code).toBe('PROPOSAL_NOT_FOUND');
  });

  test('a STALE PROFILE version is rejected', async () => {
    const gen = await generate(OWNER);
    const chosen = altsOf(gen)[0];
    const res = await apply(OWNER, applyBody(receiptOf(gen), chosen.candidateId, {
      expected_profile_version: 999,
    }));
    expect(res.statusCode).toBe(409);
    expect(res._body.code).toBe('PROFILE_VERSION_MISMATCH');
  });

  test('a CHANGED academic status is rejected', async () => {
    const gen = await generate(OWNER);
    const chosen = altsOf(gen)[0];
    const res = await apply(OWNER, applyBody(receiptOf(gen), chosen.candidateId, {
      academic_status: { ...ACADEMIC_STATUS, completed: [{ course_id: 'E1' }] },
    }));
    expect(res.statusCode).toBe(409);
    expect(res._body.code).toBe('ACADEMIC_STATUS_MISMATCH');
    expect(await getBoardRepository().load(OWNER, PROGRAM)).toBeNull();
  });

  test('a STALE BASE BOARD version is rejected and reports the current one', async () => {
    const gen = await generate(OWNER);
    const chosen = altsOf(gen)[0];
    const res = await apply(OWNER, applyBody(receiptOf(gen), chosen.candidateId, {
      expected_board_version: 'bv_41',
    }));
    expect(res.statusCode).toBe(409);
    expect(res._body.code).toBe('BOARD_VERSION_CONFLICT');
    expect(res._body.currentBoardVersion).toBeNull();
  });

  test('a proposal whose base board has since moved on is rejected', async () => {
    // Two proposals, both planned on top of "no board yet".
    const genA = await generate(OWNER);
    const stale = altsOf(genA)[0];
    const staleReceipt = receiptOf(genA);
    const genB = await generate(OWNER);

    // B commits first, so the board is now v1.
    await apply(OWNER, applyBody(receiptOf(genB), altsOf(genB)[0].candidateId));

    // A is both superseded AND based on a board version that no longer exists.
    const res = await apply(OWNER, applyBody(staleReceipt, stale.candidateId));
    expect(res._body.ok).toBe(false);
    expect(['PROPOSAL_SUPERSEDED', 'BOARD_VERSION_CONFLICT']).toContain(res._body.code);
    expect((await getBoardRepository().load(OWNER, PROGRAM))!.version).toBe('bv_1');
  });

  test('a malformed request is rejected without touching anything', async () => {
    const res = await apply(OWNER, { program_id: PROGRAM });
    expect(res.statusCode).toBe(400);
    expect(res._body.code).toBe('INVALID_REQUEST');
  });

  test('every rejection carries readable Hebrew and no internals', async () => {
    const gen = await generate(OWNER);
    const res = await apply(OWNER, applyBody(receiptOf(gen), 'cand_nope'));
    expect(typeof res._body.message_he).toBe('string');
    expect(res._body.message_he.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(res._body);
    expect(serialized).not.toMatch(/stack|Error:|at Object|node_modules|ownerId|sha_/);
  });

  test('GET without a program id is a typed rejection', async () => {
    const res = makeRes();
    await applyHandler({ method: 'GET', headers: {}, query: {} } as any, res);
    expect(res.statusCode).toBe(400);
    expect(res._body.code).toBe('INVALID_REQUEST');
  });

  test('an unsupported method is rejected', async () => {
    const res = makeRes();
    await applyHandler({ method: 'DELETE', headers: {}, query: {} } as any, res);
    expect(res.statusCode).toBe(405);
  });
});

// ── atomicity and idempotency ───────────────────────────────────────────────

describe('S2 — atomicity and idempotency', () => {
  test('a valid Apply increments the board version exactly once', async () => {
    const gen = await generate(OWNER);
    const chosen = altsOf(gen)[0];
    await apply(OWNER, applyBody(receiptOf(gen), chosen.candidateId));
    expect((await getBoardRepository().load(OWNER, PROGRAM))!.version).toBe('bv_1');
  });

  test('a duplicate IDENTICAL request replays: same board, no second mutation', async () => {
    const gen = await generate(OWNER);
    const chosen = altsOf(gen)[0];
    const body = applyBody(receiptOf(gen), chosen.candidateId);

    const first = await apply(OWNER, body);
    const second = await apply(OWNER, body); // byte-identical retry

    expect(first._body.ok).toBe(true);
    expect(second._body.ok).toBe(true);
    expect(second._body.replayed).toBe(true);
    expect(second._body.board.version).toBe(first._body.board.version);
    expect((await getBoardRepository().load(OWNER, PROGRAM))!.version).toBe('bv_1');
  });

  test('the same idempotency key carrying a DIFFERENT candidate fails deterministically', async () => {
    const gen = await generate(OWNER);
    const alternatives = altsOf(gen);
    const body = applyBody(receiptOf(gen), alternatives[0].candidateId);
    await apply(OWNER, body);

    const smuggled = await apply(OWNER, { ...body, candidate_id: alternatives[1].candidateId });
    expect(smuggled._body.ok).toBe(false);
    expect(['IDEMPOTENCY_CONFLICT', 'BOARD_VERSION_CONFLICT']).toContain(smuggled._body.code);
    // Whatever the code, the board still holds the FIRST candidate.
    const board = (await getBoardRepository().load(OWNER, PROGRAM))!;
    expect(board.version).toBe('bv_1');
    expect(board.lastApply?.candidateId).toBe(alternatives[0].candidateId);
  });

  test('two different candidates racing from ONE base version: exactly one commits', async () => {
    const gen = await generate(OWNER);
    const alternatives = altsOf(gen);
    const receipt = receiptOf(gen);

    const [a, b] = await Promise.all([
      apply(OWNER, applyBody(receipt, alternatives[0].candidateId, { idempotency_key: 'race_a_key' })),
      apply(OWNER, applyBody(receipt, alternatives[1].candidateId, { idempotency_key: 'race_b_key' })),
    ]);

    const winners = [a, b].filter((r) => r._body.ok);
    expect(winners).toHaveLength(1);

    // The committed board is exactly ONE of the two stored plans, never a merge.
    const board = (await getBoardRepository().load(OWNER, PROGRAM))!;
    expect(board.version).toBe('bv_1');
    const stored = (await getProposalStore().get(receipt.proposalId))!.candidates;
    const matches = stored.filter((c) => JSON.stringify(c.semesters) === JSON.stringify(board.semesters));
    expect(matches).toHaveLength(1);
    expect(board.lastApply?.candidateId).toBe(matches[0].candidateId);
  });
});

// ── session isolation ───────────────────────────────────────────────────────

describe('S2 — sessions are isolated', () => {
  test('one session’s committed board is invisible to another', async () => {
    const gen = await generate(OWNER);
    await apply(OWNER, applyBody(receiptOf(gen), altsOf(gen)[0].candidateId));

    const mine = await loadBoard(OWNER);
    const theirs = await loadBoard(OTHER);
    expect(mine._body.board.version).toBe('bv_1');
    expect(theirs._body.board).toBeNull();
  });

  test('a session with no board is told so honestly, not given an empty fake', async () => {
    const res = await loadBoard('n'.repeat(48));
    expect(res._body.ok).toBe(true);
    expect(res._body.board).toBeNull();
  });

  test('a request with NO cookie is issued a session and owns nothing yet', async () => {
    const res = makeRes();
    await applyHandler({ method: 'GET', headers: {}, query: { program_id: PROGRAM } } as any, res);
    expect(res._body.board).toBeNull();
    expect(String((res._headers['Set-Cookie'] as string[])[0])).toContain(SESSION_COOKIE);
  });

  test('the response discloses which storage kind is actually in use', async () => {
    const res = await loadBoard(OWNER);
    expect(['memory', 'file']).toContain(res._body.storage);
  });
});
