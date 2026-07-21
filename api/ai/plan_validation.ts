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
import { getSemesterLoad } from './completion_analysis';
import { HARD_LOAD_CAP, ABSOLUTE_MAX_REASONABLE, SOFT_LOAD_MAX } from './load_constants';

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
export function normalizePlanProposal(
  proposal: PlanProposal,
  opts?: { knownSemesterIds?: string[] },
): {
  proposal: PlanProposal;
  dropped: Array<{ course_id: string; raw_semester_id: string }>;
} {
  const knownIds: readonly string[] = opts?.knownSemesterIds ?? KNOWN_SEMESTER_IDS;
  const dropped: Array<{ course_id: string; raw_semester_id: string }> = [];
  const bySemester = new Map<string, string[]>();

  for (const sem of proposal.semesters) {
    // First try canonical normalization; if that fails, check if raw id is in knownIds directly.
    const normalized = normalizeSemesterId(sem.semester_id) ??
      (knownIds.includes(sem.semester_id.trim()) ? sem.semester_id.trim() : null);
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
      semesters: knownIds
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
  /** Hard prerequisite course_ids (resolved). Issue 4 — the validator enforces
   *  the UNION of prerequisites ∪ missing_prerequisites. */
  prerequisites?: string[];
  /** True if this is a mandatory (חובה) course. */
  is_mandatory?: boolean;
  /** True for a year-long course that occupies every one of spans_semesters together (never a duplicate). */
  is_annual?: boolean;
  /** The semester ids an is_annual course spans together. */
  spans_semesters?: string[] | null;
}

export interface PlanValidationContext {
  /** course_ids the user has marked as already completed (personal_status.completed). */
  completedCourseIds: Set<string>;
  /**
   * course_ids the user is currently_taking or has planned (personal_status).
   * Such courses are already accounted for as prior progress: they must not be
   * (re-)proposed by the planner (Phase 1 proposal-dedup, rule 2a) and they
   * satisfy prerequisites of proposed courses like completed courses do
   * (rule 4 — strictly earlier than every proposal semester by construction).
   */
  currentlyPlannedCourseIds?: Set<string>;
  /** Per-course info used for hours/effective-semester/prerequisite checks. */
  courses: Record<string, PlanValidationCourseInfo>;
  /** Maximum total weekly hours allowed per semester (from user preferences). */
  maxHoursPerSemester?: number;
  /** True if the user explicitly asked for a balanced load ("איזון עומס") — makes any overload blocking. */
  balanceLoad?: boolean;
  /** PART A — user explicitly clicked "אפשר חריגה בעומס": downgrade severe-overload errors to a warning. */
  overloadAccepted?: boolean;
  /** Phase 2C — timestamp at which the user confirmed the overload. Required (alongside overloadAccepted) to actually downgrade > HARD_LOAD_CAP from error to warning. */
  overloadConfirmedAt?: number | null;
  /** Phase 1b — per-semester blocking cap override (from ConstraintModel.hardCap). Defaults to load_constants.ts's HARD_LOAD_CAP. */
  hardCap?: number;
  /** Phase 1b — preferred-range ceiling override (from ConstraintModel.softLoadMax). Defaults to load_constants.ts's SOFT_LOAD_MAX. */
  softLoadMax?: number;
  /** Phase 1b — never-overridable blocking ceiling override (from ConstraintModel.absoluteMaxReasonable). Defaults to load_constants.ts's ABSOLUTE_MAX_REASONABLE. */
  absoluteMaxReasonable?: number;
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
  /**
   * PART A/B — single source of truth for the 185-ש"ש degree-hour
   * requirement (getDegreeHoursStatus). When satisfied, stale "remaining
   * hours/points" requirement buckets reported by the AI (requirements_status
   * entries about שעות/נקודות שנותרו) must not be surfaced as unmet.
   */
  degreeHoursSatisfied?: boolean;
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
 * The semester set an `is_annual` course is expected to occupy, for the
 * duplicate/pinned-home/completeness checks below: its declared
 * `spans_semesters` when present, otherwise `effective_allowed_semesters` —
 * the same confident legal-semester data `addCourseActionsFor`
 * (planner_actions.ts) falls back to when generating the atomic add action
 * for a board that omits `spans_semesters`. When neither is known (legality
 * itself wasn't confident), returns `[]` so these checks stay silent rather
 * than guess a wrong required set and hard-block a plan — mirrors check 3's
 * own "only restrict when effective_allowed_semesters is present" rule.
 */
function annualSpansFor(info?: PlanValidationCourseInfo): string[] {
  if (!info?.is_annual) return [];
  if (info.spans_semesters?.length) return info.spans_semesters;
  return info.effective_allowed_semesters?.length ? info.effective_allowed_semesters : [];
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
  opts?: { knownSemesterIds?: string[] },
): PlanValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const seenSemesters = new Map<string, string[]>(); // course_id -> semester_ids seen so far, in order
  const placedCourseIds = new Set<string>();

  // Issue 4 — chronological order of semesters in the proposal + each course's
  // index, so the prerequisite check can enforce the STRICT timing rule
  // (prereq must be completed or scheduled in a STRICTLY EARLIER semester;
  // same-semester does NOT satisfy).
  const semOrder = new Map<string, number>();
  proposal.semesters.forEach((s, i) => semOrder.set(s.semester_id, i));
  const courseSemIdx = new Map<string, number>();
  for (const sem of proposal.semesters) {
    const idx = semOrder.get(sem.semester_id)!;
    for (const cid of sem.course_ids) courseSemIdx.set(cid, idx);
  }

  for (const sem of proposal.semesters) {
    const semHours = getSemesterLoad(sem, ctx.courses);
    const semName = semesterLabel(sem.semester_id, ctx.semesterLabels);

    for (const courseId of sem.course_ids) {
      const cName = courseLabel(courseId, ctx.courseNames);
      const info = ctx.courses[courseId];

      // 1. duplicate placement across semesters — except an is_annual course
      // legitimately occupying every one of its spans_semesters together
      // (e.g. a year-long lab meeting in both halves of the year). That is
      // not a duplicate: it's counted once toward degree hours (see
      // planner_goals.ts's placedHours) but must appear in each spanned
      // semester's own weekly load. Anything beyond that exact expected
      // set — a repeat within the same semester, a semester outside
      // spans_semesters, or more occurrences than spans_semesters has — is
      // still a genuine duplicate error.
      const priorSems = seenSemesters.get(courseId) ?? [];
      if (priorSems.length > 0) {
        const spans = annualSpansFor(info);
        const isExpectedAnnualSpan =
          spans.length > 0 &&
          spans.includes(sem.semester_id) &&
          !priorSems.includes(sem.semester_id) &&
          priorSems.every(s => spans.includes(s)) &&
          priorSems.length < spans.length;
        if (!isExpectedAnnualSpan) {
          const firstSemName = semesterLabel(priorSems[0], ctx.semesterLabels);
          errors.push(
            `קורס ${cName} משובץ פעמיים — גם ב${firstSemName} וגם ב${semName}.`,
          );
        }
      }
      seenSemesters.set(courseId, [...priorSems, sem.semester_id]);
      placedCourseIds.add(courseId);

      // 2. completed course must not be (re-)scheduled
      if (ctx.completedCourseIds.has(courseId)) {
        errors.push(`קורס ${cName} כבר הושלם על ידי המשתמש ולא ניתן לשבץ אותו מחדש (ב${semName}).`);
      }

      // 2a. currently_taking/planned course must not be (re-)proposed — it is
      // already accounted for as prior progress (Phase 1 proposal-dedup).
      else if (ctx.currentlyPlannedCourseIds?.has(courseId)) {
        errors.push(`קורס ${cName} כבר מתוכנן/נלמד כעת על ידי המשתמש ולא ניתן להציע אותו שוב (ב${semName}).`);
      }

      // 2b. pinned course must remain in its current semester. An is_annual
      // course pinned across its full spans_semesters is never "moved" by
      // appearing in each of them — currentSemesterByCourseId only records
      // one representative home semester per pinned id (buildPinnedHome
      // stops at the first match), so for an annual course any of its own
      // spans is equally "home," not a move away from it.
      if (ctx.pinnedCourseIds?.has(courseId)) {
        const currentSem = ctx.currentSemesterByCourseId?.[courseId];
        const spans = annualSpansFor(info);
        const isAnnualHome = spans.length > 0 && spans.includes(sem.semester_id) && (!currentSem || spans.includes(currentSem));
        if (currentSem && currentSem !== sem.semester_id && !isAnnualHome) {
          errors.push(`הקורס ${cName} מסומן כ'אל תזיז' ולכן לא ניתן להזיז אותו.`);
        }
      }

      // 3. placement must be within effective_allowed_semesters
      if (info?.effective_allowed_semesters && info.effective_allowed_semesters.length > 0) {
        if (!info.effective_allowed_semesters.includes(sem.semester_id)) {
          const allowedNames = info.effective_allowed_semesters.map(s => semesterLabel(s, ctx.semesterLabels)).join(', ');
          errors.push(
            `קורס ${cName} משובץ ב${semName} אך מותר רק ב${allowedNames}.`,
          );
        }
      }

      // 4. prerequisites — Issue 4: STRICT timing rule, enforced as an ERROR
      // (mirrors validatePlanProposalLocal). A prereq is satisfied only if it is
      // completed OR scheduled in a strictly EARLIER semester in this plan.
      // Same-semester or later (or not scheduled at all) is a blocking error.
      // Enforces the UNION of prerequisites ∪ missing_prerequisites.
      const prereqUnion = new Set<string>([
        ...(info?.prerequisites || []),
        ...(info?.missing_prerequisites || []),
      ]);
      const targetIdx = semOrder.get(sem.semester_id)!;
      for (const prereq of prereqUnion) {
        // A currently-taking course is prior progress: rule 2a guarantees it can
        // never appear in the proposal, so it is strictly earlier than every
        // proposed semester and satisfies the prereq like a completed course.
        if (ctx.completedCourseIds.has(prereq) || ctx.currentlyPlannedCourseIds?.has(prereq)) continue;
        const pIdx = courseSemIdx.get(prereq);
        if (pIdx === undefined) {
          errors.push(`לא ניתן לשבץ את ${cName} (ב${semName}) — דרישת הקדם ${courseLabel(prereq, ctx.courseNames)} אינה משובצת בתוכנית ולא הושלמה.`);
        } else if (pIdx > targetIdx) {
          errors.push(`לא ניתן לשבץ את ${cName} לפני דרישת הקדם ${courseLabel(prereq, ctx.courseNames)}.`);
        } else if (pIdx === targetIdx) {
          errors.push(`לא ניתן לשבץ את ${cName} ואת דרישת הקדם ${courseLabel(prereq, ctx.courseNames)} באותו סמסטר (${semName}).`);
        }
      }

    }

    // 5. Phase 2C unified overload policy (single source of truth — must
    // match load_constants.ts and the client-side validatePlanProposalLocal):
    //   - hrs > absoluteMaxReasonable (default 30): always blocking ERROR.
    //   - hrs > hardCap (default 26): blocking ERROR unless user explicitly
    //     confirmed overload (overloadAccepted && overloadConfirmedAt); then
    //     downgraded to a WARNING containing "חריגה בעומס שאושרה ידנית".
    //   - hrs > softLoadMax (default 22) and ≤ hardCap: WARNING.
    //   - hrs ≤ softLoadMax: no message.
    // Phase 1b — thresholds are sourced from ctx (populated from
    // ConstraintModel), falling back to load_constants.ts when ctx omits them,
    // so any existing caller that never sets these fields sees no change.
    const hardCap = ctx.hardCap ?? HARD_LOAD_CAP;
    const softLoadMax = ctx.softLoadMax ?? SOFT_LOAD_MAX;
    const absoluteMaxReasonable = ctx.absoluteMaxReasonable ?? ABSOLUTE_MAX_REASONABLE;
    if (semHours > absoluteMaxReasonable) {
      errors.push(
        `ב${semName} יש ${semHours} שעות שבועיות — חריגה לא סבירה מעל ${absoluteMaxReasonable} ש"ש. לא ניתן להחיל את התוכנית.`,
      );
    } else if (semHours > hardCap) {
      const userConfirmed = ctx.overloadAccepted === true && !!ctx.overloadConfirmedAt;
      if (userConfirmed) {
        warnings.push(
          `ב${semName} יש ${semHours} שעות שבועיות (מעל המגבלה הקשיחה ${hardCap}) — חריגה בעומס שאושרה ידנית.`,
        );
      } else {
        errors.push(
          `ב${semName} יש ${semHours} שעות שבועיות — חריגה מהמגבלה הקשיחה (${hardCap} ש"ש). נדרש אישור חריגה מפורש.`,
        );
      }
    } else if (semHours > softLoadMax) {
      warnings.push(
        `ב${semName} יש ${semHours} שעות שבועיות — מעל הטווח המומלץ (${softLoadMax} ש"ש).`,
      );
    }
  }

  // 5b. annual (year-long) course completeness — an is_annual course must
  // appear in EVERY one of its spans_semesters, never just some of them. The
  // duplicate-placement check above (1) only fires when a *repeat* is seen,
  // so it cannot catch the opposite failure — a plan (e.g. one produced by a
  // MOVE_COURSE/REPLACE_COURSE/REMOVE_COURSE call that isn't routed through
  // the annual-aware ADD_COURSE path) where the course was split down to
  // just one semester. Without this, such a plan would be reported valid
  // and complete while silently under-reporting the missing semester's load.
  for (const [courseId, sems] of seenSemesters) {
    const info = ctx.courses[courseId];
    if (!info?.is_annual) continue;
    const spans = annualSpansFor(info);
    if (!spans.length) continue;
    const missing = spans.filter(s => !sems.includes(s));
    if (missing.length > 0) {
      const cName = courseLabel(courseId, ctx.courseNames);
      const missingNames = missing.map(s => semesterLabel(s, ctx.semesterLabels)).join(', ');
      errors.push(
        `קורס ${cName} הוא קורס שנתי המשובץ בחלק מהסמסטרים בלבד — חסר גם ב${missingNames}.`,
      );
    }
  }

  // 6. partial-plan check — every not-completed mandatory course must appear,
  // reported with the exact missing course IDs/names (PART C) — never a
  // generic "missing mandatory" message without a concrete list. A
  // currently-taking course is already accounted for (rule 2a forbids
  // re-proposing it), so its absence from the proposal is not a gap.
  if (ctx.requiredMandatoryCourseIds) {
    const missingMandatory = ctx.requiredMandatoryCourseIds.filter(
      cid => !placedCourseIds.has(cid) && !ctx.completedCourseIds.has(cid) &&
        !ctx.currentlyPlannedCourseIds?.has(cid),
    );
    for (const cid of missingMandatory) {
      errors.push(`קורס חובה חסר: ${courseLabel(cid, ctx.courseNames)}.`);
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

  // also surface any AI-reported unmet requirements directly — except a
  // generic "remaining hours/points" bucket, which the 185-ש"ש degree-hour
  // model (getDegreeHoursStatus) already covers and supersedes (PART A/B/E).
  const isGenericHoursBucket = (name: string) => /שעות|נק["'׳]?ז|נקוד/.test(name);
  for (const status of proposal.requirements_status) {
    if (ctx.degreeHoursSatisfied && isGenericHoursBucket(status.name)) continue;
    if (!status.satisfied && status.placed < status.required) {
      const already = warnings.find(w => w.includes(`"${status.name}"`));
      if (!already) {
        warnings.push(`דרישת "${status.name}" אינה מתמלאת במלואה: ${status.placed}/${status.required}.`);
      }
    }
  }

  return { errors, warnings };
}
