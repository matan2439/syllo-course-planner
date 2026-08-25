/**
 * DeterministicClarificationCapability — Interest Clarification Questions.
 * Tests for the academic-interest extension to api/ai/academic_clarification.ts.
 *
 * These questions are OPT-IN: they only appear when the caller explicitly
 * supplies `context.academicInterestProfile` (even an empty one) and no
 * evidence-backed interest currently reaches the planner.
 * When the field is entirely absent — the case for every pre-existing caller,
 * since none of them know about it — behavior is byte-identical to before
 * this epic. This is required for backward compatibility: the pre-existing
 * regression suite (academic_clarification.test.ts, academic_clarification_loop.test.ts,
 * academic_decision_factory.test.ts) asserts EXACT question-id arrays against
 * fixtures that never set this field; an unconditional "absent = ask" gate
 * would silently break all of them.
 */

import { DeterministicClarificationCapability } from '../../api/ai/academic_clarification';
import type { ClarificationRequest, ClarificationPlanningContext } from '../../api/ai/academic_decision_types';
import {
  emptyAcademicInterestProfile,
  normalizeAcademicInterestProfile,
} from '../../api/ai/academic_interest_profile';

function makeRequest(context: Partial<ClarificationPlanningContext> = {}): ClarificationRequest {
  return { gaps: [], context: { ...context } };
}

/** Satisfies the 5 pre-existing fields so only the new interest-question logic is exercised. */
const OTHER_FIELDS_ANSWERED: ClarificationPlanningContext = {
  completedCourseIds: ['c1'],
  currentCourseIds: ['c2'],
  excludedCourseIds: [],
  maxWeeklyHours: 20,
  track: 'systems',
};

const ALL_INTEREST_IDS = [
  'academic_focus_areas',
  'academic_avoid_areas',
  'course_style_preferences',
  'optimization_priorities',
  'career_goals',
];
const ACTIONABLE_INTEREST_IDS = [
  'academic_focus_areas',
  'academic_avoid_areas',
  'course_style_preferences',
];
const GROUNDED_FOCUS_AREAS = [
  'strength_analysis', 'finite_elements', 'mechanical_design', 'heat_transfer',
  'thermal_systems', 'fluids', 'control_systems', 'manufacturing', 'materials',
  'energy', 'robotics',
];
const GROUNDED_STYLES = ['project_based', 'lab_based'];

const MEANINGFUL_PROFILE = normalizeAcademicInterestProfile({
  focusAreas: [{ area: 'fluids', weight: 0.8 }],
});

describe('DeterministicClarificationCapability — interest clarification questions', () => {
  const cap = new DeterministicClarificationCapability();

  test('an empty academicInterestProfile produces an academic_focus_areas question', async () => {
    const result = await cap.clarify(
      makeRequest({ ...OTHER_FIELDS_ANSWERED, academicInterestProfile: emptyAcademicInterestProfile() }),
    );
    expect(result.questions).toContainEqual(
      expect.objectContaining({ id: 'academic_focus_areas', answerType: 'multi_choice', critical: false }),
    );
  });

  test('an empty academicInterestProfile produces an academic_avoid_areas question (non-critical)', async () => {
    const result = await cap.clarify(
      makeRequest({ ...OTHER_FIELDS_ANSWERED, academicInterestProfile: emptyAcademicInterestProfile() }),
    );
    expect(result.questions).toContainEqual(
      expect.objectContaining({ id: 'academic_avoid_areas', answerType: 'multi_choice', critical: false }),
    );
  });

  test('an empty academicInterestProfile produces a course_style_preferences question', async () => {
    const result = await cap.clarify(
      makeRequest({ ...OTHER_FIELDS_ANSWERED, academicInterestProfile: emptyAcademicInterestProfile() }),
    );
    expect(result.questions).toContainEqual(
      expect.objectContaining({ id: 'course_style_preferences', answerType: 'multi_choice', critical: false }),
    );
  });

  test('an empty profile does not ask optimization priorities without a planning consumer', async () => {
    const result = await cap.clarify(
      makeRequest({ ...OTHER_FIELDS_ANSWERED, academicInterestProfile: emptyAcademicInterestProfile() }),
    );
    expect(result.questions).not.toContainEqual(expect.objectContaining({ id: 'optimization_priorities' }));
  });

  test('an empty profile does not ask career goals without evidence-backed mapping', async () => {
    const result = await cap.clarify(
      makeRequest({ ...OTHER_FIELDS_ANSWERED, academicInterestProfile: emptyAcademicInterestProfile() }),
    );
    expect(result.questions).not.toContainEqual(expect.objectContaining({ id: 'career_goals' }));
  });

  test('only the three actionable interest questions are emitted, all non-critical', async () => {
    const result = await cap.clarify(
      makeRequest({ ...OTHER_FIELDS_ANSWERED, academicInterestProfile: emptyAcademicInterestProfile() }),
    );
    const interestQuestions = result.questions.filter((q) => ALL_INTEREST_IDS.includes(q.id));
    expect(interestQuestions.map((q) => q.id)).toEqual(ACTIONABLE_INTEREST_IDS);
    expect(interestQuestions.every((q) => q.critical === false)).toBe(true);
  });

  test('existing critical questions remain critical alongside interest questions', async () => {
    const result = await cap.clarify(makeRequest({ academicInterestProfile: emptyAcademicInterestProfile() }));
    expect(result.questions).toContainEqual(expect.objectContaining({ id: 'completed_courses', critical: true }));
    expect(result.questions).toContainEqual(expect.objectContaining({ id: 'excluded_courses', critical: true }));
  });

  test('existing question IDs remain stable and unaffected when interest questions are added', async () => {
    const result = await cap.clarify(
      makeRequest({ ...OTHER_FIELDS_ANSWERED, academicInterestProfile: emptyAcademicInterestProfile() }),
    );
    const nonInterestIds = result.questions.map((q) => q.id).filter((id) => !ALL_INTEREST_IDS.includes(id));
    expect(nonInterestIds).toEqual([]); // all 5 pre-existing fields were answered in OTHER_FIELDS_ANSWERED
  });

  test('interest question ordering is deterministic', async () => {
    const result = await cap.clarify(
      makeRequest({ ...OTHER_FIELDS_ANSWERED, academicInterestProfile: emptyAcademicInterestProfile() }),
    );
    const interestIds = result.questions.map((q) => q.id).filter((id) => ALL_INTEREST_IDS.includes(id));
    expect(interestIds).toEqual(ACTIONABLE_INTEREST_IDS);
  });

  test('question options expose only focus areas and styles with a grounded consumer', async () => {
    const result = await cap.clarify(
      makeRequest({ ...OTHER_FIELDS_ANSWERED, academicInterestProfile: emptyAcademicInterestProfile() }),
    );
    const focus = result.questions.find((q) => q.id === 'academic_focus_areas')!;
    const avoid = result.questions.find((q) => q.id === 'academic_avoid_areas')!;
    const style = result.questions.find((q) => q.id === 'course_style_preferences')!;
    expect(focus.options?.map((o) => o.value)).toEqual(GROUNDED_FOCUS_AREAS);
    expect(avoid.options?.map((o) => o.value)).toEqual(GROUNDED_FOCUS_AREAS);
    expect(style.options?.map((o) => o.value)).toEqual(GROUNDED_STYLES);
  });

  test('a career-goal-only profile cannot suppress actionable clarification', async () => {
    const result = await cap.clarify(makeRequest({
      ...OTHER_FIELDS_ANSWERED,
      academicInterestProfile: normalizeAcademicInterestProfile({ careerGoals: ['robotics research'] }),
    }));
    expect(result.questions.map((q) => q.id)).toEqual(ACTIONABLE_INTEREST_IDS);
  });

  test('unsupported selections cannot suppress actionable clarification', async () => {
    const result = await cap.clarify(makeRequest({
      ...OTHER_FIELDS_ANSWERED,
      academicInterestProfile: normalizeAcademicInterestProfile({
        focusAreas: [{ area: 'biomechanics', weight: 1 }],
        courseStylePreferences: [{ style: 'exam_light', weight: 1 }],
        optimizationPriorities: [{ priority: 'career_relevance', weight: 1 }],
      }),
    }));
    expect(result.questions.map((q) => q.id)).toEqual(ACTIONABLE_INTEREST_IDS);
  });

  test('no interest questions are produced when a grounded AcademicInterestProfile is present', async () => {
    const result = await cap.clarify(
      makeRequest({ ...OTHER_FIELDS_ANSWERED, academicInterestProfile: MEANINGFUL_PROFILE }),
    );
    const interestIds = result.questions.map((q) => q.id).filter((id) => ALL_INTEREST_IDS.includes(id));
    expect(interestIds).toEqual([]);
  });

  test('no interest questions are produced when academicInterestProfile is entirely absent (backward compatible)', async () => {
    const result = await cap.clarify(makeRequest(OTHER_FIELDS_ANSWERED));
    const interestIds = result.questions.map((q) => q.id).filter((id) => ALL_INTEREST_IDS.includes(id));
    expect(interestIds).toEqual([]);
  });

  test('does not mutate the request or the supplied academicInterestProfile', async () => {
    const profile = emptyAcademicInterestProfile();
    const req = makeRequest({ ...OTHER_FIELDS_ANSWERED, academicInterestProfile: profile });
    const snapshot = JSON.parse(JSON.stringify(req));
    await cap.clarify(req);
    expect(req).toEqual(snapshot);
  });
});
