/**
 * DeterministicClarificationCapability — a rule-based, non-LLM
 * ClarificationCapability (academic_decision_types.ts). Inspects the
 * ClarificationPlanningContext for missing planning inputs before Plan runs,
 * and turns each finding into both a MissingInput (loose, internal) and a
 * ClarificationQuestion (stable, machine-readable — the contract a future UI
 * or LLM layer can act on directly).
 *
 * Purely observational: reporting a missing input never blocks planning by
 * itself — AcademicDecisionAgent decides whether to block, and only when the
 * caller opts in via `blockOnMissingCriticalInputs` (academic_decision_agent.ts).
 *
 * `critical` marks inputs whose absence can produce an actually wrong plan
 * (missing completed courses breaks prerequisite/eligibility checks; missing
 * excluded courses risks re-scheduling a course the user explicitly forbade).
 * The rest are soft preferences the planner already tolerates being unset.
 */

import type {
  ClarificationAnswerType,
  ClarificationCapability,
  ClarificationQuestion,
  ClarificationRequest,
  ClarificationResult,
  MissingInput,
  MissingInputField,
} from './academic_decision_types';
import {
  OPTIMIZATION_PRIORITIES,
} from './academic_interest_profile';
import {
  GROUNDED_COURSE_STYLES,
  GROUNDED_FOCUS_AREAS,
  groundedTopicsForFocusAreas,
} from './focus_topic_objective';

/** Title-case a snake_case enum value for use as a ClarificationQuestion option label. */
function toOptionLabel(value: string): string {
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function toOptions(values: readonly string[]): Array<{ value: string; label: string }> {
  return values.map((value) => ({ value, label: toOptionLabel(value) }));
}

interface QuestionSpec {
  id: string;
  inputKey: string;
  required: boolean;
  answerType: ClarificationAnswerType;
  question: string;
  rationale?: string;
  examples?: string[];
  options?: Array<{ value: string; label: string }>;
}

/** Deterministic ordering (object key order): completed -> current -> excluded -> maxWeeklyHours -> track. */
const QUESTION_SPECS: Record<MissingInputField, QuestionSpec> = {
  completedCourses: {
    id: 'completed_courses',
    inputKey: 'completedCourseIds',
    required: true,
    answerType: 'course_id_list',
    question: 'Which courses have you already completed?',
    rationale: 'Prerequisite validation and advanced-course eligibility depend on this.',
  },
  currentCourses: {
    id: 'current_courses',
    inputKey: 'currentCourseIds',
    required: false,
    answerType: 'course_id_list',
    question: 'Which courses are you currently taking?',
    rationale: 'Prevents blocking a follow-up course whose prerequisite is already in progress.',
  },
  excludedCourses: {
    id: 'excluded_courses',
    inputKey: 'excludedCourseIds',
    required: true,
    answerType: 'course_id_list',
    question: 'Are there any courses you want to exclude from your plan?',
    rationale: 'Prevents re-scheduling a course the user explicitly forbade.',
  },
  maxWeeklyHours: {
    id: 'max_weekly_hours',
    inputKey: 'maxWeeklyHours',
    required: false,
    answerType: 'number',
    question: 'What is your maximum weekly course-hour limit?',
  },
  track: {
    id: 'track_or_focus',
    inputKey: 'track',
    required: false,
    answerType: 'text',
    question: 'Which track or focus area are you pursuing?',
    examples: ['design', 'analysis', 'systems'],
  },
  academicFocusAreas: {
    id: 'academic_focus_areas',
    inputKey: 'academicInterestProfile.focusAreas',
    required: false,
    answerType: 'multi_choice',
    question: 'Which academic areas are you most interested in focusing on?',
    rationale: 'Helps align course selection with grounded topic evidence.',
    options: toOptions(GROUNDED_FOCUS_AREAS),
  },
  academicAvoidAreas: {
    id: 'academic_avoid_areas',
    inputKey: 'academicInterestProfile.avoidAreas',
    required: false,
    answerType: 'multi_choice',
    question: 'Are there any academic areas you would prefer to avoid?',
    options: toOptions(GROUNDED_FOCUS_AREAS),
  },
  courseStylePreferences: {
    id: 'course_style_preferences',
    inputKey: 'academicInterestProfile.courseStylePreferences',
    required: false,
    answerType: 'multi_choice',
    question: 'What evidence-backed course styles do you prefer?',
    options: toOptions(GROUNDED_COURSE_STYLES),
  },
  optimizationPriorities: {
    id: 'optimization_priorities',
    inputKey: 'academicInterestProfile.optimizationPriorities',
    required: false,
    answerType: 'multi_choice',
    question: 'What should we prioritize when building your plan?',
    options: toOptions(OPTIMIZATION_PRIORITIES),
  },
  careerGoals: {
    id: 'career_goals',
    inputKey: 'academicInterestProfile.careerGoals',
    required: false,
    answerType: 'text',
    question: 'What are your career goals after graduation?',
    examples: ['automotive design', 'robotics research', 'industry R&D'],
  },
};

export class DeterministicClarificationCapability implements ClarificationCapability {
  async clarify(request: ClarificationRequest): Promise<ClarificationResult> {
    const { context } = request;
    const missingInputs: MissingInput[] = [];

    // An empty list is a GAP only while the set is unknown. An explicit
    // "I have completed no courses" (completedCoursesKnown) is a real answer and
    // resolves it — the check is not weakened, it stops conflating "none" with
    // "never asked" (academic_status_knowledge.ts).
    if (!context.completedCoursesKnown && (!context.completedCourseIds || context.completedCourseIds.length === 0)) {
      missingInputs.push({
        field: 'completedCourses',
        critical: true,
        message: QUESTION_SPECS.completedCourses.question,
      });
    }

    if (!context.currentCourseIds || context.currentCourseIds.length === 0) {
      missingInputs.push({
        field: 'currentCourses',
        critical: false,
        message: QUESTION_SPECS.currentCourses.question,
      });
    }

    if (context.excludedCourseIds === undefined) {
      missingInputs.push({
        field: 'excludedCourses',
        critical: true,
        message: QUESTION_SPECS.excludedCourses.question,
      });
    }

    if (context.maxWeeklyHours === undefined) {
      missingInputs.push({
        field: 'maxWeeklyHours',
        critical: false,
        message: QUESTION_SPECS.maxWeeklyHours.question,
      });
    }

    if (!context.track) {
      missingInputs.push({
        field: 'track',
        critical: false,
        message: QUESTION_SPECS.track.question,
      });
    }

    // Opt-in: ask only when the caller explicitly supplies a profile and no
    // evidence-backed preference reaches the current planner. Merely typed but
    // unsupported values must not suppress a question that can change planning.
    // An absent profile keeps every pre-interest caller unchanged.
    const interestProfile = context.academicInterestProfile;
    const hasActionableInterest = interestProfile !== undefined && (
      groundedTopicsForFocusAreas(interestProfile.focusAreas).length > 0
      || groundedTopicsForFocusAreas(interestProfile.avoidAreas).length > 0
      || interestProfile.courseStylePreferences.some((entry) =>
        entry.weight > 0 && GROUNDED_COURSE_STYLES.includes(entry.style as (typeof GROUNDED_COURSE_STYLES)[number]))
    );
    if (interestProfile !== undefined && !hasActionableInterest) {
      missingInputs.push(
        { field: 'academicFocusAreas', critical: false, message: QUESTION_SPECS.academicFocusAreas.question },
        { field: 'academicAvoidAreas', critical: false, message: QUESTION_SPECS.academicAvoidAreas.question },
        {
          field: 'courseStylePreferences',
          critical: false,
          message: QUESTION_SPECS.courseStylePreferences.question,
        },
      );
    }

    const questions: ClarificationQuestion[] = missingInputs.map((missingInput) => {
      const spec = QUESTION_SPECS[missingInput.field];
      return {
        id: spec.id,
        inputKey: spec.inputKey,
        required: spec.required,
        critical: missingInput.critical,
        answerType: spec.answerType,
        question: spec.question,
        rationale: spec.rationale,
        examples: spec.examples,
        options: spec.options,
      };
    });

    return {
      needsClarification: missingInputs.length > 0,
      missingInputs,
      questions,
    };
  }
}
