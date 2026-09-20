/**
 * S1 — the server's own copy of what it decided.
 *
 * The property under test is not "a record exists" but "the record is the
 * authority": the plans it holds are the ones the server validated, the client
 * cannot add to them, and a newer Generate for the same owner and program
 * retires the older one so a stale tab cannot commit from it.
 */
jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn(() => BOARD) }));
jest.mock('../../api/ai/evidence_loader', () => ({
  loadPreparedEvidenceDocuments: jest.fn(() => MOCK_DOCUMENTS),
}));

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';
import { getAcademicContextStore, getProposalStore, resetApplyRuntime, academicStatusDigest } from '../../api/ai/apply_runtime';
import { checkProposalAccess, PROPOSAL_TTL_MS } from '../../api/ai/proposal_store';
import { SESSION_COOKIE } from '../../api/ai/session_owner';
import type { SyllabusDocument } from '../../api/ai/syllabus_source';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';
const YEAR = 2027;
const ELECTIVES = ['E1', 'E2', 'E3', 'E4'];

const BOARD = {
  semesters: [SEM_A, SEM_B].map((id) => ({ semester_id: id, courses: [] })),
  metadata: {
    board_data_version: 'proposal-authority-1',
    completed_course_ids: [],
    program_requirements_categories: { total_required_hours: 8, categories: [] },
    program_repository_courses: ELECTIVES.map((id) => ({
      course_id: id, name_he: `קורס ${id}`, weekly_hours: 4, is_mandatory: false,
      course_type: 'elective', placement_policy: 'elective',
      offered_semesters: [SEM_A, SEM_B], prerequisites: [],
    })),
  },
};

/** The committed alternatives-preview corpus: a real topic-vs-project trade-off. */
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
  contentHash: `sha_prop_${courseId}`, retrievedAt: '2026-08-15T00:00:00.000Z',
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

/** Drive Generate as a specific browser session (or as a brand-new one). */
async function generate(over: Record<string, unknown> = {}, ownerCookie?: string) {
  const res = makeRes();
  await handler({
    method: 'POST',
    headers: ownerCookie ? { cookie: `${SESSION_COOKIE}=${ownerCookie}` } : {},
    body: {
      program_id: 'test_program_grounded_preview_2027',
      plan_context: {
        personal_status: {
          completed: [], currently_taking: [],
          completed_knowledge: { status: 'known', provenance: 'explicit_user' },
        },
      },
      preferences: { disallowed_course_ids: [] },
      session_token: randomUUID(),
      use_academic_decision_agent: true,
      preference_profile: { version: 3, preferences: [] },
      ...over,
    },
  } as any, res);
  return res;
}

const receiptOf = (res: any) => res._body?.academicDecision?.proposal;
const altsOf = (res: any) => res._body?.academicDecision?.candidates?.alternatives ?? [];
const OWNER = 'o'.repeat(48);

beforeAll(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
afterAll(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });
beforeEach(() => { MOCK_DOCUMENTS = ELECTIVES.map(doc); resetApplyRuntime(); });

describe('S1 — Generate retains the exact validated candidate set', () => {
  test('stores the session-owned academic facts alongside a successful proposal', async () => {
    const personalStatus = {
      completed: [{ course_id: 'E1' }], currently_taking: [],
      completed_knowledge: { status: 'known', provenance: 'explicit_user' },
    };
    const res = await generate({ plan_context: { personal_status: personalStatus } }, OWNER);
    expect(receiptOf(res)).toBeDefined();
    expect(await getAcademicContextStore().load(OWNER, 'test_program_grounded_preview_2027'))
      .toEqual(expect.objectContaining({
        ownerId: OWNER,
        digest: academicStatusDigest(personalStatus),
        personalStatus,
        planContext: { personal_status: personalStatus },
        preferences: { disallowed_course_ids: [] },
      }));
  });

  test('the stored record holds the SAME plans the response showed', async () => {
    const res = await generate({}, OWNER);
    const receipt = receiptOf(res);
    expect(receipt).toBeDefined();

    const stored = await getProposalStore().get(receipt.proposalId);
    expect(stored).not.toBeNull();
    expect(stored!.ownerId).toBe(OWNER);

    const alternatives = altsOf(res);
    expect(alternatives.length).toBeGreaterThanOrEqual(2);
    expect(stored!.candidates.map((c) => c.candidateId).sort())
      .toEqual(alternatives.map((a: any) => a.candidateId).sort());

    // Plan-for-plan identity: the server's copy is what was validated, so an
    // Apply resolving from it can never commit something else.
    for (const alt of alternatives) {
      const mine = stored!.candidates.find((c) => c.candidateId === alt.candidateId)!;
      expect(mine.semesters).toEqual(alt.semesters);
      expect(mine.normalizedIdentity).toBe(alt.normalizedIdentity);
      expect(mine.applyable).toBe(alt.applyable);
    }
  });

  test('the receipt maps to the record and carries no plan of its own', async () => {
    const res = await generate({}, OWNER);
    const receipt = receiptOf(res);
    const stored = await getProposalStore().get(receipt.proposalId);

    expect(receipt.candidateIds.sort()).toEqual(stored!.candidates.map((c) => c.candidateId).sort());
    expect(receipt.recommendedCandidateId).toBe(stored!.recommendedCandidateId);
    expect(receipt.profileVersion).toBe(3);
    expect(receipt.academicStatusDigest).toBe(stored!.academicStatusDigest);
    // Nothing in the receipt is a plan the server would have to trust back.
    expect(JSON.stringify(receipt)).not.toMatch(/courseIds|semesterId/);
  });

  test('it records the context an Apply must still match', async () => {
    const res = await generate({}, OWNER);
    const stored = (await getProposalStore().get(receiptOf(res).proposalId))!;

    expect(stored.baseBoardVersion).toBeNull();        // nothing committed yet
    expect(stored.profileVersion).toBe(3);
    expect(stored.constraintFingerprint).toMatch(/^cf_/);
    expect(stored.snapshotId.length).toBeGreaterThan(0);
    expect(stored.academicStatusDigest).toBe(
      academicStatusDigest({
        completed: [], currently_taking: [],
        completed_knowledge: { status: 'known', provenance: 'explicit_user' },
      }),
    );
    expect(stored.expiresAt - stored.createdAt).toBe(PROPOSAL_TTL_MS);
  });

  test('the client cannot add a candidate to the record', async () => {
    // A hostile client sends extra "alternatives" in its own request body.
    const res = await generate({
      alternatives: [{ candidateId: 'cand_INJECTED', semesters: [] }],
      academicDecision: { candidates: { alternatives: [{ candidateId: 'cand_INJECTED2' }] } },
    }, OWNER);
    const stored = (await getProposalStore().get(receiptOf(res).proposalId))!;
    const ids = stored.candidates.map((c) => c.candidateId);
    expect(ids).not.toContain('cand_INJECTED');
    expect(ids).not.toContain('cand_INJECTED2');
    expect(ids.every((id) => id.startsWith('cand_'))).toBe(true);
  });

  test('every stored candidate is one the authoritative validator passed', async () => {
    const stored = (await getProposalStore().get(receiptOf(await generate({}, OWNER)).proposalId))!;
    expect(stored.candidates.length).toBeGreaterThan(0);
    for (const c of stored.candidates) {
      expect(c.valid).toBe(true);
      expect(c.applyable).toBe(true);
      expect(c.semesters.length).toBeGreaterThan(0);
    }
    expect(stored.candidates.filter((c) => c.recommended)).toHaveLength(1);
  });
});

describe('S1 — lifecycle', () => {
  test('a newer Generate supersedes the older proposal for the same owner+program', async () => {
    const first = receiptOf(await generate({}, OWNER));
    const second = receiptOf(await generate({}, OWNER));
    expect(second.proposalId).not.toBe(first.proposalId);

    const store = getProposalStore();
    expect((await store.get(first.proposalId))!.supersededBy).toBe(second.proposalId);
    expect((await store.get(second.proposalId))!.supersededBy).toBeUndefined();

    // …and a superseded record can no longer be acted on.
    expect(checkProposalAccess(await store.get(first.proposalId), OWNER, Date.now()))
      .toBe('PROPOSAL_SUPERSEDED');
    expect(checkProposalAccess(await store.get(second.proposalId), OWNER, Date.now()))
      .toBeNull();
  });

  test('another OWNER’s Generate does not supersede mine', async () => {
    const mine = receiptOf(await generate({}, OWNER));
    await generate({}, 'z'.repeat(48));
    expect((await getProposalStore().get(mine.proposalId))!.supersededBy).toBeUndefined();
  });

  test('another PROGRAM’s Generate does not supersede mine', async () => {
    const mine = receiptOf(await generate({}, OWNER));
    await generate({ program_id: 'test_program_agent_preview_2027' }, OWNER);
    expect((await getProposalStore().get(mine.proposalId))!.supersededBy).toBeUndefined();
  });

  test('a proposal belonging to another session is not usable, and leaks nothing', async () => {
    const receipt = receiptOf(await generate({}, OWNER));
    const record = await getProposalStore().get(receipt.proposalId);
    expect(checkProposalAccess(record, 'someone-else', Date.now())).toBe('SESSION_MISMATCH');
  });

  test('an expired proposal is not usable', async () => {
    const receipt = receiptOf(await generate({}, OWNER));
    const record = await getProposalStore().get(receipt.proposalId);
    expect(checkProposalAccess(record, OWNER, record!.expiresAt)).toBe('PROPOSAL_EXPIRED');
    expect(checkProposalAccess(record, OWNER, record!.expiresAt - 1)).toBeNull();
  });

  test('an unknown proposal id is simply not found', async () => {
    expect(checkProposalAccess(await getProposalStore().get('prop_nope'), OWNER, Date.now()))
      .toBe('PROPOSAL_NOT_FOUND');
  });
});

describe('S1 — the session that owns the proposal', () => {
  test('a request with no session gets one issued, and it owns the proposal', async () => {
    const res = await generate();
    const cookie = String((res._headers['Set-Cookie'] as string[])[0]);
    expect(cookie).toContain(SESSION_COOKIE);
    expect(cookie).toContain('HttpOnly');

    const issued = decodeURIComponent(cookie.split(';')[0].split('=')[1]);
    const stored = await getProposalStore().get(receiptOf(res).proposalId);
    expect(stored!.ownerId).toBe(issued);
  });

  test('the owner is NOT the client-chosen session_token', async () => {
    const clientToken = randomUUID();
    const res = await generate({ session_token: clientToken });
    const stored = await getProposalStore().get(receiptOf(res).proposalId);
    expect(stored!.ownerId).not.toBe(clientToken);
  });

  test('an established session is reused and issued no new cookie', async () => {
    const res = await generate({}, OWNER);
    expect(res._headers['Set-Cookie']).toBeUndefined();
    expect((await getProposalStore().get(receiptOf(res).proposalId))!.ownerId).toBe(OWNER);
  });

  test('FLAG-OFF stores nothing and sets no cookie', async () => {
    const res = await generate({ use_academic_decision_agent: false });
    expect(res._body?.academicDecision).toBeUndefined();
    expect(res._headers['Set-Cookie']).toBeUndefined();
  });
});
