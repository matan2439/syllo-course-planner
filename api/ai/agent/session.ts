/**
 * Per-turn planning state the agent's tools operate on (the Agents SDK run
 * `context`). The deterministic model + worker are the only source of academic
 * truth; preference updates rebuild them so the student's words become real
 * planner constraints, not prompt text.
 */
import type { ConversationEvent } from '../../../shared/planner/conversation-wire';
import { buildCourseFitById, buildModel } from '../generate-plan';
import { planContextToState } from '../planner_model';
import { legalSemestersFor } from '../planner_actions';
import { PlannerWorker } from '../planner_worker';
import type { ConstraintModel } from '../planner_types';
import { storedDistributionPolicy } from '../planner_policy_context';
import type { AcademicFocusArea } from '../academic_interest_profile';
import type { ClarificationResult } from '../academic_decision_types';
import type { CandidateSet } from '../candidate_set';
import type { ScheduleCourse } from '../../../shared/planner/schedule';
import { fetchGroupsFromBidit, normalizeGroupsResponse } from '../schedule-groups';
import { resolveHardExcludedCourseIds } from '../academic_decision_runtime';
import { withCompletedCredit } from '../conversation_clarification';
import { defaultCourseInsights, type CourseInsightsProvider } from '../course_insights';

/** How many times the leave-out question was asked; stored with the preferences. */
export const EXCLUDED_ASKED_KEY = '__excluded_courses_asked';
/** Asked this many times without an answer ⇒ silence counts as "none". */
export const MAX_EXCLUDED_ASKS = 2;
/** The student was asked which courses they would like included; stored with the preferences. */
export const PREFERRED_ASKED_KEY = '__preferred_courses_asked';
/** The student answered that question (with courses or "none"). */
export const PREFERRED_ANSWERED_KEY = '__preferred_courses_answered';

/** `year_2_semester_a` → 2 (0 for an id outside the convention). */
export const degreeYearOf = (semesterId: string) => Number(/^year_(\d+)_/.exec(semesterId)?.[1] ?? 0);

export type ClarificationQuestionId =
  | 'completed_courses' | 'current_courses' | 'excluded_courses' | 'max_weekly_hours' | 'track_or_focus' | 'degree_year';

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
  /** The student's year in the degree (1–4) from their profile; null when they have not said. */
  currentDegreeYear?: number | null;
  /** Stored plan_context (personal status, progress). */
  planContext: Record<string, unknown>;
  /** plan_context with the committed board's semesters — the draft starts here. */
  committedContext: Record<string, unknown>;
  preferences: Record<string, unknown>;
  clarification: ClarificationResult;
  /** Weekly timetable source (tests inject one). Defaults to bid-it (unofficial). */
  fetchSchedule?: (courseIds: string[], semester: 1 | 2) => Promise<ScheduleCourse[]>;
  /** Grade statistics + live syllabus (tests inject one). Defaults to the configured live sources. */
  insights?: CourseInsightsProvider;
}

export const fetchScheduleFromBidit = async (courseIds: string[], semester: 1 | 2): Promise<ScheduleCourse[]> =>
  normalizeGroupsResponse(await fetchGroupsFromBidit(courseIds, semester), courseIds, semester, new Date().toISOString()).courses;

export class PlanningSession {
  readonly events: ConversationEvent[] = [];
  preferences: Record<string, unknown>;
  preferencesChanged = false;
  /** The agent recorded the student's completed courses this turn. */
  academicStatusChanged = false;
  model!: ConstraintModel;
  worker!: PlannerWorker;
  question?: AgentQuestion;
  submission?: AgentSubmission;
  /** The last build_plan search, reused for the proposal's extra alternatives. */
  candidateSet?: CandidateSet;
  /** Live listener (streaming responses); every event is also kept in `events`. */
  onEvent?: (event: ConversationEvent) => void;
  /**
   * Degree years this turn's plan may change ("year 4 only"); undefined = the whole board.
   * A hard constraint: new courses go only into these years and placed courses outside them stay put.
   */
  scopeYears?: number[];

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

  /**
   * Which courses the student would like included is known: some are stored, they answered
   * (also "none"), or they were asked in an earlier turn and did not name any.
   */
  preferredCoursesKnown(): boolean {
    const wanted = this.preferences.wanted_course_ids;
    return (Array.isArray(wanted) && wanted.length > 0)
      || this.preferences[PREFERRED_ANSWERED_KEY] === true
      || (this.preferences[PREFERRED_ASKED_KEY] === true && !this.preferredAskedThisTurn);
  }

  private preferredAskedThisTurn = false;

  /** The agent's question also asked which courses to include (persisted like any preference). */
  recordPreferredAsked(): void {
    this.preferredAskedThisTurn = true;
    this.preferences = { ...this.preferences, [PREFERRED_ASKED_KEY]: true };
    this.preferencesChanged = true;
  }

  /** Where each committed course sits on the board. */
  committedPlacements(): Map<string, string[]> {
    const placed = new Map<string, string[]>();
    for (const semester of (this.input.committedContext.semesters ?? []) as Array<{ id?: string; courses?: Array<{ course_id?: string }> }>) {
      for (const course of semester?.courses ?? []) {
        if (typeof course?.course_id !== 'string' || typeof semester.id !== 'string') continue;
        placed.set(course.course_id, [...(placed.get(course.course_id) ?? []), semester.id]);
      }
    }
    return placed;
  }

  /** Limit this turn's planning to these degree years (null = the whole board). Resets the draft. */
  setScope(years: readonly number[] | null): void {
    const next = years?.length ? [...new Set(years)].sort() : undefined;
    if (JSON.stringify(next) === JSON.stringify(this.scopeYears)) return;
    this.scopeYears = next;
    this.rebuild();
  }

  /** Placements the draft makes outside the requested scope (a course new to that semester). */
  outOfScopePlacements(): Array<{ course_id: string; semester_id: string }> {
    if (!this.scopeYears) return [];
    const committed = this.committedPlacements();
    return Object.entries(this.worker.getPlan().semesters).flatMap(([semester_id, ids]) =>
      this.scopeYears!.includes(degreeYearOf(semester_id)) ? []
        : ids.filter((id) => !committed.get(id)?.includes(semester_id)).map((course_id) => ({ course_id, semester_id })));
  }

  /**
   * Placements outside the requested scope that the draft no longer has — a removal the scope
   * forbids. A course that left the board because it is now completed or avoided is not one.
   */
  outOfScopeRemovals(): Array<{ course_id: string; semester_id: string }> {
    if (!this.scopeYears) return [];
    const plan = this.worker.getPlan().semesters;
    return [...this.committedPlacements()].flatMap(([course_id, homes]) => homes
      .filter((semester_id) => !this.scopeYears!.includes(degreeYearOf(semester_id))
        && !(plan[semester_id] ?? []).includes(course_id)
        && !this.model.completedCourseIds.has(course_id) && !this.model.disallowedCourseIds.has(course_id))
      .map((semester_id) => ({ course_id, semester_id })));
  }

  /**
   * Make the scope a planner constraint: a course may be placed only in a scope semester it is
   * offered in; a course already placed outside the scope keeps exactly its place. Profiles are
   * copied, never edited in place (they are shared with the profile cache).
   */
  private applyScope(): void {
    const years = this.scopeYears;
    if (!years) return;
    const inScope = (semesterId: string) => years.includes(degreeYearOf(semesterId));
    const committed = this.committedPlacements();
    for (const [id, profile] of this.model.profiles) {
      const home = committed.get(id);
      if (home?.some((semesterId) => !inScope(semesterId))) {
        this.model.profiles.set(id, { ...profile, effective_allowed_semesters: home });
        continue;
      }
      const allowed = [...new Set([...(home ?? []), ...legalSemestersFor(this.model, id).filter(inScope)])];
      this.model.profiles.set(id, allowed.length
        ? { ...profile, effective_allowed_semesters: allowed }
        : { ...profile, excluded: true, exclusion_reason: 'Not offered in the degree years the student asked to plan.' });
    }
  }

  /** Critical inputs still missing — reflects answers recorded during this turn. */
  missingCriticalInputs() {
    return this.input.clarification.missingInputs.filter((input) =>
      input.critical
      && !(input.field === 'excludedCourses' && this.excludedCoursesKnown())
      && !(input.field === 'completedCourses' && this.academicStatusChanged));
  }

  completedCourseIds(): string[] {
    const personal = (this.input.planContext.personal_status ?? {}) as { completed?: Array<{ course_id?: unknown } | string> };
    return (personal.completed ?? [])
      .map((course) => typeof course === 'string' ? course : course?.course_id)
      .filter((id): id is string => typeof id === 'string');
  }

  /** Record what the student completed (a known list) and the degree credit it carries. */
  setCompletedCourses(courseIds: readonly string[]): void {
    const personal = {
      ...(this.input.planContext.personal_status as Record<string, unknown> | undefined),
      completed: [...new Set(courseIds)].map((course_id) => ({ course_id })),
      completed_knowledge: { status: 'known', provenance: 'explicit_user' },
    };
    this.input.planContext = withCompletedCredit(
      { ...this.input.planContext, personal_status: personal }, this.input.programId, this.input.programBoard,
      this.completedCourseIds());
    this.academicStatusChanged = true;
    this.rebuild();
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
      // The committed board, not the stored context, decides which courses are already placed.
      ((this.input.committedContext.semesters ?? []) as any[])
        .flatMap((s) => (s?.courses ?? []).map((c: any) => c?.course_id)),
    );
    this.applyScope();
    this.worker = new PlannerWorker(
      this.model,
      planContextToState(this.input.committedContext, this.model),
      { topN: 6, rolloutSteps: 80 },
    );
  }

  get insights(): CourseInsightsProvider {
    return this.input.insights ?? defaultCourseInsights();
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
