/**
 * Per-turn planning state the agent's tools operate on (the Agents SDK run
 * `context`). The deterministic model + worker are the only source of academic
 * truth; preference updates rebuild them so the student's words become real
 * planner constraints, not prompt text.
 */
import type { ConversationEvent } from '../../../shared/planner/conversation-wire';
import { buildCourseFitById, buildModel } from '../generate-plan';
import { planContextToState } from '../planner_model';
import { PlannerWorker } from '../planner_worker';
import type { ConstraintModel } from '../planner_types';
import { storedDistributionPolicy } from '../planner_policy_context';
import type { AcademicFocusArea } from '../academic_interest_profile';
import type { ClarificationResult } from '../academic_decision_types';
import type { CandidateSet } from '../candidate_set';
import type { ScheduleCourse } from '../../../shared/planner/schedule';
import { fetchGroupsFromBidit, normalizeGroupsResponse } from '../schedule-groups';
import { resolveHardExcludedCourseIds } from '../academic_decision_runtime';

/** How many times the leave-out question was asked; stored with the preferences. */
export const EXCLUDED_ASKED_KEY = '__excluded_courses_asked';
/** Asked this many times without an answer ⇒ silence counts as "none". */
export const MAX_EXCLUDED_ASKS = 2;

export type ClarificationQuestionId =
  | 'completed_courses' | 'current_courses' | 'excluded_courses' | 'max_weekly_hours' | 'track_or_focus';

export interface AgentQuestion {
  questionHe: string;
  optionsHe: string[];
  questionId?: ClarificationQuestionId;
}

export interface AgentSubmission {
  summaryHe: string;
  tradeoffsHe: string[];
}

export interface PlanningSessionInput {
  programId: string;
  programBoard: unknown;
  /** Stored plan_context (personal status, progress). */
  planContext: Record<string, unknown>;
  /** plan_context with the committed board's semesters — the draft starts here. */
  committedContext: Record<string, unknown>;
  preferences: Record<string, unknown>;
  clarification: ClarificationResult;
  /** Weekly timetable source (tests inject one). Defaults to bid-it (unofficial). */
  fetchSchedule?: (courseIds: string[], semester: 1 | 2) => Promise<ScheduleCourse[]>;
}

export const fetchScheduleFromBidit = async (courseIds: string[], semester: 1 | 2): Promise<ScheduleCourse[]> =>
  normalizeGroupsResponse(await fetchGroupsFromBidit(courseIds, semester), courseIds, semester, new Date().toISOString()).courses;

export class PlanningSession {
  readonly events: ConversationEvent[] = [];
  preferences: Record<string, unknown>;
  preferencesChanged = false;
  model!: ConstraintModel;
  worker!: PlannerWorker;
  question?: AgentQuestion;
  submission?: AgentSubmission;
  /** The last build_plan search, reused for the proposal's extra alternatives. */
  candidateSet?: CandidateSet;
  /** Live listener (streaming responses); every event is also kept in `events`. */
  onEvent?: (event: ConversationEvent) => void;

  constructor(readonly input: PlanningSessionInput) {
    this.preferences = { ...input.preferences };
    // The leave-out question was asked twice and never answered: silence means none.
    if (!this.excludedCoursesKnown() && this.excludedCoursesAsked() >= MAX_EXCLUDED_ASKS) {
      this.preferences.disallowed_course_ids = [];
      this.preferencesChanged = true;
    }
    this.rebuild();
  }

  excludedCoursesKnown(): boolean {
    return resolveHardExcludedCourseIds(this.preferences as { disallowed_course_ids?: string[] }) !== undefined;
  }

  excludedCoursesAsked(): number {
    return Number(this.preferences[EXCLUDED_ASKED_KEY] ?? 0) || 0;
  }

  /** Critical inputs still missing — reflects answers recorded during this turn. */
  missingCriticalInputs() {
    return this.input.clarification.missingInputs.filter((input) =>
      input.critical && !(input.field === 'excludedCourses' && this.excludedCoursesKnown()));
  }

  /** Count an asked leave-out question (persisted like any preference). */
  recordAsked(questionId: ClarificationQuestionId | undefined): void {
    if (questionId !== 'excluded_courses') return;
    this.preferences = { ...this.preferences, [EXCLUDED_ASKED_KEY]: this.excludedCoursesAsked() + 1 };
    this.preferencesChanged = true;
  }

  /** Rebuild model + draft from the current preferences. Resets the draft to the committed board. */
  rebuild(): void {
    this.candidateSet = undefined;
    const focus = (Array.isArray(this.preferences.focus_areas) ? this.preferences.focus_areas : [])
      .map((area) => ({ area: area as AcademicFocusArea, weight: 1 }));
    const fit = buildCourseFitById(this.input.programBoard, focus, this.input.programId);
    this.model = buildModel(
      this.input.programBoard,
      this.input.planContext,
      this.preferences as any,
      this.input.programId,
      undefined,
      fit?.fitById,
      storedDistributionPolicy(this.preferences),
    );
    this.worker = new PlannerWorker(
      this.model,
      planContextToState(this.input.committedContext, this.model),
      { topN: 6, rolloutSteps: 80 },
    );
  }

  emit(event: ConversationEvent): void {
    this.events.push(event);
    this.onEvent?.(event);
  }

  updatePreferences(patch: Record<string, unknown>): void {
    this.preferences = { ...this.preferences, ...patch };
    this.preferencesChanged = true;
    this.rebuild();
  }
}
