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

/** Canonical semester ids used throughout the board (year_<3|4>_semester_<a|b>). */
export const KNOWN_SEMESTER_IDS = [
  'year_3_semester_a',
  'year_3_semester_b',
  'year_4_semester_a',
  'year_4_semester_b',
] as const;

const HEBREW_YEAR_LETTER: Record<string, string> = { 'ג': '3', 'ד': '4' };
const HEBREW_SEM_LETTER:  Record<string, string> = { 'א': 'a', 'ב': 'b' };

/**
 * Normalize an AI-provided semester identifier to one of `KNOWN_SEMESTER_IDS`.
 *
 * AI models often paraphrase semester ids (Hebrew labels, different
 * separators/casing, "Y3A", "year3-semesterA", etc.) instead of returning
 * the exact `year_3_semester_a` form. This maps any recognizable variant to
 * the canonical id, or returns `null` if the year/semester cannot be
 * determined at all (caller should treat such placements as unplaced and
 * surface a warning).
 */
export function normalizeSemesterId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if ((KNOWN_SEMESTER_IDS as readonly string[]).includes(trimmed)) return trimmed;

  // Hebrew labels: "שנה ג׳ — סמסטר א׳" etc. — find a year-letter (ג/ד) and a
  // semester-letter (א/ב) anywhere in the string.
  let year: string | null = null;
  let half: string | null = null;
  for (const ch of trimmed) {
    if (HEBREW_YEAR_LETTER[ch]) year = HEBREW_YEAR_LETTER[ch];
    if (HEBREW_SEM_LETTER[ch])  half = HEBREW_SEM_LETTER[ch];
  }

  // Latin/numeric variants: look for a 3/4 and an a/b (case-insensitive),
  // ignoring separators/punctuation.
  if (!year || !half) {
    const lower = trimmed.toLowerCase();
    const yearMatch = lower.match(/[34]/);
    const halfMatch = lower.match(/[ab](?![a-z])|semester[_\- ]?([ab])\b/);
    if (yearMatch) year = year ?? yearMatch[0];
    if (halfMatch) half = half ?? (halfMatch[1] || halfMatch[0]);
  }

  if (!year || !half) return null;
  const candidate = `year_${year}_semester_${half}`;
  return (KNOWN_SEMESTER_IDS as readonly string[]).includes(candidate) ? candidate : null;
}

/**
 * Normalize all semester_id values in a plan proposal (and matching
 * `moves[].from`/`moves[].to` values) to canonical ids. Course placements
 * whose semester_id cannot be normalized are dropped from the proposal and
 * reported via the returned `dropped` list, so the caller can surface a
 * Hebrew warning and treat those courses as unplaced.
 */
export function normalizePlanProposal(proposal: PlanProposal): {
  proposal: PlanProposal;
  dropped: Array<{ course_id: string; raw_semester_id: string }>;
} {
  const dropped: Array<{ course_id: string; raw_semester_id: string }> = [];
  const bySemester = new Map<string, string[]>();

  for (const sem of proposal.semesters) {
    const normalized = normalizeSemesterId(sem.semester_id);
    if (!normalized) {
      for (const cid of sem.course_ids) dropped.push({ course_id: cid, raw_semester_id: sem.semester_id });
      continue;
    }
    const existing = bySemester.get(normalized) ?? [];
    for (const cid of sem.course_ids) {
      if (!existing.includes(cid)) existing.push(cid);
    }
    bySemester.set(normalized, existing);
  }

  const normalizeSide = (v: string | null | undefined): string | null | undefined => {
    if (v == null) return v;
    return normalizeSemesterId(v) ?? v; // leave moves' from/to as-is if unrecognizable (display-only)
  };

  return {
    proposal: {
      ...proposal,
      semesters: KNOWN_SEMESTER_IDS
        .filter(id => bySemester.has(id))
        .map(id => ({ semester_id: id, course_ids: bySemester.get(id)! })),
      moves: proposal.moves.map(m => ({ ...m, from: normalizeSide(m.from), to: normalizeSide(m.to) ?? m.to })),
    },
    dropped,
  };
}

/** Per-course facts the validator needs, derived from the user's courseMap/plan_context. */
export interface PlanValidationCourseInfo {
  /** Hours to count toward a semester's total load (weekly_hours, falling back to semester_hours). */
  hours?: number | null;
  /** Allowed semester_ids for this course, if restricted (effective_allowed_semesters). */
  effective_allowed_semesters?: string[] | null;
  /** Prerequisite course_ids still missing for this course (from prerequisite_issues). */
  missing_prerequisites?: string[];
  /** True if this is a mandatory (חובה) course. */
  is_mandatory?: boolean;
}

export interface PlanValidationContext {
  /** course_ids the user has marked as already completed (personal_status.completed). */
  completedCourseIds: Set<string>;
  /** Per-course info used for hours/effective-semester/prerequisite checks. */
  courses: Record<string, PlanValidationCourseInfo>;
  /** Maximum total weekly hours allowed per semester (from user preferences). */
  maxHoursPerSemester?: number;
  /** True if the user explicitly asked for a balanced load ("איזון עומס") — makes any overload blocking. */
  balanceLoad?: boolean;
  /** Elective/category requirements: name -> required count/hours, used to compute unmet requirements. */
  categoryRequirements?: Array<{ name: string; required: number; availableElectiveIds?: string[] }>;
  /** course_ids of not-completed mandatory courses that must appear somewhere in the plan. */
  requiredMandatoryCourseIds?: string[];
  /** course_ids the user explicitly asked for — used to detect "wanted-only" partial plans. */
  wantedCourseIds?: string[];
  /** course_ids that could be moved between semesters (flexible mandatory or electives). */
  movableCourseIds?: Set<string>;
  /** course_id -> name_he, used to produce readable Hebrew error/warning messages. */
  courseNames?: Record<string, string>;
  /** semester_id -> Hebrew label (e.g. SEM_HE), used to produce readable messages. */
  semesterLabels?: Record<string, string>;
  /** course_ids the user pinned ("אל תזיז") — must stay in their current semester. */
  pinnedCourseIds?: Set<string>;
  /** course_id -> current semester_id on the live board (for pinned-course checks). */
  currentSemesterByCourseId?: Record<string, string | null>;
}

/** Render a course as "שם הקורס (course_id)" if a Hebrew name is known, else just the id. */
function courseLabel(courseId: string, names?: Record<string, string>): string {
  const name = names?.[courseId];
  return name ? `${name} (${courseId})` : courseId;
}

/** Render a semester id using its Hebrew label if known, else the raw id. */
function semesterLabel(semesterId: string, labels?: Record<string, string>): string {
  return labels?.[semesterId] ?? semesterId;
}

/**
 * Turn the `dropped` list from `normalizePlanProposal` into readable Hebrew
 * warnings — used when the AI returned a semester_id that couldn't be mapped
 * to a real semester, so the affected courses were left unplaced.
 */
export function droppedPlacementWarnings(
  dropped: Array<{ course_id: string; raw_semester_id: string }>,
  courseNames?: Record<string, string>,
): string[] {
  return dropped.map(d =>
    `הקורס ${courseLabel(d.course_id, courseNames)} קיבל מה-AI שיוך לסמסטר לא מזוהה ("${d.raw_semester_id}") ונותר במאגר הקורסים.`,
  );
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
    const semName = semesterLabel(sem.semester_id, ctx.semesterLabels);

    for (const courseId of sem.course_ids) {
      const cName = courseLabel(courseId, ctx.courseNames);

      // 1. duplicate placement across semesters
      if (seen.has(courseId)) {
        const firstSemName = semesterLabel(seen.get(courseId)!, ctx.semesterLabels);
        errors.push(
          `קורס ${cName} משובץ פעמיים — גם ב${firstSemName} וגם ב${semName}.`,
        );
      } else {
        seen.set(courseId, sem.semester_id);
      }
      placedCourseIds.add(courseId);

      // 2. completed course must not be (re-)scheduled
      if (ctx.completedCourseIds.has(courseId)) {
        errors.push(`קורס ${cName} כבר הושלם על ידי המשתמש ולא ניתן לשבץ אותו מחדש (ב${semName}).`);
      }

      // 2b. pinned course must remain in its current semester
      if (ctx.pinnedCourseIds?.has(courseId)) {
        const currentSem = ctx.currentSemesterByCourseId?.[courseId];
        if (currentSem && currentSem !== sem.semester_id) {
          errors.push(`הקורס ${cName} מסומן כ'אל תזיז' ולכן לא ניתן להזיז אותו.`);
        }
      }

      const info = ctx.courses[courseId];

      // 3. placement must be within effective_allowed_semesters
      if (info?.effective_allowed_semesters && info.effective_allowed_semesters.length > 0) {
        if (!info.effective_allowed_semesters.includes(sem.semester_id)) {
          const allowedNames = info.effective_allowed_semesters.map(s => semesterLabel(s, ctx.semesterLabels)).join(', ');
          errors.push(
            `קורס ${cName} משובץ ב${semName} אך מותר רק ב${allowedNames}.`,
          );
        }
      }

      // 4. unmet prerequisites — warning only
      if (info?.missing_prerequisites && info.missing_prerequisites.length > 0) {
        const stillMissing = info.missing_prerequisites.filter(p => !placedCourseIds.has(p) && !ctx.completedCourseIds.has(p));
        if (stillMissing.length > 0) {
          const missingNames = stillMissing.map(p => courseLabel(p, ctx.courseNames)).join(', ');
          warnings.push(`לקורס ${cName} (ב${semName}) חסרות דרישות קדם: ${missingNames}.`);
        }
      }

      semHours += info?.hours ?? 0;
    }

    // 5. semester hour limit — severe overload (or any overload when the user
    // asked for a balanced load) blocks the plan; mild overload is a warning.
    if (ctx.maxHoursPerSemester != null && semHours > ctx.maxHoursPerSemester) {
      const overBy = semHours - ctx.maxHoursPerSemester;
      if (overBy > 3 || ctx.balanceLoad) {
        const movableInSem = ctx.movableCourseIds
          ? sem.course_ids.filter(cid => ctx.movableCourseIds!.has(cid))
          : [];
        if (movableInSem.length > 0) {
          errors.push(
            'התוכנית לא איזנה עומס למרות שקיימים קורסים גמישים/בחירה שניתן להזיז.',
          );
        } else {
          errors.push(
            `לא ניתן להחיל — עומס חורג משמעותית מהמגבלה שבחרת: ב${semName} יש ${semHours} שעות שבועיות לעומת מגבלה של ${ctx.maxHoursPerSemester}.`,
          );
        }
      } else {
        warnings.push(
          `ב${semName} יש ${semHours} שעות שבועיות — מעבר למגבלה שהוגדרה (${ctx.maxHoursPerSemester}).`,
        );
      }
    }
  }

  // 6. partial-plan check — every not-completed mandatory course must appear.
  if (ctx.requiredMandatoryCourseIds) {
    const missingMandatory = ctx.requiredMandatoryCourseIds.filter(cid => !placedCourseIds.has(cid));
    if (missingMandatory.length > 0) {
      errors.push('התוכנית לא כוללת את כל קורסי החובה שלא הושלמו.');
    }
  }

  // 7. category/elective requirements not met — warning, or blocking if the
  // plan only adds the courses the user explicitly requested (no electives
  // beyond "wanted") despite unmet requirements.
  let addedNonWantedElectives = false;
  if (ctx.wantedCourseIds) {
    const wanted = new Set(ctx.wantedCourseIds);
    for (const cid of placedCourseIds) {
      const info = ctx.courses[cid];
      if (!wanted.has(cid) && !ctx.completedCourseIds.has(cid) && !info?.is_mandatory) {
        addedNonWantedElectives = true;
        break;
      }
    }
  }

  if (ctx.categoryRequirements) {
    for (const req of ctx.categoryRequirements) {
      const status = proposal.requirements_status.find(r => r.name === req.name);
      if (status && status.placed < status.required) {
        if (ctx.wantedCourseIds && !addedNonWantedElectives) {
          errors.push('התוכנית חלקית — לא נוספו מספיק קורסי בחירה להשלמת דרישות התואר.');
        } else if (req.availableElectiveIds && req.availableElectiveIds.length > 0) {
          warnings.push(`חסרים קורסי בחירה בקטגוריה ${req.name}.`);
        } else {
          warnings.push(`דרישת "${req.name}" אינה מתמלאת במלואה: ${status.placed}/${status.required}.`);
        }
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
