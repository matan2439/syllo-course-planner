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
import { HARD_LOAD_CAP, DEFAULT_MAX_HOURS_PER_SEMESTER } from './load_constants';
import { type ConstraintModel, type CategoryReq, type PlanState, emptyState } from './planner_types';

export interface BuildModelOptions {
  /** course_ids the user has completed (merged with board metadata.completed_course_ids). */
  completedCourseIds?: string[];
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
    requiredMandatoryCourseIds,
    categories,
    degreeRequiredHours,
    priorHours,
    maxHoursPerSemester: opts.maxHoursPerSemester ?? DEFAULT_MAX_HOURS_PER_SEMESTER,
    hardCap: HARD_LOAD_CAP,
    disallowedCourseIds,
    pinnedCourseIds,
    wantedCourseIds,
  };
}

/** The initial remaining degree-hour gap represented by the model. */
export function degreeGap(model: ConstraintModel): number {
  return Math.max(0, model.degreeRequiredHours - model.priorHours);
}

// ── plan_context adapter ──────────────────────────────────────────────────────
//
// The live /api/ai/generate-plan endpoint receives a client-built `plan_context`
// rather than a raw board_json. When the full board is available server-side we
// prefer it (full universe); otherwise we synthesise a board_json-shaped object
// from the plan_context so the SAME buildConstraintModel path produces the model.

interface PlanContextLike {
  semesters?: Array<{ id: string; courses?: any[] }>;
  category_requirements?: Array<{ name: string; category_id?: string | null; required?: number; candidates?: any[] }>;
  general_course_requirements?: { candidates?: any[] };
  movable_courses?: any[];
  mandatory_unplaced?: any[];
  personal_status?: { completed?: Array<{ course_id: string }> };
  total_hours_progress?: {
    known_completed_hours?: number;
    currently_planned_hours?: number;
    degree_required_hours?: number;
    manual_completed_degree_hours?: number;
  };
  pinned_course_ids?: string[];
}

interface PlanPrefsLike {
  wanted_course_ids?: string[];
  unwanted_course_ids?: string[];
  disallowed_course_ids?: string[];
  strongly_avoided_course_ids?: string[];
  max_weekly_hours?: number | null;
}

function rawCourse(c: any, opts: { mandatory?: boolean; categoryId?: string | null } = {}): any {
  return {
    course_id: c.course_id,
    name_he: c.name_he ?? null,
    weekly_hours: c.hours ?? c.weekly_hours ?? null,
    is_mandatory: opts.mandatory ?? c.course_type === 'mandatory',
    course_type: c.course_type ?? (opts.mandatory ? 'mandatory' : 'elective'),
    placement_policy: c.placement_policy ?? null,
    recommended_semester: c.recommended_semester ?? null,
    effective_allowed_semesters: c.effective_allowed_semesters ?? null,
    offered_semesters: c.offered_semesters ?? null,
    prerequisites: c.prerequisites ?? c.missing_prerequisites ?? [],
    program_category_id: opts.categoryId ?? c.program_category_id ?? c.category ?? null,
    syllabus_summary_he: c.syllabus_summary_he ?? null,
    syllabus_topics_he: c.syllabus_topics_he ?? null,
    grade_average: c.grade_average ?? null,
  };
}

/** Synthesise a board_json-shaped object from a plan_context. */
export function planContextToBoard(ctx: PlanContextLike): any {
  const repo: any[] = [];
  for (const cat of ctx.category_requirements ?? []) {
    for (const cand of cat.candidates ?? []) repo.push(rawCourse(cand, { categoryId: cat.category_id ?? cat.name }));
  }
  for (const cand of ctx.general_course_requirements?.candidates ?? []) repo.push(rawCourse(cand));
  for (const m of ctx.movable_courses ?? []) repo.push(rawCourse(m));
  for (const m of ctx.mandatory_unplaced ?? []) repo.push(rawCourse(m, { mandatory: true }));

  return {
    semesters: (ctx.semesters ?? []).map(s => ({
      semester_id: s.id,
      courses: (s.courses ?? []).map(c => rawCourse(c)),
    })),
    metadata: {
      completed_course_ids: (ctx.personal_status?.completed ?? []).map(c => c.course_id),
      program_requirements_categories: {
        total_required_hours: ctx.total_hours_progress?.degree_required_hours ?? DEGREE_REQUIRED_HOURS,
        categories: (ctx.category_requirements ?? []).map(cat => ({
          category_id: cat.category_id ?? cat.name,
          name_he: cat.name,
          min_courses: cat.required ?? 1,
          course_ids: (cat.candidates ?? []).map((x: any) => x.course_id),
        })),
      },
      program_repository_courses: repo,
    },
  };
}

/** Build a ConstraintModel from a plan_context (degraded universe; dev / fallback). */
export function buildModelFromPlanContext(ctx: PlanContextLike, prefs: PlanPrefsLike = {}): ConstraintModel {
  const thp = ctx.total_hours_progress ?? {};
  // currently_planned_hours excluded: board-placed courses are seeded into
  // initialState by planContextToState — adding them here too would double-count.
  const priorHours = thp.manual_completed_degree_hours ?? (thp.known_completed_hours ?? 0);
  return buildConstraintModel(planContextToBoard(ctx), {
    completedCourseIds: (ctx.personal_status?.completed ?? []).map(c => c.course_id),
    wantedCourseIds: prefs.wanted_course_ids,
    unwantedCourseIds: prefs.unwanted_course_ids,
    disallowedCourseIds: prefs.disallowed_course_ids ?? prefs.strongly_avoided_course_ids,
    pinnedCourseIds: ctx.pinned_course_ids,
    maxHoursPerSemester: prefs.max_weekly_hours ?? undefined,
    priorHours,
  });
}

/**
 * Seed a PlanState from the plan_context's current board placements (so the
 * worker plans incrementally from the live board rather than from scratch).
 * Completed courses and courses absent from the model are dropped.
 */
export function planContextToState(
  ctx: PlanContextLike,
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
