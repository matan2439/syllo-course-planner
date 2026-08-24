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
import { type ConstraintModel, type CategoryReq, type PlanState, type DistributionPolicy, emptyState } from './planner_types';
import { computeAcademicProgress, type AcademicProgress } from './academic_progress';

export interface BuildModelOptions {
  /** course_ids the user has completed (merged with board metadata.completed_course_ids). */
  completedCourseIds?: string[];
  /** course_ids the user is currently taking/in-progress (must not be re-proposed by the planner). */
  currentlyPlannedCourseIds?: string[];
  /**
   * Slice 18A — HARD inclusion (`must_include_course_ids`), what the user-facing
   * "wanted" picker feeds under current product policy. Kept STRICTLY separate
   * from `wantedCourseIds` (the soft `prefer_course_ids` channel) so a hard
   * selection can never be scored/traded as a mere preference.
   */
  mustIncludeCourseIds?: string[];
  /** SOFT `prefer_course_ids` — best-effort only. The hard pickers do not feed this. */
  wantedCourseIds?: string[];
  unwantedCourseIds?: string[];
  /** Per-course general user-fit score (0..1) for a requested focus area/style — soft planner signal. */
  courseFitById?: Map<string, number>;
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
  /** Slice 17A — requested semester-distribution policy. Undefined = 'neutral' (legacy baseline). */
  distributionPolicy?: DistributionPolicy;
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export function buildConstraintModel(boardJson: any, opts: BuildModelOptions = {}): ConstraintModel {
  const reportedCompletedCourseIds = new Set<string>([
    ...(opts.completedCourseIds ?? []),
    ...((boardJson?.metadata?.completed_course_ids ?? []) as string[]),
  ]);
  const disallowedCourseIds = new Set<string>(opts.disallowedCourseIds ?? []);
  const wantedCourseIds = new Set<string>(opts.wantedCourseIds ?? []);
  const mustIncludeCourseIds = new Set<string>(opts.mustIncludeCourseIds ?? []);
  const pinnedCourseIds = new Set<string>(opts.pinnedCourseIds ?? []);
  const reportedCurrentlyPlannedCourseIds = new Set<string>(opts.currentlyPlannedCourseIds ?? []);

  const profiles = buildCourseProfiles(boardJson, {
    completedCourseIds: reportedCompletedCourseIds,
    // `is_wanted` is a descriptive/UI + REPLACE-ranking label, so it covers both
    // channels; the hard/soft distinction that actually drives planning lives in
    // mustIncludeCourseIds vs wantedCourseIds below, never in this flag.
    wantedCourseIds: [...new Set([...(opts.wantedCourseIds ?? []), ...(opts.mustIncludeCourseIds ?? [])])],
    unwantedCourseIds: opts.unwantedCourseIds,
    disallowedCourseIds: opts.disallowedCourseIds,
  });
  // As with completed ids, a currently-taking identity has course-specific
  // consequences only when it resolves in the authoritative catalog. Explicit
  // off-board hours may still contribute through deriveInProgressCredit, but
  // the unknown id cannot satisfy prerequisites or mandatory requirements.
  const currentlyPlannedCourseIds = new Set(
    [...reportedCurrentlyPlannedCourseIds].filter((id) => profiles.has(id)),
  );

  // Semester availability — the board's own canonical semester ids, in order.
  const knownSemesterIds = uniq(
    ((boardJson?.semesters ?? []) as any[]).map(s => s.semester_id).filter((x: unknown): x is string => typeof x === 'string'),
  );

  // Program requirements — degree hours + category requirements, from metadata.
  const catMeta = boardJson?.metadata?.program_requirements_categories;
  const degreeRequiredHours = Number(catMeta?.total_required_hours) || DEGREE_REQUIRED_HOURS;

  /**
   * ONE authoritative recognition of what the student already completed,
   * computed here so every downstream stage — the scorer, the authoritative
   * validator, the explanation — reads the SAME remaining state instead of
   * reconstructing its own.
   *
   * Category membership comes only from the program's declared `course_ids`
   * pools, and credits only from the catalog record. A title, a syllabus topic
   * or an aggregate hours figure can never produce a contribution.
   */
  const academicProgress: AcademicProgress = computeAcademicProgress({
    completedCourseIds: [...reportedCompletedCourseIds],
    catalogHours: new Map([...profiles].map(([id, p]) => [id, p.hours ?? null])),
    requirements: ((catMeta?.categories ?? []) as any[]).map(c => ({
      categoryId: c.category_id,
      name: c.name_he ?? c.category_id,
      minCourses: Number(c.min_courses) || 0,
      courseIds: (c.course_ids ?? []) as string[],
    })),
    prerequisiteFacts: [...profiles.values()].map(profile => ({
      courseId: profile.course_id,
      name: profile.name_he ?? profile.course_id,
      prerequisiteCourseIds: profile.prerequisites,
    })),
  });
  // Only server-recognized catalog identities may carry course-specific hard
  // consequences (prerequisites, mandatory completion, or exclusion from a
  // future proposal). Unknown reported ids remain in AcademicProgress for
  // disclosure/audit, but cannot manufacture eligibility merely by matching a
  // prerequisite string.
  const completedCourseIds = new Set(academicProgress.recognizedCourseIds);

  // Only categories with a positive minimum are hard requirements. (A min_courses
  // of 0, e.g. an "other/by-approval" bucket, is not something the plan must satisfy.)
  //
  // `required` is the REMAINING requirement, not the program's original
  // minimum: a category the student has already satisfied by completing a
  // course from its pool must not be bought a second time. Mandatory courses
  // and degree hours were already reduced by completion (see
  // `requiredMandatoryCourseIds` and `priorHours` below); categories were the
  // one place that was not, which is the defect this fixes. The original
  // minimum survives on `academicProgress.categories[].required` for anything
  // that needs to explain the difference.
  const remainingByCategory = new Map(
    academicProgress.categories.map(c => [c.categoryId, c.remainingRequired]),
  );
  const categories: CategoryReq[] = ((catMeta?.categories ?? []) as any[])
    .filter(c => Number(c.min_courses) > 0)
    .map(c => ({
      id: c.category_id,
      name: c.name_he ?? c.category_id,
      required: remainingByCategory.get(c.category_id) ?? Number(c.min_courses),
      candidateIds: (c.course_ids ?? []) as string[],
    }));

  // Mandatory courses still required: is_mandatory and not yet accounted for.
  // A currently-taking course is prior progress: rule 2a forbids re-proposing
  // it, so keeping it "required" would be an impossible requirement.
  const requiredMandatoryCourseIds: string[] = [];
  for (const [id, p] of profiles) {
    if (p.is_mandatory && !completedCourseIds.has(id) && !currentlyPlannedCourseIds.has(id)) {
      requiredMandatoryCourseIds.push(id);
    }
  }

  // Prior accrued hours — the remaining-degree-gap baseline. Taken from the
  // same recognition, so hours and categories can never disagree about which
  // completed courses were authoritative.
  // A coarse aggregate may prove additional completed degree hours, but it
  // must never erase hours derived from identified authoritative courses.
  // Taking the maximum avoids double-counting (the aggregate normally already
  // includes identified courses) while preserving course identity as the
  // source of category/prerequisite/exclusion consequences.
  const priorHours = Math.max(opts.priorHours ?? 0, academicProgress.recognizedHours);

  return {
    profiles,
    knownSemesterIds,
    completedCourseIds,
    currentlyPlannedCourseIds,
    requiredMandatoryCourseIds,
    categories,
    academicProgress,
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
    mustIncludeCourseIds,
    ...(opts.distributionPolicy ? { distributionPolicy: opts.distributionPolicy } : {}),
    courseFitById: opts.courseFitById,
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
