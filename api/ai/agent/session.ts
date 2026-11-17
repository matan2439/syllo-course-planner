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
import { cloneState, type ConstraintModel } from '../planner_types';
import { analyzeLockConflicts, type LockConflict } from '../placement_locks';
import { emptyPlanningSession, SESSION_LIMITS, type DraftChange, type PlanningSessionState } from '../../../shared/planner/planning-session';
import { catalogYearFromUrl, offeringStatus, PLANNING_CATALOG_YEAR, type OfferingStatus } from '../../../shared/planner/offering-status';
import { defaultTermMapping } from '../../../shared/planner/schedule';
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
/** Student answered the specialization/direction intake question (or said "no preference"). */
export const INTAKE_DIRECTION_ANSWERED_KEY = '__intake_direction_answered';
/** Student answered the workload/schedule intake question (or said "no constraints"). */
export const INTAKE_WORKLOAD_ANSWERED_KEY = '__intake_workload_answered';
/** Student explicitly asked to skip intake and build immediately. */
export const INTAKE_SKIP_KEY = '__intake_skip_requested';

/** `year_2_semester_a` → 2 (0 for an id outside the convention). */
export const degreeYearOf = (semesterId: string) => Number(/^year_(\d+)_/.exec(semesterId)?.[1] ?? 0);

export type ClarificationQuestionId =
  | 'completed_courses' | 'current_courses' | 'excluded_courses' | 'max_weekly_hours' | 'track_or_focus' | 'degree_year';

export interface AgentQuestion {
  questionHe: string;
  optionsHe: string[];
  questionId?: ClarificationQuestionId;
}

export interface ProjectedPlacement { course_id: string; semester_id: string; status: 'projected' | 'unknown' }

export interface AgentSubmission {
  summaryHe: string;
  tradeoffsHe: string[];
  /** Placements whose offering is an estimate or unknown. Always disclosed with the proposal. */
  projectedPlacements?: ProjectedPlacement[];
  /**
   * Set when the proposal is PARTIAL: everything the planner added is valid, but a committed
   * course still breaks an availability rule. Shown with the proposal; never presented as valid.
   */
  unresolvedConflictsHe?: string[];
}

export interface PlanningSessionInput {
  /** The persisted planning session of this student, already rebased onto the live committed board. */
  restoredSession?: PlanningSessionState;
  /** Draft changes of the restored session that the board has since overtaken (reported, never forced). */
  droppedDraftChanges?: DraftChange[];
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
  /**
   * Committed courses the student explicitly released in this turn ("you may move X").
   * Everything else on the committed board is locked: never moved, removed or replaced.
   */
  readonly unlockedCourseIds = new Set<string>();
  /** Where the locked placements collide with a rule or a request — explained, never auto-fixed. */
  lockConflicts: LockConflict[] = [];
  /** The structured planning state that outlives this turn (profile, decisions, draft, summary). */
  planning: PlanningSessionState;
  /** Draft additions the student said yes to: pinned for the rest of the session, never re-planned. */
  readonly acceptedCourseIds = new Set<string>();
  /** Saved draft changes that could not be re-applied this turn (illegal now, locked, or unknown). */
  notReapplied: DraftChange[] = [];

  constructor(readonly input: PlanningSessionInput) {
    this.planning = input.restoredSession ?? emptyPlanningSession(input.programId, null, new Date().toISOString());
    for (const id of this.planning.unlocked_course_ids) this.unlockedCourseIds.add(id);
    for (const change of this.planning.draft_changes) if (change.kind === 'add' && change.accepted) this.acceptedCourseIds.add(change.course_id);
    this.preferences = { ...input.preferences };
    // The leave-out question was asked twice and never answered: silence means none.
    if (!this.excludedCoursesKnown() && this.excludedCoursesAsked() >= MAX_EXCLUDED_ASKS) {
      this.preferences.disallowed_course_ids = [];
      this.preferencesChanged = true;
    }
    this.rebuild();
    // A returning student: pick the draft up where it was left, around the committed board.
    if (this.planning.draft_changes.length) this.notReapplied = this.replayDraft(this.planning.draft_changes);
  }

  /**
   * What the draft changes relative to the committed board — the only part of a plan worth keeping
   * between turns (the board itself is never copied). Reasons recorded earlier are carried over.
   */
  draftChanges(): DraftChange[] {
    const committed = this.committedPlacements();
    const planned = new Map<string, string[]>();
    for (const [semesterId, ids] of Object.entries(this.worker.getPlan().semesters)) {
      for (const id of new Set(ids)) planned.set(id, [...(planned.get(id) ?? []), semesterId]);
    }
    const reasonOf = new Map(this.planning.draft_changes.map((change) => [`${change.kind}|${change.course_id}`, change.reason_he]));
    const changes: DraftChange[] = [];
    for (const [id, semesters] of planned) {
      const home = committed.get(id);
      if (!home) changes.push({ kind: 'add', course_id: id, semester_id: semesters[0], accepted: this.acceptedCourseIds.has(id), ...(reasonOf.get(`add|${id}`) ? { reason_he: reasonOf.get(`add|${id}`) } : {}) });
      else if (JSON.stringify([...home].sort()) !== JSON.stringify([...semesters].sort())) {
        changes.push({ kind: 'move', course_id: id, semester_id: semesters[0], accepted: false, ...(reasonOf.get(`move|${id}`) ? { reason_he: reasonOf.get(`move|${id}`) } : {}) });
      }
    }
    for (const [id] of committed) {
      if (!planned.has(id) && this.model.profiles.has(id) && !this.model.completedCourseIds.has(id)) {
        changes.push({ kind: 'remove', course_id: id, semester_id: null, accepted: false, ...(reasonOf.get(`remove|${id}`) ? { reason_he: reasonOf.get(`remove|${id}`) } : {}) });
      }
    }
    return changes.slice(0, SESSION_LIMITS.draftChanges);
  }

  /**
   * Re-apply saved draft changes on top of the committed board, through the same legality checks as
   * any other change. Returns the ones that no longer apply (they are reported, never forced).
   */
  replayDraft(changes: readonly DraftChange[]): DraftChange[] {
    const scratch = this.worker;
    const notApplied: DraftChange[] = [];
    for (const change of changes) {
      const id = change.course_id;
      if (!this.model.profiles.has(id) || (this.isLocked(id) && change.kind !== 'add')) { notApplied.push(change); continue; }
      try {
        const result = change.kind === 'add' ? scratch.addCourse(id, change.semester_id ?? undefined, 'llm')
          : change.kind === 'move' ? scratch.moveCourse(id, change.semester_id ?? '', 'llm')
            : scratch.removeCourse(id, 'llm');
        if (!result.accepted) notApplied.push(change);
      } catch { notApplied.push(change); }
    }
    for (const change of notApplied) if (change.kind === 'add') this.acceptedCourseIds.delete(change.course_id);
    // A new worker, so accepted additions are pinned where they now stand.
    this.worker = new PlannerWorker(this.model, cloneState(scratch.getPlan()), { topN: 6, rolloutSteps: 80 });
    return notApplied;
  }

  /** Rebuild from changed preferences or status WITHOUT throwing the draft away. */
  rebuildKeepingDraft(): DraftChange[] {
    const changes = this.draftChanges();
    this.rebuild();
    this.notReapplied = this.replayDraft(changes);
    return this.notReapplied;
  }

  /** The student said yes to these suggested additions: they stay exactly where the draft put them. */
  acceptDraftCourses(courseIds: readonly string[]): { accepted: string[]; notInDraft: string[] } {
    const inDraft = new Set(this.draftChanges().filter((change) => change.kind === 'add').map((change) => change.course_id));
    const accepted = courseIds.filter((id) => inDraft.has(id));
    for (const id of accepted) this.acceptedCourseIds.add(id);
    this.model.pinnedCourseIds = new Set([...this.model.pinnedCourseIds, ...accepted]);
    this.worker = new PlannerWorker(this.model, cloneState(this.worker.getPlan()), { topN: 6, rolloutSteps: 80 });
    return { accepted, notInDraft: courseIds.filter((id) => !inDraft.has(id)) };
  }

  /** Remember a decision the student made, in a line (newest last, bounded). */
  recordDecision(summaryHe: string, now = new Date().toISOString()): void {
    this.planning = { ...this.planning, decisions: [...this.planning.decisions, { at: now, summary_he: summaryHe.slice(0, 300) }].slice(-SESSION_LIMITS.decisions) };
  }

  /** The structured state to persist at the end of the turn (turns and summary are added by the caller). */
  planningState(now = new Date().toISOString()): PlanningSessionState {
    return {
      ...this.planning,
      draft_changes: this.draftChanges(),
      unlocked_course_ids: [...this.unlockedCourseIds].slice(0, 40),
      pending_question: this.question ? { question_he: this.question.questionHe.slice(0, 400), ...(this.question.questionId ? { question_id: this.question.questionId } : {}) } : null,
      updated_at: now,
    };
  }

  excludedCoursesKnown(): boolean {
    return resolveHardExcludedCourseIds(this.preferences as { disallowed_course_ids?: string[] }) !== undefined;
  }

  /**
   * True for a genuinely new planning session: no prior planning decisions and no restored
   * session. A returning student (even if starting over) has prior context and should not be
   * re-interrogated about basic preferences.
   */
  isNewPlanningSession(): boolean {
    return !this.input.restoredSession && this.planning.decisions.length === 0;
  }

  /**
   * True when at least one soft preference that shapes the plan is known:
   * focus areas (specialization direction), workload cap, or free days.
   * Used together with isNewPlanningSession() to gate build_plan on a brief
   * conversational intake before the first ever plan.
   */
  hasSoftPreferences(): boolean {
    const prefs = this.preferences as Record<string, unknown>;
    return (Array.isArray(prefs.focus_areas) && (prefs.focus_areas as unknown[]).length > 0)
      || typeof prefs.max_weekly_hours === 'number'
      || (Array.isArray(prefs.free_days) && (prefs.free_days as unknown[]).length > 0)
      || prefs[INTAKE_DIRECTION_ANSWERED_KEY] === true
      || prefs[INTAKE_WORKLOAD_ANSWERED_KEY] === true
      || prefs[INTAKE_SKIP_KEY] === true;
  }

  /** Student answered (or skipped) the specialization/direction question. */
  intakeDirectionKnown(): boolean {
    const prefs = this.preferences as Record<string, unknown>;
    return (Array.isArray(prefs.focus_areas) && (prefs.focus_areas as unknown[]).length > 0)
      || prefs[INTAKE_DIRECTION_ANSWERED_KEY] === true
      || prefs[INTAKE_SKIP_KEY] === true;
  }

  /** Student answered (or skipped) the workload/schedule question. */
  intakeWorkloadKnown(): boolean {
    const prefs = this.preferences as Record<string, unknown>;
    return typeof prefs.max_weekly_hours === 'number'
      || (Array.isArray(prefs.free_days) && (prefs.free_days as unknown[]).length > 0)
      || prefs[INTAKE_WORKLOAD_ANSWERED_KEY] === true
      || prefs[INTAKE_SKIP_KEY] === true;
  }

  /** True when the student has given enough intake context for a first plan. */
  intakeComplete(): boolean {
    return this.preferredCoursesKnown() && this.excludedCoursesKnown()
      && (this.intakeDirectionKnown() || this.intakeWorkloadKnown());
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

  /** How sure we are that the course runs in that semester: confirmed, projected, unavailable or unknown. */
  offeringStatusOf(courseId: string, semesterId: string): OfferingStatus {
    const profile = this.model.profiles.get(courseId);
    if (!profile) return 'unknown';
    const mapping = defaultTermMapping(this.model.knownSemesterIds, new Date(), this.input.currentDegreeYear);
    return offeringStatus(semesterId, mapping[semesterId], {
      allowedSemesterIds: legalSemestersFor(this.model, courseId),
      offeredInCatalogYear: profile.offered_in_year,
      catalogYear: catalogYearFromUrl(profile.provenance.offering_source_url) ?? PLANNING_CATALOG_YEAR,
    });
  }

  /** Every placement in the draft that rests on an estimate (or on nothing): never to be stated as fact. */
  projectedPlacements(): ProjectedPlacement[] {
    return Object.entries(this.worker.getPlan().semesters).flatMap(([semester_id, ids]) => [...new Set(ids)].flatMap((course_id) => {
      const status = this.offeringStatusOf(course_id, semester_id);
      return status === 'projected' || status === 'unknown' ? [{ course_id, semester_id, status }] : [];
    }));
  }

  /** Locked placements: every committed course the student has not completed or released. */
  lockedPlacements(): Map<string, string[]> {
    const locked = new Map<string, string[]>();
    for (const [id, homes] of this.committedPlacements()) {
      if (this.unlockedCourseIds.has(id) || this.model.completedCourseIds.has(id) || !this.model.profiles.has(id)) continue;
      locked.set(id, homes);
    }
    return locked;
  }

  isLocked(courseId: string): boolean {
    return this.lockedPlacements().has(courseId);
  }

  /** Locked placements the draft no longer has exactly where the student put them. */
  lockViolations(): Array<{ course_id: string; semester_id: string }> {
    const plan = this.worker.getPlan().semesters;
    return [...this.lockedPlacements()].flatMap(([course_id, homes]) => homes
      .filter((semester_id) => !(plan[semester_id] ?? []).includes(course_id))
      .map((semester_id) => ({ course_id, semester_id })));
  }

  /** The student released these courses: the planner may now change them. The draft is kept. */
  unlock(courseIds: readonly string[]): void {
    for (const id of courseIds) this.unlockedCourseIds.add(id);
    const draft = cloneState(this.worker.getPlan());
    this.rebuildModel();
    this.worker = new PlannerWorker(this.model, draft, { topN: 6, rolloutSteps: 80 });
  }

  /**
   * Make every locked placement a planner constraint: pinned to its semester. A locked course the
   * student asked to avoid is kept (a preference never removes a commitment). A locked course that
   * breaks an academic rule — not offered, or in a semester it is not given in — also stays where
   * the student put it, but the rule is NOT relaxed: the plan is invalid until the student decides,
   * and `lockConflicts` explains it with the valid alternatives.
   */
  private applyLocks(): void {
    const avoided = new Set<string>();
    const unavailable = new Map<string, string | null>();
    const locked = this.lockedPlacements();
    for (const id of locked.keys()) {
      this.model.pinnedCourseIds.add(id);
      const profile = this.model.profiles.get(id)!;
      const wasAvoided = this.model.disallowedCourseIds.delete(id);
      if (wasAvoided) {
        avoided.add(id);
        // `excluded` came from the student's own avoid request; catalog exclusions stay in force.
        const catalogExcluded = profile.offered_in_year === false || profile.hours == null || !profile.name_he;
        if (profile.excluded && !catalogExcluded) this.model.profiles.set(id, { ...profile, excluded: false, exclusion_reason: null });
        else if (profile.excluded) unavailable.set(id, 'הקורס אינו נלמד בשנת הלימודים הנוכחית או שחסרים לו נתוני קטלוג.');
      } else if (profile.excluded) {
        unavailable.set(id, profile.exclusion_reason);
      }
    }
    // Draft additions the student accepted are pinned for the session as well.
    for (const id of this.acceptedCourseIds) if (this.model.profiles.has(id)) this.model.pinnedCourseIds.add(id);
    this.lockConflicts = analyzeLockConflicts({ model: this.model, placements: locked, avoided, unavailable });
  }

  /** True while a locked placement breaks an academic rule: no plan containing it may be presented as valid. */
  hasInvalidLockedPlacement(): boolean {
    return this.lockConflicts.some((conflict) => conflict.blocksValidity);
  }

  /**
   * The model the planner SEARCHES with: identical, except that invalid locked placements are
   * tolerated where they stand, so the rest of the board can still be planned around them.
   * Validation always uses the strict `model`, so such a plan is never reported as valid.
   */
  searchModel(): ConstraintModel {
    if (!this.hasInvalidLockedPlacement()) return this.model;
    const profiles = new Map(this.model.profiles);
    const locked = this.lockedPlacements();
    for (const conflict of this.lockConflicts) {
      if (!conflict.blocksValidity) continue;
      for (const id of conflict.courseIds) {
        const profile = profiles.get(id);
        const homes = locked.get(id);
        if (!profile || !homes) continue;
        profiles.set(id, {
          ...profile, excluded: false, exclusion_reason: null,
          offering_window_semesters: [...new Set([...legalSemestersFor(this.model, id), ...homes])],
        });
      }
    }
    return { ...this.model, profiles };
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
    this.rebuildKeepingDraft();
  }

  /** Count an asked leave-out question (persisted like any preference). */
  recordAsked(questionId: ClarificationQuestionId | undefined): void {
    if (questionId !== 'excluded_courses') return;
    this.preferences = { ...this.preferences, [EXCLUDED_ASKED_KEY]: this.excludedCoursesAsked() + 1 };
    this.preferencesChanged = true;
  }

  /** Rebuild model + draft from the current preferences. Resets the draft to the committed board. */
  rebuild(): void {
    this.rebuildModel();
    this.worker = new PlannerWorker(
      this.model,
      planContextToState(this.input.committedContext, this.model),
      { topN: 6, rolloutSteps: 80 },
    );
  }

  private rebuildModel(): void {
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
    this.applyLocks();
    this.applyScope();
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
    this.rebuildKeepingDraft();
  }
}
