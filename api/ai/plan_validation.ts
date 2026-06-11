/**
 * Schema and validation for AI-generated personalized semester plans.
 *
 * The AI ("generate_plan" mode) produces a structured `PlanProposal`. Before
 * it is shown to the user (preview) or applied (local board state only),
 * `validatePlanProposal` checks it against the user's actual constraints:
 * completed courses, allowed semesters, prerequisites, category requirements,
 * and per-semester hour limits.
 */

import { z } from 'zod';

export const planMoveSchema = z.object({
  course_id: z.string(),
  from: z.string().nullable().optional(),
  to: z.string(),
});

export const planRequirementStatusSchema = z.object({
  name: z.string(),
  required: z.number(),
  placed: z.number(),
  satisfied: z.boolean(),
});

export const planProposalSchema = z.object({
  semesters: z.array(z.object({
    semester_id: z.string(),
    course_ids: z.array(z.string()),
  })),
  moves: z.array(planMoveSchema).optional().default([]),
  warnings_he: z.array(z.string()).optional().default([]),
  rationale_he: z.string(),
  requirements_status: z.array(planRequirementStatusSchema).optional().default([]),
});

export type PlanProposal = z.infer<typeof planProposalSchema>;

/** Per-course facts the validator needs, derived from the user's courseMap/plan_context. */
export interface PlanValidationCourseInfo {
  /** Hours to count toward a semester's total load (weekly_hours, falling back to semester_hours). */
  hours?: number | null;
  /** Allowed semester_ids for this course, if restricted (effective_allowed_semesters). */
  effective_allowed_semesters?: string[] | null;
  /** Prerequisite course_ids still missing for this course (from prerequisite_issues). */
  missing_prerequisites?: string[];
}

export interface PlanValidationContext {
  /** course_ids the user has marked as already completed (personal_status.completed). */
  completedCourseIds: Set<string>;
  /** Per-course info used for hours/effective-semester/prerequisite checks. */
  courses: Record<string, PlanValidationCourseInfo>;
  /** Maximum total weekly hours allowed per semester (from user preferences). */
  maxHoursPerSemester?: number;
  /** Elective/category requirements: name -> required count/hours, used to compute unmet requirements. */
  categoryRequirements?: Array<{ name: string; required: number }>;
}

export interface PlanValidationResult {
  errors: string[];
  warnings: string[];
}

/**
 * Validate a plan proposal against the user's real constraints.
 *
 * Errors mean the plan is invalid and must be rejected (not shown as a valid
 * preview, or the offending placements must be stripped before preview).
 * Warnings are surfaced to the user in the preview but do not block it.
 */
export function validatePlanProposal(
  proposal: PlanProposal,
  ctx: PlanValidationContext,
): PlanValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const seen = new Map<string, string>(); // course_id -> semester_id
  const placedCourseIds = new Set<string>();

  for (const sem of proposal.semesters) {
    let semHours = 0;

    for (const courseId of sem.course_ids) {
      // 1. duplicate placement across semesters
      if (seen.has(courseId)) {
        errors.push(
          `קורס ${courseId} משובץ פעמיים — גם ב-${seen.get(courseId)} וגם ב-${sem.semester_id}.`,
        );
      } else {
        seen.set(courseId, sem.semester_id);
      }
      placedCourseIds.add(courseId);

      // 2. completed course must not be (re-)scheduled
      if (ctx.completedCourseIds.has(courseId)) {
        errors.push(`קורס ${courseId} כבר הושלם על ידי המשתמש ולא ניתן לשבץ אותו מחדש (ב-${sem.semester_id}).`);
      }

      const info = ctx.courses[courseId];

      // 3. placement must be within effective_allowed_semesters
      if (info?.effective_allowed_semesters && info.effective_allowed_semesters.length > 0) {
        if (!info.effective_allowed_semesters.includes(sem.semester_id)) {
          errors.push(
            `קורס ${courseId} משובץ ב-${sem.semester_id} אך מותר רק ב-${info.effective_allowed_semesters.join(', ')}.`,
          );
        }
      }

      // 4. unmet prerequisites — warning only
      if (info?.missing_prerequisites && info.missing_prerequisites.length > 0) {
        const stillMissing = info.missing_prerequisites.filter(p => !placedCourseIds.has(p) && !ctx.completedCourseIds.has(p));
        if (stillMissing.length > 0) {
          warnings.push(`לקורס ${courseId} (ב-${sem.semester_id}) חסרות דרישות קדם: ${stillMissing.join(', ')}.`);
        }
      }

      semHours += info?.hours ?? 0;
    }

    // 5. semester hour limit — warning only
    if (ctx.maxHoursPerSemester != null && semHours > ctx.maxHoursPerSemester) {
      warnings.push(
        `בסמסטר ${sem.semester_id} יש ${semHours} שעות שבועיות — מעבר למגבלה שהוגדרה (${ctx.maxHoursPerSemester}).`,
      );
    }
  }

  // 6. category/elective requirements not met — warning only
  if (ctx.categoryRequirements) {
    for (const req of ctx.categoryRequirements) {
      const status = proposal.requirements_status.find(r => r.name === req.name);
      if (status && status.placed < status.required) {
        warnings.push(`דרישת "${req.name}" אינה מתמלאת במלואה: ${status.placed}/${status.required}.`);
      }
    }
  }

  // also surface any AI-reported unmet requirements directly
  for (const status of proposal.requirements_status) {
    if (!status.satisfied && status.placed < status.required) {
      const already = warnings.find(w => w.includes(`"${status.name}"`));
      if (!already) {
        warnings.push(`דרישת "${status.name}" אינה מתמלאת במלואה: ${status.placed}/${status.required}.`);
      }
    }
  }

  return { errors, warnings };
}
