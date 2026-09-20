/**
 * A3 — recognition through the REAL candidate/validator/Apply path.
 *
 * The accounting being right is necessary but not sufficient: this proves the
 * recognized progress actually reaches candidate generation, that every
 * alternative in one response was planned against the SAME recognition, that
 * hard user constraints still outrank it, and that Apply refuses a plan whose
 * academic status has since changed.
 */
jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn(() => BOARD) }));
jest.mock('../../api/ai/evidence_loader', () => ({ loadPreparedEvidenceDocuments: jest.fn(() => []) }));

import generateHandler from '../../api/ai/generate-plan';
import applyHandler from '../../api/ai/apply-plan';
import { randomUUID } from 'crypto';
import { buildConstraintModel } from '../../api/ai/planner_model';
import { generateCandidateSet } from '../../api/ai/candidate_set';
import { planContextToState } from '../../api/ai/planner_model';
import { resetApplyRuntime } from '../../api/ai/apply_runtime';
import { SESSION_COOKIE } from '../../api/ai/session_owner';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';

/** Two disjoint requiring categories plus a free elective pool for hours. */
const FLUIDS = ['FLU1', 'FLU2'];
const SOLIDS = ['SOL1', 'SOL2'];
const FREE = ['FR1', 'FR2', 'FR3'];
const ALL = [...FLUIDS, ...SOLIDS, ...FREE];

const course = (id: string) => ({
  course_id: id, name_he: `קורס ${id}`, weekly_hours: 4, is_mandatory: false,
  course_type: 'elective', placement_policy: 'elective',
  offered_semesters: [SEM_A, SEM_B], prerequisites: [],
});

const BOARD = {
  semesters: [SEM_A, SEM_B].map((id) => ({ semester_id: id, courses: [] })),
  metadata: {
    board_data_version: 'completed-integration-1',
    completed_course_ids: [],
    program_requirements_categories: {
      total_required_hours: 12,
      categories: [
        { category_id: 'fluids', name_he: 'זרימה', min_courses: 1, course_ids: FLUIDS },
        { category_id: 'solids', name_he: 'מוצקים', min_courses: 1, course_ids: SOLIDS },
        { category_id: 'other', name_he: 'אחר', min_courses: 0, course_ids: FREE },
      ],
    },
    program_repository_courses: ALL.map(course),
  },
};

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

const OWNER = 'o'.repeat(48);
const PROGRAM = 'test_program_completed_integration_2027';

const statusFor = (completed: string[]) => ({
  completed: completed.map((course_id) => ({ course_id })),
  currently_taking: [],
  completed_knowledge: { status: 'known', provenance: 'explicit_user' },
});

async function generate(completed: string[], over: Record<string, unknown> = {}) {
  const res = makeRes();
  await generateHandler({
    method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${OWNER}` },
    body: {
      program_id: PROGRAM,
      plan_context: { personal_status: statusFor(completed) },
      preferences: { disallowed_course_ids: [] },
      session_token: randomUUID(),
      use_academic_decision_agent: true,
      preference_profile: { version: 1, preferences: [] },
      ...over,
    },
  } as any, res);
  return res;
}

const decisionOf = (res: any) => res._body?.academicDecision;
const progressOf = (res: any) => decisionOf(res)?.academicProgress;
const altsOf = (res: any) => decisionOf(res)?.candidates?.alternatives ?? [];
const plannedCourses = (body: any): string[] =>
  [...new Set(((body?.semesters ?? []) as any[]).flatMap((s) => s.course_ids as string[]))].sort();

beforeAll(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
afterAll(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });
beforeEach(() => { resetApplyRuntime(); });

// ── candidate generation ────────────────────────────────────────────────────

describe('A3 — recognition reaches candidate generation', () => {
  const model = (completed: string[]) =>
    buildConstraintModel(BOARD as never, { completedCourseIds: completed });

  test('every retained candidate excludes the completed course', () => {
    const m = model(['FLU1']);
    const set = generateCandidateSet({
      buildModel: () => m,
      policy: 'neutral',
      initialState: planContextToState({ semesters: [] }, m),
      profileVersion: 1,
    });
    expect(set.candidates.length).toBeGreaterThan(0);
    for (const c of set.candidates) {
      const placed = Object.values(c.state.semesters).flat();
      expect(placed).not.toContain('FLU1');
      // …and every retained candidate passed the authoritative validator.
      expect(c.valid).toBe(true);
      expect(c.validationErrors).toEqual([]);
    }
  });

  test('every candidate was planned against the SAME recognition digest', () => {
    const built: string[] = [];
    const m = model(['FLU1']);
    const set = generateCandidateSet({
      // `generateCandidateSet` rebuilds the model per deviation run; each build
      // must recognize the identical academic reality, or two alternatives
      // would be answering different questions.
      buildModel: () => {
        const fresh = buildConstraintModel(BOARD as never, { completedCourseIds: ['FLU1'] });
        built.push(fresh.academicProgress!.digest);
        return fresh;
      },
      policy: 'neutral',
      initialState: planContextToState({ semesters: [] }, m),
      profileVersion: 1,
    });
    expect(set.candidates.length).toBeGreaterThan(0);
    expect(built.length).toBeGreaterThan(1);
    expect(new Set(built).size).toBe(1);
    expect(built[0]).toBe(m.academicProgress!.digest);
  });

  test('a completed course does not make an otherwise-complete plan look incomplete', () => {
    // fluids satisfied by completion ⇒ a plan needs only solids + hours.
    const m = model(['FLU1']);
    const set = generateCandidateSet({
      buildModel: () => m,
      policy: 'neutral',
      initialState: planContextToState({ semesters: [] }, m),
      profileVersion: 1,
    });
    expect(set.outcome).toBe('proposal');
    expect(set.applyEligible).toBe(true);
  });
});

// ── the whole handler ───────────────────────────────────────────────────────

describe('A3 — the handler reports what it recognized, truthfully', () => {
  test('a recognized elective is reported as satisfying its category', async () => {
    const p = progressOf(await generate(['FLU1']));
    expect(p).toBeDefined();
    expect(p.recognizedCourseCount).toBe(1);
    expect(p.recognizedHours).toBe(4);
    expect(p.unresolvedCourseIds).toEqual([]);

    const fluids = p.remainingByCategory.find((c: any) => c.name === 'זרימה');
    expect(fluids).toMatchObject({ required: 1, remaining: 0, satisfiedBy: ['FLU1'] });
    expect(p.explanationHe.join(' ')).toContain('השלימו את דרישת "זרימה"');
  });

  test('a credited-but-uncategorized elective is NOT reported as satisfying a category', async () => {
    const p = progressOf(await generate(['FR1']));
    expect(p.recognizedHours).toBe(4);
    expect(p.creditOnlyCourseIds).toEqual(['FR1']);
    // Every category still owes exactly what the program asked.
    for (const c of p.remainingByCategory) expect(c.remaining).toBe(c.required);
    const text = p.explanationHe.join(' ');
    expect(text).toContain('לא נמצא שיוך סמכותי לקטגוריית בחירה');
    expect(text).not.toContain('השלימו את דרישת');
  });

  test('an unresolved id is reported as changing nothing', async () => {
    const p = progressOf(await generate(['GHOST']));
    expect(p.unresolvedCourseIds).toEqual(['GHOST']);
    expect(p.recognizedHours).toBe(0);
    expect(p.explanationHe.join(' ')).toContain('לא נמצא רישום סמכותי');
  });

  test('the disclosure exposes no digest, rule object, pool or score vector', async () => {
    const serialized = JSON.stringify(progressOf(await generate(['FLU1', 'FR1', 'GHOST'])));
    expect(serialized).not.toMatch(/ap_[0-9a-f]{16}|digest|scoreVector|candidateIds|courseIds|minCourses|perCourse/);
  });

  test('every alternative in ONE response shares one constraint fingerprint', async () => {
    const res = await generate(['FLU1']);
    const alternatives = altsOf(res);
    if (alternatives.length >= 2) {
      expect(new Set(alternatives.map((a: any) => a.constraintFingerprint)).size).toBe(1);
      expect(new Set(alternatives.map((a: any) => a.profileVersion)).size).toBe(1);
    }
    // Whatever the count, no alternative may re-schedule the completed course.
    for (const a of alternatives) {
      expect(a.semesters.flatMap((s: any) => s.courseIds)).not.toContain('FLU1');
    }
  });

  test('recognition genuinely changes the plan — but only when requirements change', async () => {
    const none = plannedCourses((await generate([]))._body);
    const credited = plannedCourses((await generate(['FR1']))._body);
    const categorical = plannedCourses((await generate(['FLU1']))._body);

    // A completed course always removes itself from the plan.
    expect(none).not.toEqual(categorical);
    expect(categorical).not.toContain('FLU1');
    expect(credited).not.toContain('FR1');
    // A course that satisfied a CATEGORY frees the plan from that category…
    expect(categorical.some((id) => SOLIDS.includes(id))).toBe(true);
  });
});

// ── hard constraints still outrank recognition ──────────────────────────────

describe('A3 — hard user constraints remain absolute', () => {
  test('an avoided course is never scheduled, even to satisfy a remaining category', async () => {
    // Exclude every solids course: the category cannot be satisfied at all.
    const res = await generate(['FLU1'], {
      preferences: { disallowed_course_ids: SOLIDS },
    });
    const planned = plannedCourses(res._body);
    for (const id of SOLIDS) expect(planned).not.toContain(id);
  });

  test('a wanted course is honoured alongside recognized completion', async () => {
    const res = await generate(['FLU1'], {
      preferences: { disallowed_course_ids: [], wanted_course_ids: ['FR3'] },
    });
    expect(plannedCourses(res._body)).toContain('FR3');
    expect(plannedCourses(res._body)).not.toContain('FLU1');
  });
});

// ── Apply refuses a changed academic status ─────────────────────────────────

describe('A3 — Apply is bound to the academic status the plan assumed', () => {
  test('an academic-status change after Generate blocks Apply', async () => {
    const gen = await generate(['FLU1']);
    const receipt = decisionOf(gen)?.proposal;
    expect(receipt).toBeDefined();
    const candidateId = receipt.recommendedCandidateId ?? receipt.candidateIds[0];

    const res = makeRes();
    await applyHandler({
      method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${OWNER}` }, query: {},
      body: {
        program_id: PROGRAM,
        proposal_id: receipt.proposalId,
        candidate_id: candidateId,
        expected_board_version: receipt.baseBoardVersion,
        expected_profile_version: receipt.profileVersion,
        idempotency_key: 'idem-academic-status-1',
        // The student has since reported another completed course.
        academic_status: statusFor(['FLU1', 'SOL1']),
      },
    } as any, res);

    expect(res._body.ok).toBe(false);
    expect(res._body.code).toBe('ACADEMIC_STATUS_MISMATCH');
  });

  test('the UNCHANGED status applies cleanly', async () => {
    const gen = await generate(['FLU1']);
    const receipt = decisionOf(gen)?.proposal;
    const candidateId = receipt.recommendedCandidateId ?? receipt.candidateIds[0];

    const res = makeRes();
    await applyHandler({
      method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${OWNER}` }, query: {},
      body: {
        program_id: PROGRAM,
        proposal_id: receipt.proposalId,
        candidate_id: candidateId,
        expected_board_version: receipt.baseBoardVersion,
        expected_profile_version: receipt.profileVersion,
        idempotency_key: 'idem-academic-status-2',
        academic_status: statusFor(['FLU1']),
      },
    } as any, res);

    expect(res._body.ok).toBe(true);
    expect(res._body.board.semesters.flatMap((s: any) => s.courseIds)).not.toContain('FLU1');
  });
});

// ── flag-off ────────────────────────────────────────────────────────────────

describe('A3 — the default path is unchanged', () => {
  test('FLAG-OFF carries no academicDecision and no progress disclosure', async () => {
    const res = await generate(['FLU1'], { use_academic_decision_agent: false });
    expect(res._body.academicDecision).toBeUndefined();
    // …and it still refuses to re-schedule a completed course.
    expect(plannedCourses(res._body)).not.toContain('FLU1');
  });
});
