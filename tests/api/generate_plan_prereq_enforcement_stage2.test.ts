/**
 * Contract tests for Priority 6 — Stage 2 prerequisite enforcement:
 * verified violations from the tau.json catalog (AND/OR trees) now block
 * plans (blocked:true, errors contains LEGALITY_VIOLATION_ERROR_PREFIX),
 * never just warn.
 *
 * Stage 1 (Priority 5, PR #152) added soft warnings_he entries in toProposal;
 * Stage 2 adds hard blocking errors via prerequisiteVerifiedGate.
 *
 * Section A — unit tests: call prerequisiteVerifiedGate directly with the
 * same FE / SOLIDS1 / SOLIDS2 fixture used by the shadow-audit tests.
 *
 * Section B — integration tests: full handler round-trip with the
 * test_program_stage2_prereq_2027 fixture (FE pre-placed, prereqs absent or
 * completed).
 *
 * Uses course 0542-4223 (finite elements) from tau.json whose verified
 * prerequisite is { any: [0542-2200, 0542-4224] } (Solids 1 or 2).
 */

import { prerequisiteVerifiedGate, toProposal } from '../../api/ai/generate-plan';
import { LEGALITY_VIOLATION_ERROR_PREFIX } from '../../api/ai/planner_validate';
import type { ConstraintModel, PlanState } from '../../api/ai/planner_types';
import type { CourseProfile } from '../../api/ai/course_profile';
import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';

// ── shared fixtures ──────────────────────────────────────────────────────────

const FE      = '0542-4223'; // שיטות אלמנטים סופיים — verified prereq: SOLIDS1 OR SOLIDS2
const SOLIDS1 = '0542-2200'; // מכאניקה 1
const SOLIDS2 = '0542-4224'; // מכאניקה 2

function minProfile(courseId: string, nameHe: string, hours: number): CourseProfile {
  return {
    course_id: courseId,
    name_he: nameHe,
    category_id: null,
    category_name_he: null,
    is_mandatory: false,
    course_type: 'elective',
    placement_policy: 'flexible',
    hours,
    offered_semesters: null,
    effective_allowed_semesters: null,
    offering_window_semesters: null,
    recommended_semester: null,
    allowed_semesters: null,
    program_allowed_semesters: null,
    prerequisites: [],
    corequisites: [],
    syllabus_url: null,
    syllabus_available: false,
    syllabus_summary_he: null,
    syllabus_topics_he: [],
    assessment_type: null,
    workload_score: null,
    difficulty_score: null,
    difficulty_level: null,
    grade_average: null,
    is_wanted: false,
    is_unwanted: false,
    excluded: false,
    exclusion_reason: null,
    data_confidence: 0.8,
    provenance: { source: 'program', data_quality: null, offering_source_url: null, name_source: null },
  };
}

function minModel(profiles: CourseProfile[], degreeHours: number, completed = new Set<string>()): ConstraintModel {
  return {
    profiles: new Map(profiles.map(p => [p.course_id, p])),
    knownSemesterIds: ['s1', 's2'],
    completedCourseIds: completed,
    // Unit tests supply explicit completion data (the fixture is the known state).
    // Set completedCoursesKnown: true so the prerequisite gate runs — without it
    // the gate skips enforcement because the history is treated as unknown.
    completedCoursesKnown: true,
    requiredMandatoryCourseIds: [],
    categories: [],
    degreeRequiredHours: degreeHours,
    priorHours: 0,
    maxHoursPerSemester: 30,
    hardCap: 35,
    disallowedCourseIds: new Set(),
    pinnedCourseIds: new Set(),
    wantedCourseIds: new Set(),
  };
}

const FE_PROFILE  = minProfile(FE,      'שיטות אלמנטים סופיים', 3);
const S1_PROFILE  = minProfile(SOLIDS1, 'מכאניקה 1', 3);
const S2_PROFILE  = minProfile(SOLIDS2, 'מכאניקה 2', 3);

// ── Section A: unit tests via prerequisiteVerifiedGate directly ──────────────

describe('prerequisiteVerifiedGate (Stage 2) — unit tests', () => {
  beforeEach(() => { process.env.AI_PREREQ_ENFORCEMENT_STAGE2 = 'true'; });
  afterEach(() => { delete process.env.AI_PREREQ_ENFORCEMENT_STAGE2; });

  test('1. verified unmet prerequisite returns a LEGALITY_VIOLATION blocking error', () => {
    const model = minModel([FE_PROFILE, S1_PROFILE, S2_PROFILE], 3);
    const semesters = [{ semester_id: 's1', course_ids: [FE] }, { semester_id: 's2', course_ids: [] }];
    const errors = prerequisiteVerifiedGate(semesters, model);
    expect(errors.length).toBeGreaterThan(0);
    const err = errors.find(e => e.includes('שיטות אלמנטים סופיים'));
    expect(err).toBeDefined();
    expect(err).toContain(LEGALITY_VIOLATION_ERROR_PREFIX);
    expect(err).toContain('דרישת הקדם לא מולאה עבור');
  });

  test('2. prerequisite in a strictly earlier semester: FE is not blocked (no FE error)', () => {
    const model = minModel([FE_PROFILE, S1_PROFILE, S2_PROFILE], 6);
    const semesters = [{ semester_id: 's1', course_ids: [SOLIDS1] }, { semester_id: 's2', course_ids: [FE] }];
    const errors = prerequisiteVerifiedGate(semesters, model);
    // FE's prereq (SOLIDS1) is satisfied by prior placement — no FE error.
    // SOLIDS1 itself may have tau.json prereqs of its own (outside test scope).
    expect(errors.some(e => e.includes('שיטות אלמנטים סופיים'))).toBe(false);
  });

  test('3. prerequisite completed before the plan: returns empty', () => {
    const completed = new Set([SOLIDS1]);
    const model = minModel([FE_PROFILE, S1_PROFILE, S2_PROFILE], 3, completed);
    const semesters = [{ semester_id: 's1', course_ids: [FE] }, { semester_id: 's2', course_ids: [] }];
    const errors = prerequisiteVerifiedGate(semesters, model);
    expect(errors).toEqual([]);
  });

  test('4. second alternative (SOLIDS2) placed earlier: FE is not blocked (no FE error)', () => {
    const model = minModel([FE_PROFILE, S1_PROFILE, S2_PROFILE], 6);
    const semesters = [{ semester_id: 's1', course_ids: [SOLIDS2] }, { semester_id: 's2', course_ids: [FE] }];
    const errors = prerequisiteVerifiedGate(semesters, model);
    // FE's prereq is satisfied by SOLIDS2 earlier — no FE error.
    // SOLIDS2 itself may have tau.json prereqs of its own (outside test scope).
    expect(errors.some(e => e.includes('שיטות אלמנטים סופיים'))).toBe(false);
  });

  test('5. course not in tau.json (unknown status): returns empty', () => {
    const unknownProfile = minProfile('9999-9999', 'קורס לא ידוע', 3);
    const model = minModel([unknownProfile], 3);
    const semesters = [{ semester_id: 's1', course_ids: ['9999-9999'] }, { semester_id: 's2', course_ids: [] }];
    const errors = prerequisiteVerifiedGate(semesters, model);
    expect(errors).toEqual([]);
  });

  test('6. prerequisite in SAME semester (not strictly earlier): returns a blocking error', () => {
    const model = minModel([FE_PROFILE, S1_PROFILE, S2_PROFILE], 6);
    const semesters = [{ semester_id: 's1', course_ids: [SOLIDS1, FE] }, { semester_id: 's2', course_ids: [] }];
    const errors = prerequisiteVerifiedGate(semesters, model);
    const err = errors.find(e => e.includes('שיטות אלמנטים סופיים'));
    expect(err).toBeDefined();
    expect(err).toContain(LEGALITY_VIOLATION_ERROR_PREFIX);
  });

  test('7a. completedCoursesKnown absent/false: gate returns empty (no false positives for unknown history)', () => {
    // A model with completedCoursesKnown not set (undefined) — simulates a student
    // who has not yet told the system their completion history. The gate must NOT
    // enforce in this state: an empty completedCourseIds means "never asked", not
    // "nothing completed", and enforcing would produce false positives for real
    // students whose year-1/2 history hasn't been recorded yet.
    const model = { ...minModel([FE_PROFILE, S1_PROFILE, S2_PROFILE], 3), completedCoursesKnown: false };
    const semesters = [{ semester_id: 's1', course_ids: [FE] }, { semester_id: 's2', course_ids: [] }];
    const errors = prerequisiteVerifiedGate(semesters, model);
    expect(errors).toEqual([]);
  });

  test('7. Stage 1 warnings_he still fire alongside Stage 2 errors (no double-suppression)', () => {
    const model = minModel([FE_PROFILE, S1_PROFILE, S2_PROFILE], 3);
    const state: PlanState = { semesters: { s1: [FE], s2: [] } };
    const EMPTY_STATE: PlanState = { semesters: { s1: [], s2: [] } };
    const { warnings_he } = toProposal(state, model, EMPTY_STATE, {}, 'done');
    const warn = warnings_he.find(w => w.includes('קדם-קורס חסר') && w.includes('שיטות אלמנטים סופיים'));
    expect(warn).toBeDefined();

    const semesters = [{ semester_id: 's1', course_ids: [FE] }, { semester_id: 's2', course_ids: [] }];
    const errors = prerequisiteVerifiedGate(semesters, model);
    expect(errors.some(e => e.includes(LEGALITY_VIOLATION_ERROR_PREFIX))).toBe(true);
  });
});

// ── Section B: integration tests via handler ─────────────────────────────────

function planContextWithFEPlaced(personalStatus: any) {
  // Merge a completed_knowledge marker so buildModel sets completedCoursesKnown:
  // the prerequisite gate only enforces when the student's completion history is
  // explicitly known (not just absent/unasked). Integration tests simulate a
  // student who has explicitly provided their history (even if the list is empty —
  // "I completed nothing yet").
  const personalStatusWithKnowledge = {
    ...personalStatus,
    completed_knowledge: { status: 'known', provenance: 'explicit_user' },
  };
  return {
    program_name: 'בדיקה',
    semesters: [
      { id: 'year_3_semester_a', label: "שנה ג׳ א׳", total_hours: 0, courses: [] },
      { id: 'year_3_semester_b', label: "שנה ג׳ ב׳", total_hours: 0, courses: [] },
      // FE pre-placed here — simulating a client-supplied plan_context where
      // the user dragged FE onto the board without first completing its
      // verified prerequisites.
      { id: 'year_4_semester_a', label: "שנה ד׳ א׳", total_hours: 3, courses: [
        { course_id: FE, name_he: 'שיטות אלמנטים סופיים', hours: 3, course_type: 'elective', placement_policy: 'flexible', effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'] },
      ] },
      { id: 'year_4_semester_b', label: "שנה ד׳ ב׳", total_hours: 0, courses: [] },
    ],
    category_requirements: [
      { name: 'מדעי הנדסה', category_id: 'engineering', required: 1, placed: 1, candidates: [
        { course_id: FE, name_he: 'שיטות אלמנטים סופיים', hours: 3, effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'] },
      ] },
    ],
    // FE (3h) alone reaches the 185h target — the search has no remaining
    // degree-hour gap to fill, so it cannot incidentally place SOLIDS1 or
    // SOLIDS2 and inadvertently cure the very violation this file reproduces.
    total_hours_progress: { known_completed_hours: 182, degree_required_hours: 185 },
    personal_status: personalStatusWithKnowledge,
    mandatory_unplaced: [],
  };
}

function makeReq(body: any, method = 'POST') {
  return { method, body } as any;
}
function makeRes() {
  const res: any = {
    statusCode: 0,
    setHeader: jest.fn().mockReturnThis(),
    status: jest.fn(function (this: any, c: number) { this.statusCode = c; return this; }),
    json: jest.fn(function (this: any, b: any) { this._body = b; return this; }),
    write: jest.fn(),
    end: jest.fn(),
  };
  return res;
}

function baseReqBody(overrides: any = {}) {
  return {
    program_id: 'test_program_stage2_prereq_2027',
    plan_context: planContextWithFEPlaced({ completed: [] }),
    preferences: { disallowed_course_ids: [] },
    session_token: randomUUID(),
    ...overrides,
  };
}

function placedIdsOf(body: any): string[] {
  return body.semesters.flatMap((s: any) => s.course_ids);
}

describe('generate-plan — Stage 2: verified prerequisite violation blocks the plan (Priority 6)', () => {
  beforeEach(() => {
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
    process.env.AI_PREREQ_ENFORCEMENT_STAGE2 = 'true';
  });
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
    delete process.env.AI_USE_AGENTIC_PLANNER;
    delete process.env.AI_PREREQ_ENFORCEMENT_STAGE2;
  });

  test('1. FE pre-placed with no verified prereq: plan is blocked with a Hebrew error naming the course', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody()), res);
    const b = res._body;
    expect(res.statusCode).toBe(200);
    expect(placedIdsOf(b)).toContain(FE);
    expect(b.blocked).toBe(true);
    expect(b.blocked).toBe(b.errors.length > 0);
    const err = b.errors.find((e: string) =>
      e.includes(LEGALITY_VIOLATION_ERROR_PREFIX) && e.includes('שיטות אלמנטים סופיים'),
    );
    expect(err).toBeDefined();
    // Stage 1 warning must ALSO still fire (soft and hard coexist).
    const warn = b.warnings_he.find((w: string) =>
      w.includes('קדם-קורס חסר') && w.includes('שיטות אלמנטים סופיים'),
    );
    expect(warn).toBeDefined();
  });

  test('2. sanity: SOLIDS1 completed → FE is legal, plan is not blocked', async () => {
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({
        plan_context: planContextWithFEPlaced({ completed: [{ course_id: SOLIDS1 }] }),
      })),
      res,
    );
    const b = res._body;
    expect(res.statusCode).toBe(200);
    expect(placedIdsOf(b)).toContain(FE);
    expect(b.blocked).toBe(false);
    expect(b.errors).toEqual([]);
  });

  test('3. same gate fires on the AI_USE_AGENTIC_PLANNER path', async () => {
    process.env.AI_USE_AGENTIC_PLANNER = 'true';
    const res = makeRes();
    await handler(makeReq(baseReqBody()), res);
    const b = res._body;
    expect(b.blocked).toBe(true);
    expect(b.errors.some((e: string) =>
      e.includes(LEGALITY_VIOLATION_ERROR_PREFIX) && e.includes('שיטות אלמנטים סופיים'),
    )).toBe(true);
  });

  test('4. academic decision agent: validation.valid is false and cause is legality violation', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody({ use_academic_decision_agent: true })), res);
    const b = res._body;
    expect(b.blocked).toBe(true);
    expect(b.academicDecision).toBeDefined();
    expect(b.academicDecision.validation.valid).toBe(false);
    const actions: string[] = b.academicDecision.explanation.suggestedNextActions;
    expect(actions.some((a) => a.includes('הפרת חוקיות') || a.includes('תנאי הקדם'))).toBe(true);
    expect(actions.some((a) => a.includes('עומס'))).toBe(false);
  });
});
