/**
 * Currently-taking prerequisite eligibility — unit tests for validatePlanProposal
 * rule 4 (strict prerequisite timing) against currentlyPlannedCourseIds.
 *
 * Product scenario being locked: the user is currently taking PREREQ (it is in
 * personal_status.currently_taking, NOT in completed). ADVANCED requires PREREQ.
 * A currently-taking course is prior progress that, by rule 2a's own premise,
 * can never appear in the proposal — it is strictly earlier than every proposal
 * semester. So it must satisfy ADVANCED's prerequisite for any proposed
 * semester, exactly like a completed course, while:
 *   - a prereq that is neither completed nor currently taking still blocks,
 *   - completed-course behavior is unchanged,
 *   - same-semester strictness between two PROPOSED courses is unchanged,
 *   - rule 2a still forbids re-proposing the currently-taking course itself.
 */

import { validatePlanProposal, type PlanProposal, type PlanValidationContext } from '../../api/ai/plan_validation';

const COURSES: PlanValidationContext['courses'] = {
  PREREQ: { hours: 4 },
  ADVANCED: { hours: 4, prerequisites: ['PREREQ'] },
};

function makeProposal(semesters: Array<{ semester_id: string; course_ids: string[] }>): PlanProposal {
  return { semesters, moves: [], warnings_he: [], rationale_he: 'בדיקה.', requirements_status: [] };
}

function makeCtx(overrides: Partial<PlanValidationContext> = {}): PlanValidationContext {
  return { completedCourseIds: new Set(), courses: COURSES, ...overrides };
}

describe('validatePlanProposal — currently-taking prerequisite satisfies future eligibility', () => {
  test('1. product regression: ADVANCED in a future semester is allowed when PREREQ is currently taking (not completed, not in plan)', () => {
    const res = validatePlanProposal(
      makeProposal([{ semester_id: 'year_4_semester_a', course_ids: ['ADVANCED'] }]),
      makeCtx({ currentlyPlannedCourseIds: new Set(['PREREQ']) }),
    );
    expect(res.errors).toEqual([]);
  });

  test('2. negative: ADVANCED stays blocked when PREREQ is neither completed nor currently taking', () => {
    const res = validatePlanProposal(
      makeProposal([{ semester_id: 'year_4_semester_a', course_ids: ['ADVANCED'] }]),
      makeCtx(),
    );
    expect(res.errors.some(e => e.includes('ADVANCED') && e.includes('PREREQ'))).toBe(true);
  });

  test('3. completed-course behavior unchanged: ADVANCED is allowed when PREREQ is completed', () => {
    const res = validatePlanProposal(
      makeProposal([{ semester_id: 'year_4_semester_a', course_ids: ['ADVANCED'] }]),
      makeCtx({ completedCourseIds: new Set(['PREREQ']) }),
    );
    expect(res.errors).toEqual([]);
  });

  test('4. same-semester strictness unchanged: PREREQ and ADVANCED proposed in the same semester is still an error', () => {
    const res = validatePlanProposal(
      makeProposal([{ semester_id: 'year_4_semester_a', course_ids: ['PREREQ', 'ADVANCED'] }]),
      makeCtx(),
    );
    expect(res.errors.some(e => e.includes('באותו סמסטר'))).toBe(true);
  });

  test('5. no loophole: a currently-taking PREREQ re-proposed alongside ADVANCED still invalidates the plan via rule 2a', () => {
    const res = validatePlanProposal(
      makeProposal([{ semester_id: 'year_4_semester_a', course_ids: ['PREREQ', 'ADVANCED'] }]),
      makeCtx({ currentlyPlannedCourseIds: new Set(['PREREQ']) }),
    );
    // The prereq itself may now be "satisfied", but re-proposing the
    // currently-taking course is still a rule-2a error — the plan stays invalid.
    expect(res.errors.some(e => e.includes('כבר מתוכנן/נלמד כעת'))).toBe(true);
  });

  test('6. empty currentlyPlannedCourseIds set behaves exactly like the field being absent', () => {
    const withEmpty = validatePlanProposal(
      makeProposal([{ semester_id: 'year_4_semester_a', course_ids: ['ADVANCED'] }]),
      makeCtx({ currentlyPlannedCourseIds: new Set() }),
    );
    const withoutField = validatePlanProposal(
      makeProposal([{ semester_id: 'year_4_semester_a', course_ids: ['ADVANCED'] }]),
      makeCtx(),
    );
    expect(withEmpty.errors).toEqual(withoutField.errors);
  });
});
