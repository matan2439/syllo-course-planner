/**
 * ADAPTERS — wire payload → canonical model. Lossless; half-hour conversion is
 * exact (throws on unsupported precision, never rounds). Runtime-neutral.
 */
import { boardResponseSchema, generatePlanResponseSchema } from './wire';
import { toHalfHours, catalogRevision } from './model';
import type { BoardModel, GeneratedPlanModel } from './model';

/** Parse + map a raw /api/board response into the canonical BoardModel. */
export function boardResponseToModel(raw: unknown): BoardModel {
  const parsed = boardResponseSchema.parse(raw);
  return {
    catalogRevision: catalogRevision(parsed.metadata.board_data_version),
    semesters: parsed.semesters.map((s) => ({
      semesterId: s.semester_id,
      courses: s.courses.map((c) => ({
        courseId: c.course_id,
        nameHe: c.name_he ?? '',
        halfHours: c.weekly_hours == null ? null : toHalfHours(c.weekly_hours),
        courseType: c.course_type ?? '',
        isMandatory: c.is_mandatory ?? false,
      })),
    })),
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
  };
}
