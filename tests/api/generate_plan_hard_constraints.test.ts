/**
 * Slice 18A/18B end-to-end through the REAL generate-plan handler.
 *
 * Proves the product policy at the transport boundary:
 *   - the wanted picker's selections are HARD (`must_include`): a plan missing
 *     one is a BLOCKING error and is not applyable, however well it scores;
 *   - the avoided picker's selections stay HARD (`must_exclude`);
 *   - an unsatisfiable hard constraint returns a typed, deterministic
 *     `infeasible` outcome with stable reason codes, affected course ids,
 *     conflicting constraints, a Hebrew explanation, the authoritative /
 *     non-answerable distinction, and applyEligible:false — never a degraded
 *     "best effort" plan presented as applyable;
 *   - flag-off restores the legacy soft (`g5`) behavior.
 *
 * Deterministic: dev-bypass, local board, no DB and no paid provider.
 */
jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn(() => BOARD) }));

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';

// PRE→WANT is a real prerequisite chain; FILL alone already meets the 8h target,
// so a merely best-effort planner would happily omit WANT entirely.
const BOARD = {
  semesters: [
    { semester_id: SEM_A, courses: [] },
    { semester_id: SEM_B, courses: [] },
  ],
  metadata: {
    completed_course_ids: [],
    program_requirements_categories: { total_required_hours: 8, categories: [] },
    program_repository_courses: [
      { course_id: 'FILL', name_he: 'קורס מילוי', weekly_hours: 8, is_mandatory: false, course_type: 'elective', placement_policy: 'elective', offered_semesters: [SEM_A, SEM_B], prerequisites: [] },
      { course_id: 'PRE', name_he: 'קדם', weekly_hours: 4, is_mandatory: false, course_type: 'elective', placement_policy: 'elective', offered_semesters: [SEM_A], prerequisites: [] },
      { course_id: 'WANT', name_he: 'קורס מבוקש', weekly_hours: 4, is_mandatory: false, course_type: 'elective', placement_policy: 'elective', offered_semesters: [SEM_B], prerequisites: ['PRE'] },
      { course_id: 'GONE', name_he: 'קורס שלא נפתח', weekly_hours: 4, is_mandatory: false, course_type: 'elective', placement_policy: 'elective', offered_semesters: ['year_9_semester_z'], prerequisites: [] },
      { course_id: 'ORPHAN', name_he: 'קורס עם קדם חסר', weekly_hours: 4, is_mandatory: false, course_type: 'elective', placement_policy: 'elective', offered_semesters: [SEM_A, SEM_B], prerequisites: ['GHOST'] },
    ],
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
async function run(body: any) { const res = makeRes(); await handler({ method: 'POST', body } as any, res); return res; }

function body(prefs: any = {}, over: any = {}) {
  return {
    program_id: 'hard_2027',
    // A non-empty completed set so the (separate, pre-existing) completed-course
    // clarification does not fire — this suite is about hard constraints, not
    // about the academic-status question.
    plan_context: { personal_status: { completed: [{ course_id: 'PRIOR' }], currently_taking: [] } },
    preferences: { disallowed_course_ids: [], ...prefs },
    session_token: randomUUID(),
    use_academic_decision_agent: true,
    ...over,
  };
}
const placed = (b: any): string[] => (b.semesters ?? []).flatMap((s: any) => s.course_ids);
const reasons = (b: any) => b.academicDecision.hardConstraints.reasons;
const codes = (b: any) => reasons(b).map((r: any) => r.code);

describe('generate-plan — hard wanted/avoided semantics', () => {
  beforeEach(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
  afterEach(() => {
    delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA;
    delete process.env.AI_HARD_WANTED_CONSTRAINTS;
  });

  test('a wanted-picker selection is HARD: it is placed together with its prerequisite', async () => {
    const res = await run(body({ wanted_course_ids: ['WANT'] }));
    expect(res.statusCode).toBe(200);
    expect(placed(res._body)).toEqual(expect.arrayContaining(['WANT', 'PRE']));
    expect(res._body.blocked).toBe(false);
    expect(res._body.academicDecision.applyEligible).toBe(true);
  });

  test('an avoided-picker selection is HARD: it never appears in the plan', async () => {
    const res = await run(body({ disallowed_course_ids: ['FILL'] }));
    expect(placed(res._body)).not.toContain('FILL');
  });

  test('wanted AND avoided the same course → infeasible, explained, NOT applyable', async () => {
    const res = await run(body({ wanted_course_ids: ['WANT'], disallowed_course_ids: ['WANT'] }));
    expect(res._body.academicDecision.outcome).toBe('infeasible');
    expect(res._body.academicDecision.applyEligible).toBe(false);
    expect(codes(res._body)).toContain('wanted_and_avoided_conflict');
    const r = reasons(res._body).find((x: any) => x.code === 'wanted_and_avoided_conflict');
    expect(r.courseIds).toEqual(['WANT']);
    expect(r.conflictingConstraints).toEqual(expect.arrayContaining(['must_include', 'must_exclude']));
    expect(r.authoritative).toBe(false); // the user's own two selections — user-resolvable
    expect(r.resolvableActions.length).toBeGreaterThan(0);
    expect(typeof r.messageHe).toBe('string');
    expect(r.messageHe.length).toBeGreaterThan(0);
  });

  test('a wanted course that is not in the catalog → infeasible, authoritative, non-answerable', async () => {
    const res = await run(body({ wanted_course_ids: ['NOT_A_COURSE'] }));
    expect(res._body.academicDecision.outcome).toBe('infeasible');
    const r = reasons(res._body).find((x: any) => x.code === 'wanted_course_not_in_catalog');
    expect(r).toBeDefined();
    // Never asks the student to adjudicate an authoritative catalog fact.
    expect(r.authoritative).toBe(true);
    expect(r.resolvableActions).not.toContain('בחירה בין העובדות');
  });

  test('a wanted course unavailable in the planning horizon → infeasible', async () => {
    const res = await run(body({ wanted_course_ids: ['GONE'] }));
    expect(res._body.academicDecision.outcome).toBe('infeasible');
    expect(codes(res._body)).toContain('wanted_course_unavailable_in_horizon');
    expect(res._body.academicDecision.applyEligible).toBe(false);
  });

  test('a wanted course with an impossible prerequisite chain → infeasible', async () => {
    const res = await run(body({ wanted_course_ids: ['ORPHAN'] }));
    expect(res._body.academicDecision.outcome).toBe('infeasible');
    expect(codes(res._body)).toContain('wanted_prerequisite_impossible');
  });

  test('no degraded best-effort plan is ever marked applyable on an infeasible request', async () => {
    for (const prefs of [
      { wanted_course_ids: ['WANT'], disallowed_course_ids: ['WANT'] },
      { wanted_course_ids: ['GONE'] },
      { wanted_course_ids: ['NOT_A_COURSE'] },
    ]) {
      const res = await run(body(prefs));
      expect(res._body.academicDecision.applyEligible).toBe(false);
      expect(res._body.academicDecision.outcome).toBe('infeasible');
    }
  });

  test('a hard-wanted course the planner cannot place surfaces as a BLOCKING error, never a silent drop', async () => {
    // GONE is only offered off-board: the analysis reports it, and the plan-level
    // gate independently refuses to call the resulting plan clean.
    const res = await run(body({ wanted_course_ids: ['GONE'] }));
    expect(placed(res._body)).not.toContain('GONE');
    expect(res._body.blocked).toBe(true);
    expect(res._body.errors.some((e: string) => e.includes('קורס שביקשת במפורש לא שובץ בתוכנית'))).toBe(true);
  });

  test('a satisfiable request is feasible, applyable and reports no reasons', async () => {
    const res = await run(body({ wanted_course_ids: ['WANT'] }));
    expect(res._body.academicDecision.hardConstraints.outcome).toBe('feasible');
    expect(reasons(res._body)).toEqual([]);
    expect(res._body.academicDecision.outcome).toBe('proposal');
  });

  test('flag-off restores the LEGACY soft behavior (documented compatibility contract)', async () => {
    process.env.AI_HARD_WANTED_CONSTRAINTS = 'false';
    const res = await run(body({ wanted_course_ids: ['GONE'] }));
    // Soft semantics: an unplaceable preference is best-effort, so it neither
    // blocks the plan nor produces a hard-constraint reason.
    expect(res._body.academicDecision.hardConstraints.outcome).toBe('feasible');
    expect(res._body.errors.some((e: string) => e.includes('קורס שביקשת במפורש לא שובץ בתוכנית'))).toBe(false);
  });

  test('editing preferences never auto-generates: each response is one explicit run', async () => {
    const a = await run(body({ wanted_course_ids: ['WANT'] }));
    const b = await run(body({ wanted_course_ids: ['WANT'] }));
    // Deterministic and reproducible — same request, same plan, same primary.
    expect(placed(a._body).sort()).toEqual(placed(b._body).sort());
    expect(a._body.academicDecision.candidates.selectedCandidateId)
      .toBe(b._body.academicDecision.candidates.selectedCandidateId);
  });
});
