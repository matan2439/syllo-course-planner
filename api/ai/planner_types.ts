/**
 * Shared types for the Planner Worker: the deterministic constraint model and
 * the mutable plan state the Observe→Reason→Act→Validate loop operates on.
 * Kept in their own module so planner_goals / planner_lookahead / planner_worker
 * can share them without a circular import.
 */

import type { CourseProfile } from './course_profile';

/** An elective/requirement category the plan must satisfy. */
export interface CategoryReq {
  id: string;
  name: string;
  /** Minimum number of courses required from this category. */
  required: number;
  /** Eligible candidate course_ids for this category (full pool, not truncated). */
  candidateIds: string[];
}

/**
 * The deterministic constraint model — the single source of truth for every
 * hard fact the worker reasons over. Built once in LOAD_CONTEXT /
 * BUILD_CONSTRAINT_MODEL from the program board_json + the user's status.
 */
/**
 * Semester-distribution policy the scorer applies to its OWNED slots (g4a/g4b)
 * only. 'neutral' (default/undefined) is the legacy baseline; 'balanced' keeps
 * the legacy peak-then-spread preference; 'compact' rewards fewer ACTIVE periods
 * (order-invariant consolidation), never an earlier period. It never affects
 * completion, legality, requirements, or any higher-priority objective.
 */
export type DistributionPolicy = 'balanced' | 'compact' | 'neutral';

export interface ConstraintModel {
  /** CourseProfile for every course in the eligible universe. */
  profiles: Map<string, CourseProfile>;
  /** Canonical semester ids for this plan, in chronological order. */
  knownSemesterIds: string[];
  /** Courses the user already completed (never re-placed). */
  completedCourseIds: Set<string>;
  /** Courses the user is currently taking/in-progress (already accounted for as prior progress; must not be re-proposed). Always set by buildConstraintModel (defaults to empty); optional here so hand-built fixtures don't need to supply it. */
  currentlyPlannedCourseIds?: Set<string>;
  /** Not-completed mandatory course_ids that must appear in the plan. */
  requiredMandatoryCourseIds: string[];
  categories: CategoryReq[];
  /** Total degree hours required (e.g. 185). */
  degreeRequiredHours: number;
  /** Hours already accrued (completed + currently-planned) counted toward the degree. */
  priorHours: number;
  /** User's per-semester weekly-hour preference cap. */
  maxHoursPerSemester: number;
  /** Absolute per-semester blocking cap (HARD_LOAD_CAP). */
  hardCap: number;
  /** Phase 1b — preferred-range ceiling above which a mild-overload warning fires. Defaults to SOFT_LOAD_MAX. */
  softLoadMax?: number;
  /** Phase 1b — never-overridable blocking ceiling. Defaults to ABSOLUTE_MAX_REASONABLE. */
  absoluteMaxReasonable?: number;
  /** Phase 2C — user explicitly clicked "אפשר חריגה בעומס" (downgrades hardCap-only overload to a warning). */
  overloadAccepted?: boolean;
  /** Phase 2C — timestamp of that confirmation. Required alongside overloadAccepted to actually bypass hardCap. */
  overloadConfirmedAt?: number | null;
  /**
   * HARD exclusion (`must_exclude_course_ids`) — explicit user exclusion /
   * disallowed. What the user-facing "avoided" picker feeds. Never overridable
   * by completion, distribution, interest, difficulty, or candidate diversity.
   */
  disallowedCourseIds: Set<string>;
  /** Pinned course_ids that must stay in their current semester. */
  pinnedCourseIds: Set<string>;
  /**
   * Slice 18A — HARD inclusion (`must_include_course_ids`). Every applicable id
   * here MUST be satisfied (already completed, currently taking, or actually
   * scheduled) for a plan to be valid; `validateCandidate` rejects a proposal
   * missing one, so no score can trade it away. This is what the user-facing
   * "wanted" picker feeds under current product policy. Optional purely so
   * hand-built fixtures predating it don't have to supply it (same precedent as
   * `currentlyPlannedCourseIds`); `buildConstraintModel` always sets it.
   */
  mustIncludeCourseIds?: Set<string>;
  /**
   * SOFT course preferences (`prefer_course_ids`) — best-effort only, scored at
   * the g5 slot and freely tradeable below legality/completion. Retained for
   * backward compatibility and internal use; under current product policy the
   * hard wanted/avoided pickers do NOT feed this set (see
   * `mustIncludeCourseIds` above and `disallowedCourseIds` below).
   */
  wantedCourseIds: Set<string>;
  /**
   * Slice 17A — requested semester-distribution policy. Undefined = 'neutral'
   * (legacy baseline). Only a confirmed active `semester_balance` preference
   * sets 'balanced' or 'compact'; it influences ONLY scorePlan's g4a/g4b slots.
   */
  distributionPolicy?: DistributionPolicy;
  /**
   * Optional per-course general user-fit score (0..1) for the requested focus
   * area(s)/style(s) — a SOFT optimization signal scored below explicit
   * wanted/unwanted preferences (scorePlan's interest_fit goal). Absent/empty
   * => no fit preference expressed, and scoring is byte-identical to before.
   */
  courseFitById?: Map<string, number>;
  /** Phase 0 — institution identity. Left undefined until a real multi-institution source exists. */
  institutionId?: string;
  /** Phase 0 — program identity, derived from the request's program_id where already parsed. */
  programId?: string;
  /** Phase 0 — catalog year, derived from the request's program_id where already parsed. */
  catalogYear?: number | string;
}

/** The mutable plan: semester_id → ordered course_ids placed there. */
export interface PlanState {
  semesters: Record<string, string[]>;
}

/** A candidate next action the worker may take. */
export type PlannerMutation =
  | {
      type: 'ADD_COURSE';
      courseId: string;
      semesterId: string;
      /**
       * Other semesters this same course must land in atomically, alongside
       * `semesterId` — used for `is_annual` (year-long) courses that span
       * multiple semesters together and must never be split into a
       * single-semester choice. Absent for every ordinary course.
       */
      alsoSemesterIds?: string[];
    }
  | { type: 'REMOVE_COURSE'; courseId: string }
  | { type: 'MOVE_COURSE'; courseId: string; toSemester: string }
  | { type: 'REPLACE_COURSE'; outId: string; inId: string; semesterId: string }
  | { type: 'STOP' };

// ── small pure state helpers (shared) ─────────────────────────────────────────

export function emptyState(knownSemesterIds: string[]): PlanState {
  const semesters: Record<string, string[]> = {};
  for (const id of knownSemesterIds) semesters[id] = [];
  return { semesters };
}

export function cloneState(state: PlanState): PlanState {
  const semesters: Record<string, string[]> = {};
  for (const [id, list] of Object.entries(state.semesters)) semesters[id] = [...list];
  return { semesters };
}

export function placedCourseIds(state: PlanState): string[] {
  return Object.values(state.semesters).flat();
}

export function semesterOf(state: PlanState, courseId: string): string | null {
  for (const [id, list] of Object.entries(state.semesters)) {
    if (list.includes(courseId)) return id;
  }
  return null;
}
