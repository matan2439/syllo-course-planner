/**
 * buildConstraintModel — assembles the ConstraintModel: the single source of
 * truth for a planning run. It represents the COMPLETE planning world derived
 * once from a program's board_json plus the user's context, so the Planner
 * Worker reasons only over this model and never queries raw board_json or
 * scattered structures during planning. The result is deterministic,
 * inspectable, and reproducible.
 *
 * Everything is read from the board's own metadata, so this is the canonical,
 * program-AGNOSTIC planning model — no Mechanical-Engineering (or any other
 * program) specific constants. A different university/degree with a board_json
 * in the same shape builds its own world the same way.
 *
 * The planning world includes:
 *   - CourseProfiles for the full eligible universe (which carry the
 *     prerequisite graph as per-course prerequisites),
 *   - program degree-hour requirement, category requirements,
 *   - mandatory courses (not yet completed), completed courses,
 *   - disallowed courses + user preferences (wanted/pinned),
 *   - semester availability (the board's own semester ids), and
 *   - prior accrued degree hours (the remaining-gap baseline).
 */

import { buildCourseProfiles } from './course_profile';
import { DEGREE_REQUIRED_HOURS } from './completion_analysis';
import { HARD_LOAD_CAP, DEFAULT_MAX_HOURS_PER_SEMESTER, SOFT_LOAD_MAX, ABSOLUTE_MAX_REASONABLE } from './load_constants';
import { type ConstraintModel, type CategoryReq, type PlanState, emptyState } from './planner_types';

export interface BuildModelOptions {
  /** course_ids the user has completed (merged with board metadata.completed_course_ids). */
  completedCourseIds?: string[];
  /** course_ids the user is currently taking/in-progress (must not be re-proposed by the planner). */
  currentlyPlannedCourseIds?: string[];
  wantedCourseIds?: string[];
  unwantedCourseIds?: string[];
  /** Hard-excluded course_ids (explicit user exclusion / disallowed). */
  disallowedCourseIds?: string[];
  pinnedCourseIds?: string[];
  /** User per-semester weekly-hour cap. */
  maxHoursPerSemester?: number;
  /**
   * Prior accrued degree hours (e.g. earlier years already completed). Defaults
   * to the summed hours of the completed courses present in the universe.
   */
  priorHours?: number;
  /** Phase 2C — user explicitly confirmed overload above HARD_LOAD_CAP. */
  overloadAccepted?: boolean;
  /** Phase 2C — timestamp of that confirmation. */
  overloadConfirmedAt?: number | null;
  /** Phase 0 — institution identity. Leave unset unless a real source exists. */
  institutionId?: string;
  /** Phase 0 — program identity, derived from the request's program_id where already parsed. */
  programId?: string;
  /** Phase 0 — catalog year, derived from the request's program_id where already parsed. */
  catalogYear?: number | string;
  /** Phase 1b — per-semester blocking cap override. Defaults to HARD_LOAD_CAP. */
  hardCap?: number;
  /** Phase 1b — preferred-range ceiling override. Defaults to SOFT_LOAD_MAX. */
  softLoadMax?: number;
  /** Phase 1b — never-overridable blocking ceiling override. Defaults to ABSOLUTE_MAX_REASONABLE. */
  absoluteMaxReasonable?: number;
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export function buildConstraintModel(boardJson: any, opts: BuildModelOptions = {}): ConstraintModel {
  const completedCourseIds = new Set<string>([
    ...(opts.completedCourseIds ?? []),
    ...((boardJson?.metadata?.completed_course_ids ?? []) as string[]),
  ]);
  const disallowedCourseIds = new Set<string>(opts.disallowedCourseIds ?? []);
  const wantedCourseIds = new Set<string>(opts.wantedCourseIds ?? []);
  const pinnedCourseIds = new Set<string>(opts.pinnedCourseIds ?? []);
  const currentlyPlannedCourseIds = new Set<string>(opts.currentlyPlannedCourseIds ?? []);

  const profiles = buildCourseProfiles(boardJson, {
    completedCourseIds,
    wantedCourseIds: opts.wantedCourseIds,
    unwantedCourseIds: opts.unwantedCourseIds,
    disallowedCourseIds: opts.disallowedCourseIds,
  });

  // Semester availability — the board's own canonical semester ids, in order.
  const knownSemesterIds = uniq(
    ((boardJson?.semesters ?? []) as any[]).map(s => s.semester_id).filter((x: unknown): x is string => typeof x === 'string'),
  );

  // Program requirements — degree hours + category requirements, from metadata.
  const catMeta = boardJson?.metadata?.program_requirements_categories;
  const degreeRequiredHours = Number(catMeta?.total_required_hours) || DEGREE_REQUIRED_HOURS;

  // Only categories with a positive minimum are hard requirements. (A min_courses
  // of 0, e.g. an "other/by-approval" bucket, is not something the plan must satisfy.)
  const categories: CategoryReq[] = ((catMeta?.categories ?? []) as any[])
    .filter(c => Number(c.min_courses) > 0)
    .map(c => ({
      id: c.category_id,
      name: c.name_he ?? c.category_id,
      required: Number(c.min_courses),
      candidateIds: (c.course_ids ?? []) as string[],
    }));

  // Mandatory courses still required: is_mandatory and not yet completed.
  const requiredMandatoryCourseIds: string[] = [];
  for (const [id, p] of profiles) {
    if (p.is_mandatory && !completedCourseIds.has(id)) requiredMandatoryCourseIds.push(id);
  }

  // Prior accrued hours — the remaining-degree-gap baseline.
  const priorHours = opts.priorHours ?? [...completedCourseIds].reduce(
    (sum, id) => sum + (profiles.get(id)?.hours ?? 0), 0,
  );

  return {
    profiles,
    knownSemesterIds,
    completedCourseIds,
    currentlyPlannedCourseIds,
    requiredMandatoryCourseIds,
    categories,
    degreeRequiredHours,
    priorHours,
    maxHoursPerSemester: opts.maxHoursPerSemester ?? DEFAULT_MAX_HOURS_PER_SEMESTER,
    hardCap: opts.hardCap ?? HARD_LOAD_CAP,
    softLoadMax: opts.softLoadMax ?? SOFT_LOAD_MAX,
    absoluteMaxReasonable: opts.absoluteMaxReasonable ?? ABSOLUTE_MAX_REASONABLE,
    overloadAccepted: opts.overloadAccepted,
    overloadConfirmedAt: opts.overloadConfirmedAt,
    disallowedCourseIds,
    pinnedCourseIds,
    wantedCourseIds,
    institutionId: opts.institutionId,
    programId: opts.programId,
    catalogYear: opts.catalogYear,
  };
}

/** The initial remaining degree-hour gap represented by the model. */
export function degreeGap(model: ConstraintModel): number {
  return Math.max(0, model.degreeRequiredHours - model.priorHours);
}

/**
 * Seed a PlanState from the plan_context's current board placements (so the
 * worker plans incrementally from the live board rather than from scratch).
 * Completed courses and courses absent from the model are dropped.
 */
export function planContextToState(
  ctx: { semesters?: Array<{ id: string; courses?: any[] }> },
  model: ConstraintModel,
): PlanState {
  const state = emptyState(model.knownSemesterIds);
  for (const sem of ctx.semesters ?? []) {
    if (!state.semesters[sem.id]) continue;
    for (const c of sem.courses ?? []) {
      const id = c.course_id;
      if (model.completedCourseIds.has(id)) continue;
      if (!model.profiles.has(id)) continue;
      if (!state.semesters[sem.id].includes(id)) state.semesters[sem.id].push(id);
    }
  }
  return state;
}
