/**
 * ADAPTERS — wire payload → canonical model. Lossless; half-hour conversion is
 * exact (throws on unsupported precision, never rounds). Runtime-neutral.
 */
import { boardResponseSchema, generatePlanResponseSchema } from './wire';
import { toHalfHours, catalogRevision, normalizeCourseId } from './model';
import type { BoardModel, BoardCourseModel, GeneratedPlanModel } from './model';

/** Raw course shape shared by placed courses and program_repository_courses. */
type RawCourse = {
  course_id: string;
  name_he?: string | null;
  weekly_hours?: number | null;
  course_type?: string;
  is_mandatory?: boolean;
};

/** Map one raw course (from either source) to the canonical model. Half-hour exact. */
function courseToModel(c: RawCourse): BoardCourseModel {
  return {
    courseId: normalizeCourseId(c.course_id),
    nameHe: c.name_he ?? '',
    halfHours: c.weekly_hours == null ? null : toHalfHours(c.weekly_hours),
    courseType: c.course_type ?? '',
    isMandatory: c.is_mandatory ?? false,
  };
}

/** Parse + map a raw /api/board response into the canonical BoardModel + catalog. */
export function boardResponseToModel(raw: unknown): BoardModel {
  const parsed = boardResponseSchema.parse(raw);

  const semesters = parsed.semesters.map((s) => ({
    semesterId: s.semester_id,
    courses: s.courses.map(courseToModel),
  }));

  // courseCatalog = placed ∪ program_repository_courses, keyed by normalized id.
  // Order-independent merge: within a source, the last occurrence wins; across
  // sources the REPOSITORY entry is authoritative for shared fields, while the
  // placement-only `courseType` (repo entries carry none) is retained.
  const placedIndex: Record<string, BoardCourseModel> = {};
  for (const s of parsed.semesters) {
    for (const c of s.courses) placedIndex[normalizeCourseId(c.course_id)] = courseToModel(c);
  }
  const repoIndex: Record<string, BoardCourseModel> = {};
  for (const c of parsed.metadata.program_repository_courses ?? []) {
    repoIndex[normalizeCourseId(c.course_id)] = courseToModel(c);
  }
  const courseCatalog: Record<string, BoardCourseModel> = {};
  for (const id of new Set([...Object.keys(placedIndex), ...Object.keys(repoIndex)])) {
    const placed = placedIndex[id];
    const repo = repoIndex[id];
    courseCatalog[id] =
      repo && placed ? { ...repo, courseType: repo.courseType || placed.courseType } : repo ?? placed;
  }

  return {
    catalogRevision: catalogRevision(parsed.metadata.board_data_version),
    semesters,
    courseCatalog,
  };
}

/** Parse + map a raw /api/ai/generate-plan response into the canonical model. */
export function generatePlanResponseToModel(raw: unknown): GeneratedPlanModel {
  const p = generatePlanResponseSchema.parse(raw);
  return {
    semesters: p.semesters.map((s) => ({ semesterId: s.semester_id, courseIds: s.course_ids })),
    moves: p.moves.map((m) => ({ courseId: m.course_id, from: m.from, to: m.to })),
    warningsHe: p.warnings_he,
    errors: p.errors,
    blocked: p.blocked,
    ...(p.intentOutcome ? { intentOutcome: p.intentOutcome } : {}),
    // Opt-in AcademicDecisionAgent path only (default-off). Absent on the legacy
    // response → both stay undefined and Apply gating is unchanged.
    ...(p.academicDecision?.outcome ? { agentOutcome: p.academicDecision.outcome } : {}),
    ...(typeof p.academicDecision?.applyEligible === 'boolean'
      ? { applyEligible: p.academicDecision.applyEligible }
      : {}),
  };
}
