/**
 * DeterministicClarificationCapability — a rule-based, non-LLM
 * ClarificationCapability (academic_decision_types.ts). Inspects the
 * ClarificationPlanningContext for missing planning inputs before Plan runs.
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
  ClarificationCapability,
  ClarificationRequest,
  ClarificationResult,
  MissingInput,
} from './academic_decision_types';

export class DeterministicClarificationCapability implements ClarificationCapability {
  async clarify(request: ClarificationRequest): Promise<ClarificationResult> {
    const { context } = request;
    const missingInputs: MissingInput[] = [];

    if (!context.completedCourseIds || context.completedCourseIds.length === 0) {
      missingInputs.push({
        field: 'completedCourses',
        critical: true,
        message: 'Which courses have you already completed?',
      });
    }

    if (!context.currentCourseIds || context.currentCourseIds.length === 0) {
      missingInputs.push({
        field: 'currentCourses',
        critical: false,
        message: 'Which courses are you currently taking?',
      });
    }

    if (context.excludedCourseIds === undefined) {
      missingInputs.push({
        field: 'excludedCourses',
        critical: true,
        message: 'Are there any courses you want to exclude from your plan?',
      });
    }

    if (context.maxWeeklyHours === undefined) {
      missingInputs.push({
        field: 'maxWeeklyHours',
        critical: false,
        message: 'What is your maximum weekly course-hour limit?',
      });
    }

    if (!context.track) {
      missingInputs.push({
        field: 'track',
        critical: false,
        message: 'Which track or focus area are you pursuing?',
      });
    }

    return {
      needsClarification: missingInputs.length > 0,
      missingInputs,
      questions: missingInputs.length > 0 ? missingInputs.map((m) => m.message) : undefined,
    };
  }
}
