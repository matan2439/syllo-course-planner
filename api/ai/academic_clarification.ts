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
};

export class DeterministicClarificationCapability implements ClarificationCapability {
  async clarify(request: ClarificationRequest): Promise<ClarificationResult> {
    const { context } = request;
    const missingInputs: MissingInput[] = [];

    if (!context.completedCourseIds || context.completedCourseIds.length === 0) {
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
