/**
 * Live candidate orchestration — the flagged Generate path builds its proposal
 * from generateCandidateSet's SELECTED validated candidate (the single proposal
 * owner), exposes lean candidate metadata, and stays legacy-identical for
 * neutral. Flag-off is untouched. Deterministic: dev-bypass, no DB/paid provider.
 */
jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn(() => DUAL_BOARD) }));

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';

// Two dual-semester 8h electives, degree target 16 → balanced [8,8] vs compact [16,0]:
// two distinct legal candidates (meaningful alternatives).
const DUAL_BOARD = {
  semesters: [
    { semester_id: SEM_A, courses: [] },
    { semester_id: SEM_B, courses: [] },
  ],
  metadata: {
    completed_course_ids: [],
    program_requirements_categories: { total_required_hours: 16, categories: [] },
    program_repository_courses: [
      { course_id: 'C1', name_he: 'קורס 1', weekly_hours: 8, is_mandatory: false, course_type: 'elective', placement_policy: 'elective', offered_semesters: [SEM_A, SEM_B], prerequisites: [] },
      { course_id: 'C2', name_he: 'קורס 2', weekly_hours: 8, is_mandatory: false, course_type: 'elective', placement_policy: 'elective', offered_semesters: [SEM_A, SEM_B], prerequisites: [] },
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

function body(over: any = {}) {
  return {
    program_id: 'dual_2027',
    plan_context: { personal_status: { completed: [{ course_id: 'PRIOR' }], currently_taking: [] } },
    preferences: { disallowed_course_ids: [] },
    session_token: randomUUID(),
    ...over,
  };
}
function loads(b: any) {
  return [SEM_A, SEM_B].map((s) => {
    const ids = (b.semesters ?? []).find((x: any) => x.semester_id === s)?.course_ids ?? [];
    return ids.length * 8; // each course 8h
  });
}
function profile(prefs: any[], version = 3) {
  return { version, preferences: prefs };
}
const balancedPref = { id: 'semester_balance', category: 'semester_balance', normalized: 'balanced', value: 'balanced', classification: 'soft_preference', affects: 'balance_score', source: 'explicit_answer', mayAffectPlanningBeforeConfirmation: true };
const compactPref = { id: 'semester_balance', category: 'semester_balance', normalized: 'compact', value: 'compact', classification: 'soft_preference', affects: 'balance_score', source: 'explicit_answer', mayAffectPlanningBeforeConfirmation: true };

describe('generate-plan — live candidate orchestration (flag on)', () => {
  beforeEach(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
  afterEach(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });

  test('flag off: no candidate metadata (unchanged single-plan path)', async () => {
    const res = await run(body());
    expect(res.statusCode).toBe(200);
    expect('academicDecision' in res._body).toBe(false);
  });

  test('flag on: the proposal comes from generateCandidateSet (candidate metadata present)', async () => {
    const res = await run(body({ use_academic_decision_agent: true }));
    const c = res._body.academicDecision.candidates;
    expect(c).toBeDefined();
    expect(typeof c.selectedCandidateId).toBe('string');
    expect(c.outcome).toBe('proposal');
    expect(c.validCandidateCount).toBeGreaterThanOrEqual(1);
    expect(c.selectionReason).toBe('legacy_default'); // no confirmed preference
    // Slice 18B — every candidate carries the ONE resolved policy; balanced and
    // compact are never retained side by side as competing user alternatives.
    expect(c.selectedPolicy).toBe('neutral');
    expect(new Set(c.summaries.map((s: any) => s.policy))).toEqual(new Set(['neutral']));
  });

  test('the lean candidate summary is typed and marks exactly one selected primary', async () => {
    const res = await run(body({ use_academic_decision_agent: true }));
    const c = res._body.academicDecision.candidates;
    expect(Array.isArray(c.summaries)).toBe(true);
    expect(c.summaries.filter((s: any) => s.selected)).toHaveLength(1);
    const primary = c.summaries.find((s: any) => s.selected);
    expect(primary.rank).toBe(0);
    expect(primary.id).toBe(c.selectedCandidateId);
    expect(primary.normalizedIdentity).toBe(c.selectedNormalizedIdentity);
    expect(Array.isArray(primary.courseIds)).toBe(true);
    // The bounded search discloses the budget it actually ran under.
    expect(c.searchBudget.runsExecuted).toBeLessThanOrEqual(c.searchBudget.maxRuns);
  });

  test('a satisfiable request reports no hard-constraint reasons and stays applyable', async () => {
    const res = await run(body({ use_academic_decision_agent: true }));
    expect(res._body.academicDecision.hardConstraints.outcome).toBe('feasible');
    expect(res._body.academicDecision.hardConstraints.reasons).toEqual([]);
  });

  test('provenance invariant: the proposal identity equals the selected candidate id', async () => {
    const res = await run(body({ use_academic_decision_agent: true }));
    const c = res._body.academicDecision.candidates;
    // recompute the proposal's normalized identity and hash it the same way
    const pairs: Array<[string, string]> = [];
    for (const s of res._body.semesters) for (const id of s.course_ids) pairs.push([id, s.semester_id]);
    pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
    expect(c.selectedNormalizedIdentity).toBe(JSON.stringify(pairs));
  });

  test('neutral (no preference) selects the canonical legacy plan — identical to flag-off proposal', async () => {
    const off = await run(body());
    const on = await run(body({ use_academic_decision_agent: true }));
    expect(on._body.semesters).toEqual(off._body.semesters);
    expect(on._body.academicDecision.candidates.selectionReason).toBe('legacy_default');
  });

  test('confirmed compact selects the compact (consolidated) plan', async () => {
    const res = await run(body({ use_academic_decision_agent: true, preference_profile: profile([compactPref]) }));
    expect(res._body.academicDecision.candidates.selectionReason).toBe('confirmed_compact');
    expect(loads(res._body).sort((a, b) => b - a)).toEqual([16, 0]); // consolidated
  });

  test('confirmed balanced selects the distributed plan (a flexible course moves to the later semester)', async () => {
    const res = await run(body({ use_academic_decision_agent: true, preference_profile: profile([balancedPref]) }));
    expect(res._body.academicDecision.candidates.selectionReason).toBe('confirmed_balanced');
    expect(loads(res._body).sort((a, b) => b - a)).toEqual([8, 8]); // distributed
  });

  test('profile version + fixed-policy provenance are accurate on the flagged response', async () => {
    const res = await run(body({ use_academic_decision_agent: true, preference_profile: profile([balancedPref], 5) }));
    const c = res._body.academicDecision.candidates;
    expect(c.profileVersion).toBe(5);
    expect(c.selectedPolicy).toBe('balanced');
    expect(c.summaries.every((s: any) => s.policy === 'balanced' && s.profileVersion === 5)).toBe(true);
    // A confirmed policy is never shown alongside its opposite.
    expect(c.summaries.some((s: any) => s.policy === 'compact')).toBe(false);
  });

  test('any additional candidate differs by REAL course/period facts, under the same policy', async () => {
    const res = await run(body({ use_academic_decision_agent: true, preference_profile: profile([balancedPref], 5) }));
    const c = res._body.academicDecision.candidates;
    for (const s of c.summaries.filter((x: any) => !x.selected)) {
      expect(s.differences.length).toBeGreaterThan(0);
      expect(s.normalizedIdentity).not.toBe(c.selectedNormalizedIdentity);
      expect(s.policy).toBe('balanced');
    }
  });
});
