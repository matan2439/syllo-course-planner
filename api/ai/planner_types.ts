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
export interface ConstraintModel {
  /** CourseProfile for every course in the eligible universe. */
  profiles: Map<string, CourseProfile>;
  /** Canonical semester ids for this plan, in chronological order. */
  knownSemesterIds: string[];
  /** Courses the user already completed (never re-placed). */
  completedCourseIds: Set<string>;
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
  /** Hard-excluded course_ids (explicit user exclusion / disallowed). */
  disallowedCourseIds: Set<string>;
  /** Pinned course_ids that must stay in their current semester. */
  pinnedCourseIds: Set<string>;
  /** course_ids the user explicitly wants. */
  wantedCourseIds: Set<string>;
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
  | { type: 'ADD_COURSE'; courseId: string; semesterId: string }
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
