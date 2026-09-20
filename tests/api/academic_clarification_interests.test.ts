/**
 * Academic-interest gating at the pre-plan clarification boundary.
 *
 * This capability runs before candidates exist, so it cannot truthfully know
 * whether a preference changes a recommendation. Interest questions belong to
 * DeterministicPreferenceElicitation, which receives the server-computed impact
 * contract after Generate. Typed profiles remain accepted as input, but never
 * manufacture a generic questionnaire here.
 */
import { DeterministicClarificationCapability } from '../../api/ai/academic_clarification';
import type { ClarificationPlanningContext } from '../../api/ai/academic_decision_types';
import {
  emptyAcademicInterestProfile,
  normalizeAcademicInterestProfile,
} from '../../api/ai/academic_interest_profile';

const cap = new DeterministicClarificationCapability();
const INTEREST_IDS = [
  'academic_focus_areas',
  'academic_avoid_areas',
  'course_style_preferences',
  'optimization_priorities',
  'career_goals',
];
const OTHER_FIELDS_ANSWERED: ClarificationPlanningContext = {
  completedCourseIds: ['c1'],
  currentCourseIds: ['c2'],
  excludedCourseIds: [],
  maxWeeklyHours: 20,
  track: 'systems',
};

async function interestQuestionIds(context: ClarificationPlanningContext): Promise<string[]> {
  const result = await cap.clarify({ gaps: [], context });
  return result.questions.map((question) => question.id).filter((id) => INTEREST_IDS.includes(id));
}

describe('DeterministicClarificationCapability — impact-gated academic interests', () => {
  test('an explicit empty profile does not create a generic interest questionnaire', async () => {
    expect(await interestQuestionIds({
      ...OTHER_FIELDS_ANSWERED,
      academicInterestProfile: emptyAcademicInterestProfile(),
    })).toEqual([]);
  });

  test('career-goal-only and unsupported-only profiles do not create questions', async () => {
    const careerOnly = normalizeAcademicInterestProfile({ careerGoals: ['robotics research'] });
    const unsupportedOnly = normalizeAcademicInterestProfile({
      focusAreas: [{ area: 'biomechanics', weight: 1 }],
      courseStylePreferences: [{ style: 'exam_light', weight: 1 }],
      optimizationPriorities: [{ priority: 'career_relevance', weight: 1 }],
    });
    expect(await interestQuestionIds({ ...OTHER_FIELDS_ANSWERED, academicInterestProfile: careerOnly })).toEqual([]);
    expect(await interestQuestionIds({ ...OTHER_FIELDS_ANSWERED, academicInterestProfile: unsupportedOnly })).toEqual([]);
  });

  test('an already-grounded profile is accepted without being re-asked', async () => {
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    expect(await interestQuestionIds({ ...OTHER_FIELDS_ANSWERED, academicInterestProfile: profile })).toEqual([]);
  });

  test('an absent profile preserves pre-interest caller behavior', async () => {
    expect(await interestQuestionIds(OTHER_FIELDS_ANSWERED)).toEqual([]);
  });

  test('critical academic-status clarification remains unchanged', async () => {
    const result = await cap.clarify({ gaps: [], context: { academicInterestProfile: emptyAcademicInterestProfile() } });
    expect(result.questions).toContainEqual(expect.objectContaining({ id: 'completed_courses', critical: true }));
    expect(result.questions).toContainEqual(expect.objectContaining({ id: 'excluded_courses', critical: true }));
    expect(result.questions.map((question) => question.id).filter((id) => INTEREST_IDS.includes(id))).toEqual([]);
  });

  test('does not mutate a supplied profile', async () => {
    const profile = emptyAcademicInterestProfile();
    const before = JSON.parse(JSON.stringify(profile));
    await cap.clarify({ gaps: [], context: { ...OTHER_FIELDS_ANSWERED, academicInterestProfile: profile } });
    expect(profile).toEqual(before);
  });
});
