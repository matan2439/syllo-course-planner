/**
 * Currently-Taking Mandatory Requirement Accounting — unit tests for
 * validatePlanProposal rule 6 (missing-mandatory partial-plan check) against
 * currentlyPlannedCourseIds.
 *
 * Product contradiction being closed: rule 2a forbids re-proposing a
 * currently-taking course, but rule 6 reported that same course as a missing
 * mandatory when the caller-supplied requiredMandatoryCourseIds still listed
 * it — an impossible requirement. A currently-taking mandatory course is prior
 * progress, already accounted for (same semantics rule 2a/rule 4 give the
 * field), so it must not be reported missing solely for being absent from the
 * proposal, while:
 *   - a mandatory course neither completed nor currently taking is still
 *     reported missing,
 *   - rule 2a still rejects a proposal that tries to place it again.
 */

import { validatePlanProposal, type PlanProposal, type PlanValidationContext } from '../../api/ai/plan_validation';

const COURSES: PlanValidationContext['courses'] = {
  MAND: { hours: 4, is_mandatory: true },
  ELEC: { hours: 4 },
};

function makeProposal(semesters: Array<{ semester_id: string; course_ids: string[] }>): PlanProposal {
  return { semesters, moves: [], warnings_he: [], rationale_he: 'בדיקה.', requirements_status: [] };
}

function makeCtx(overrides: Partial<PlanValidationContext> = {}): PlanValidationContext {
  return {
    completedCourseIds: new Set(),
    courses: COURSES,
    requiredMandatoryCourseIds: ['MAND'],
    ...overrides,
  };
}

describe('validatePlanProposal — currently-taking mandatory is not "missing" (rule 6)', () => {
  test('1. product regression: MAND currently taking and absent from the proposal is NOT a missing-mandatory error', () => {
    const res = validatePlanProposal(
      makeProposal([{ semester_id: 'year_4_semester_a', course_ids: ['ELEC'] }]),
      makeCtx({ currentlyPlannedCourseIds: new Set(['MAND']) }),
    );
    expect(res.errors.filter(e => e.includes('קורס חובה חסר'))).toEqual([]);
  });

  test('2. negative: MAND neither completed nor currently taking and absent from the proposal is still a missing-mandatory error', () => {
    const res = validatePlanProposal(
      makeProposal([{ semester_id: 'year_4_semester_a', course_ids: ['ELEC'] }]),
      makeCtx(),
    );
    expect(res.errors.some(e => e.includes('קורס חובה חסר') && e.includes('MAND'))).toBe(true);
  });

  test('3. no loophole: a currently-taking MAND placed in the proposal is still rejected by rule 2a', () => {
    const res = validatePlanProposal(
      makeProposal([{ semester_id: 'year_4_semester_a', course_ids: ['MAND'] }]),
      makeCtx({ currentlyPlannedCourseIds: new Set(['MAND']) }),
    );
    expect(res.errors.some(e => e.includes('כבר מתוכנן/נלמד כעת'))).toBe(true);
  });

  test('4. completed-course behavior unchanged: completed MAND absent from the proposal is not a missing-mandatory error', () => {
    const res = validatePlanProposal(
      makeProposal([{ semester_id: 'year_4_semester_a', course_ids: ['ELEC'] }]),
      makeCtx({ completedCourseIds: new Set(['MAND']) }),
    );
    expect(res.errors.filter(e => e.includes('קורס חובה חסר'))).toEqual([]);
  });
});
