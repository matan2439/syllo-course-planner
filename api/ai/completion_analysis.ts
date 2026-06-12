/**
 * Deterministic "degree completion" analysis, computed from the live board's
 * `plan_context` (see api/ai/_context.ts: PlanContext) before the AI is asked
 * to propose anything. This turns "ask the AI to arrange a plan" into "tell
 * the AI exactly what's still missing, and ask it to fill those gaps".
 *
 * Used by:
 *  - api/ai/generate-plan.ts (server) — to build the "משימת השלמת תואר
 *    מחושבת" prompt section (PART C).
 *  - app/web/semester_board_viewer.html (client, mirrored manually) — to
 *    decide whether a returned proposal is a "complete plan" (PART B/E) and
 *    to deterministically insert missing electives (PART D).
 */

import type { PlanContext } from './_context';

/** Total credit-hours required for the degree (ש״ש). */
export const DEGREE_REQUIRED_HOURS = 185;

/** Fallback per-semester hour cap used when the user hasn't set one. */
export const DEFAULT_MAX_HOURS_PER_SEMESTER = 18;

/** How far over the cap counts as "severe" overload (blocking if movable courses exist). */
export const SEVERE_OVERLOAD_MARGIN = 3;

/** Hard cap on how many electives repairAddHoursToDegree may add (PART E). */
export const MAX_ADDED_ELECTIVES_FOR_HOURS = 12;

/** When prior completed-degree hours are unknown, add at most this many extra electives beyond required categories (PART G). */
export const DEFAULT_ADDED_ELECTIVES_WHEN_PRIOR_HOURS_UNKNOWN = 6;

/** Any semester above this weekly load is considered an unreasonable plan (PART E). */
export const MAX_REASONABLE_SEMESTER_HOURS = 30;

export interface CompletionCandidate {
  course_id: string;
  name_he?: string;
  hours?: number | null;
  has_syllabus_summary?: boolean;
  grade_average?: number | null;
  is_wanted?: boolean;
}

export interface CompletionCategory {
  name: string;
  category_id?: string | null;
  required: number;
  placed: number;
  missing: number;
  /** Eligible courses for this category that are not yet completed/scheduled. */
  candidates: CompletionCandidate[];
}

export interface CompletionMovableCourse {
  course_id: string;
  name_he?: string;
  current_semester: string | null;
  hours?: number | null;
  effective_allowed_semesters?: string[] | null;
}

export interface CompletionOverloadedSemester {
  semester_id: string;
  label: string;
  total_hours: number;
}

export interface CompletionHours {
  required_total: number;
  known_completed_hours: number;
  known_scheduled_hours: number;
  known_total_hours: number;
  remaining_hours: number;
  unknown_hour_courses: number;
  /** True if `remaining_hours` is approximate because some courses have unknown hours. */
  approximate: boolean;
  /** Hours already completed in קורסי שער/רוח (general/humanities courses). */
  completed_general_hours: number;
  /** Total קורסי שער/רוח hours required by the degree. */
  required_general_hours: number;
  /** Remaining קורסי שער/רוח hours — must not be filled by technical electives. */
  general_hours_shortfall: number;
  /** True only if the user explicitly entered total completed-degree hours (PART B). */
  prior_hours_known: boolean;
}

export interface CompletionAnalysis {
  completed_course_ids: string[];
  scheduled_course_ids: string[];
  missing_mandatory: Array<{ course_id: string; name_he?: string; hours?: number }>;
  categories: CompletionCategory[];
  /** Union of all category candidates (incl. already-satisfied categories), deduped — used to fill remaining degree hours (PART D). */
  elective_pool: CompletionCandidate[];
  /** קורסי שער רוח requirement — separate from engineering elective categories. Null if the program has no such requirement. */
  general_requirement: CompletionCategory | null;
  hours: CompletionHours;
  overloaded_semesters: CompletionOverloadedSemester[];
  movable_courses: CompletionMovableCourse[];
  pinned_course_ids: string[];
}

/**
 * Compute the deterministic "completion task" from a live-board plan_context.
 *
 * `plan_context` is expected to carry the extra fields populated by the
 * client's `buildPlanContext()`: `category_requirements`, `total_hours_progress`
 * (with `known_completed_hours`), `movable_courses`, `overload_warnings`,
 * `pinned_course_ids`. All of these are optional/best-effort — missing data
 * degrades gracefully (e.g. categories default to `[]`).
 */
export function buildCompletionAnalysis(ctx: PlanContext): CompletionAnalysis {
  const scheduled_course_ids = (ctx.semesters ?? []).flatMap(s => s.courses.map(c => c.course_id));
  const completed_course_ids = (ctx.personal_status?.completed ?? []).map(c => c.course_id);

  const missing_mandatory = (ctx.mandatory_unplaced ?? []).map(c => ({
    course_id: c.course_id,
    name_he: c.name_he,
    hours: c.hours,
  }));

  const scheduledSet = new Set(scheduled_course_ids);
  const completedSet = new Set(completed_course_ids);

  const categories: CompletionCategory[] = ((ctx as any).category_requirements ?? []).map((cat: any) => {
    const candidates: CompletionCandidate[] = (cat.candidates ?? [])
      .filter((c: any) => !scheduledSet.has(c.course_id) && !completedSet.has(c.course_id))
      .map((c: any) => ({
        course_id:            c.course_id,
        name_he:              c.name_he,
        hours:                c.hours ?? null,
        has_syllabus_summary: !!c.has_syllabus_summary,
        grade_average:        c.grade_average ?? null,
        is_wanted:            !!c.is_wanted,
      }));
    const placed = Number(cat.placed) || 0;
    const required = Number(cat.required) || 0;
    return {
      name: cat.name,
      category_id: cat.category_id ?? null,
      required,
      placed,
      missing: Math.max(0, required - placed),
      candidates,
    };
  });

  // ── קורסי שער רוח requirement — separate category, never mixed into the
  // engineering elective pool (program-specific; null if not configured) ────
  const generalReq = (ctx as any).general_course_requirements;
  const generalCandidateIds = new Set<string>();
  let general_requirement: CompletionCategory | null = null;
  if (generalReq) {
    const candidates: CompletionCandidate[] = (generalReq.candidates ?? [])
      .filter((c: any) => !scheduledSet.has(c.course_id) && !completedSet.has(c.course_id))
      .map((c: any) => ({
        course_id:            c.course_id,
        name_he:              c.name_he,
        hours:                c.hours ?? null,
        has_syllabus_summary: !!c.has_syllabus_summary,
        grade_average:        c.grade_average ?? null,
        is_wanted:            !!c.is_wanted,
      }));
    for (const c of candidates) generalCandidateIds.add(c.course_id);
    for (const c of (generalReq.candidates ?? [])) generalCandidateIds.add(c.course_id);

    // placed credits = candidates already scheduled/placed on the board.
    const placedCredits = (generalReq.candidates ?? [])
      .filter((c: any) => scheduledSet.has(c.course_id))
      .reduce((sum: number, c: any) => sum + (typeof c.hours === 'number' ? c.hours : 0), 0);

    general_requirement = {
      name: generalReq.name,
      category_id: 'general_shaar_ruach',
      required: Number(generalReq.required_credits) || 0,
      placed: placedCredits,
      missing: Math.max(0, (Number(generalReq.required_credits) || 0) - placedCredits),
      candidates,
    };
  }

  // ── Elective pool for filling remaining degree hours (PART D) ────────────
  const electivePoolMap = new Map<string, CompletionCandidate>();
  for (const cat of categories) {
    for (const c of cat.candidates) {
      if (generalCandidateIds.has(c.course_id)) continue; // שער רוח courses never satisfy engineering elective categories
      if (!electivePoolMap.has(c.course_id)) electivePoolMap.set(c.course_id, c);
    }
  }
  const elective_pool = [...electivePoolMap.values()];

  // ── Hours toward the 185 ש"ש degree requirement ──────────────────────────
  const known_scheduled_hours = (ctx.semesters ?? [])
    .flatMap(s => s.courses)
    .reduce((sum, c) => sum + (typeof c.hours === 'number' ? c.hours : 0), 0);
  const unknown_scheduled = (ctx.semesters ?? [])
    .flatMap(s => s.courses)
    .filter(c => c.hours == null).length;

  const totalHoursProgress = (ctx as any).total_hours_progress;

  // ── Degree total — program-specific, defaults to DEGREE_REQUIRED_HOURS (185) ──
  const required_total = typeof totalHoursProgress?.degree_required_hours === 'number'
    ? totalHoursProgress.degree_required_hours
    : DEGREE_REQUIRED_HOURS;

  // ── קורסי שער/רוח (general/humanities) requirement — program-specific
  // general_course_requirements (if configured) takes precedence over the
  // generic total_hours_progress.required_general_hours fallback ──────────
  const required_general_hours = typeof generalReq?.required_credits === 'number'
    ? generalReq.required_credits
    : typeof totalHoursProgress?.required_general_hours === 'number'
    ? totalHoursProgress.required_general_hours : 0;
  const completed_general_hours = typeof totalHoursProgress?.completed_general_hours === 'number'
    ? totalHoursProgress.completed_general_hours : 0;
  const general_hours_shortfall = Math.max(0, required_general_hours - completed_general_hours);

  // ── Completed-degree hours: prefer the user's manually entered total (PART
  // B/C) — this is the total prior credit value and is NOT added on top of
  // completed-course-status hours, to avoid double-counting (PART C).
  const manualCompleted = totalHoursProgress?.manual_completed_degree_hours;
  const prior_hours_known = typeof manualCompleted === 'number';
  const completedHoursFromStatuses = typeof totalHoursProgress?.known_completed_hours === 'number'
    ? totalHoursProgress.known_completed_hours : 0;
  const known_completed_hours = prior_hours_known ? manualCompleted : completedHoursFromStatuses;
  const unknown_completed = (ctx.personal_status?.completed ?? [])
    .filter((c: any) => c.hours == null).length;

  const known_total_hours = known_completed_hours + known_scheduled_hours;
  const unknown_hour_courses = unknown_scheduled + unknown_completed;
  const remaining_hours = Math.max(0, required_total - known_total_hours);

  const hours: CompletionHours = {
    required_total,
    known_completed_hours,
    known_scheduled_hours,
    known_total_hours,
    remaining_hours,
    unknown_hour_courses,
    approximate: unknown_hour_courses > 0,
    completed_general_hours,
    required_general_hours,
    general_hours_shortfall,
    prior_hours_known,
  };

  // ── Overloaded semesters (use the live total_hours, default cap) ────────
  const overloaded_semesters: CompletionOverloadedSemester[] = (ctx.semesters ?? [])
    .filter(s => s.total_hours > DEFAULT_MAX_HOURS_PER_SEMESTER)
    .map(s => ({ semester_id: s.id, label: s.label, total_hours: s.total_hours }));

  const pinned_course_ids = (ctx as any).pinned_course_ids ?? [];
  const pinnedSet = new Set<string>(pinned_course_ids);

  const movable_courses: CompletionMovableCourse[] = ((ctx as any).movable_courses ?? [])
    .filter((c: any) => !pinnedSet.has(c.course_id));

  return {
    completed_course_ids,
    scheduled_course_ids,
    missing_mandatory,
    categories,
    elective_pool,
    general_requirement,
    hours,
    overloaded_semesters,
    movable_courses,
    pinned_course_ids,
  };
}

/** Render the analysis as Hebrew bullet lines for the AI prompt (PART C). */
export function formatCompletionMessages(a: CompletionAnalysis): string[] {
  const lines: string[] = [];

  if (a.missing_mandatory.length) {
    lines.push(`קורסי חובה שטרם הושלמו וטרם שובצו: ${a.missing_mandatory.map(c => `${c.name_he || c.course_id} (${c.hours ?? '?'} ש"ש)`).join(', ')}.`);
  } else {
    lines.push('כל קורסי החובה שטרם הושלמו כבר משובצים בתוכנית.');
  }

  const missingCats = a.categories.filter(c => c.missing > 0);
  if (missingCats.length) {
    for (const cat of missingCats) {
      const cands = cat.candidates.slice(0, 6).map(c => `${c.name_he || c.course_id} (${c.course_id})`).join(', ');
      lines.push(`קטגוריית בחירה "${cat.name}": חסרים ${cat.missing} מתוך ${cat.required} קורסים. מועמדים אפשריים: ${cands || 'לא נמצאו מועמדים זמינים'}.`);
    }
  } else if (a.categories.length) {
    lines.push('כל דרישות קטגוריות הבחירה הידועות מולאות.');
  }

  if (a.general_requirement) {
    const gr = a.general_requirement;
    if (gr.missing > 0) {
      if (gr.candidates.length > 0) {
        const cands = gr.candidates.slice(0, 6).map(c => `${c.name_he || c.course_id} (${c.course_id})`).join(', ');
        lines.push(`קורסי שער רוח: שובצו ${gr.placed}/${gr.required} נק"ז. מועמדים אפשריים: ${cands}.`);
      } else {
        lines.push(`קורסי שער רוח: שובצו ${gr.placed}/${gr.required} נק"ז, וחסרות ${gr.missing} נק"ז — מאגר קורסי שער רוח אינו זמין, יש להשלים ידנית.`);
      }
    } else {
      lines.push(`קורסי שער רוח: דרישת ${gr.required} נק"ז הושלמה.`);
    }
  } else if (a.hours.required_general_hours > 0) {
    lines.push(`דרישת קורסי שער/רוח (${a.hours.required_general_hours} נק"ז) קיימת אך מאגר הקורסים אינו זמין במערכת.`);
  }

  if (a.hours.approximate) {
    lines.push(`שעות ידועות עד כה: ${a.hours.known_total_hours} מתוך ${a.hours.required_total} ש"ש (${a.hours.unknown_hour_courses} קורסים עם שעות לא ידועות — ההערכה משוערת). נותרו כ-${a.hours.remaining_hours} ש"ש ידועות להשלמה.`);
  } else {
    lines.push(`שעות ידועות: ${a.hours.known_total_hours} מתוך ${a.hours.required_total} ש"ש. נותרו ${a.hours.remaining_hours} ש"ש להשלמה.`);
  }

  if (a.overloaded_semesters.length) {
    lines.push(`סמסטרים עמוסים מדי כיום: ${a.overloaded_semesters.map(s => `${s.label} (${s.total_hours} ש"ש)`).join(', ')}.`);
  }

  if (a.movable_courses.length) {
    lines.push(`קורסים שניתן להזיז בין סמסטרים (לא מסומנים כ"אל תזיז", לא הושלמו): ${a.movable_courses.slice(0, 10).map(c => c.name_he || c.course_id).join(', ')}.`);
  }

  if (a.pinned_course_ids.length) {
    lines.push(`קורסים מסומנים כ"אל תזיז" (אסור להזיז): ${a.pinned_course_ids.join(', ')}.`);
  }

  return lines;
}

export interface CompletenessResult {
  /** True if the plan still leaves required work undone. */
  incomplete: boolean;
  /** Human-readable Hebrew explanations of what's missing (PART E). */
  reasons: string[];
  /** Number of non-wanted, non-mandatory electives the proposal added beyond the live board. */
  added_electives: number;
  /** Total known credit-hours (board + proposal additions) toward the 185 ש"ש requirement (PART A). */
  proposed_total_hours: number;
}

/**
 * A plan is applyable if there are no blocking validation errors and no
 * blocking completeness reasons — i.e. at most warnings/info remain.
 */
export function isPlanApplyable(validationErrors: string[], completeness: CompletenessResult | null | undefined): boolean {
  return validationErrors.length === 0 && !completeness?.incomplete;
}

export type PlanStatusKind = 'success' | 'warning' | 'error';

export interface PlanPreviewStatus {
  kind: PlanStatusKind;
  icon: '✓' | '⚠' | '✕';
  text: string;
}

/**
 * Explicit status object for the preview status bar, so the visual class/icon
 * is derived from the same applyability logic as the Apply button — never
 * red unless the plan is genuinely blocked.
 */
export function getPlanPreviewStatus(
  validationErrors: string[],
  completeness: CompletenessResult | null | undefined,
  statusText: string
): PlanPreviewStatus {
  const applyable = isPlanApplyable(validationErrors, completeness);
  if (!applyable) {
    return { kind: 'error', icon: '✕', text: statusText };
  }
  if ((completeness?.reasons || []).length > 0) {
    return { kind: 'warning', icon: '⚠', text: statusText };
  }
  return { kind: 'success', icon: '✓', text: statusText };
}

/**
 * PART C: compact "מה השתנה?" summary for the preview — at most 4 bullets.
 */
export function buildPreviewChangeBullets(opts: {
  addedElectives: number;
  maxSemHours: number;
  allCategoriesSatisfied: boolean;
  warningCount: number;
}): string[] {
  const bullets: string[] = [];
  if (opts.addedElectives > 0) {
    bullets.push(opts.addedElectives === 1 ? 'נוסף קורס בחירה אחד' : `נוספו ${opts.addedElectives} קורסי בחירה`);
  }
  if (opts.maxSemHours > 0) {
    bullets.push(`עומס מקסימלי: ${opts.maxSemHours} ש״ש`);
  }
  if (opts.allCategoriesSatisfied) {
    bullets.push('הושלמו כל קטגוריות החובה');
  }
  if (opts.warningCount > 0) {
    bullets.push(opts.warningCount === 1 ? 'נותרה אזהרה אחת' : `נותרו ${opts.warningCount} אזהרות`);
  }
  return bullets.slice(0, 4);
}

/**
 * Decide whether a (already normalized/repaired) proposal still represents an
 * incomplete plan, per PART B's rules, and produce human-readable Hebrew
 * explanations (PART E) — replacing cryptic "0/1" displays.
 */
export function evaluatePlanCompleteness(
  proposalSemesters: Array<{ semester_id: string; course_ids: string[] }>,
  analysis: CompletionAnalysis,
  opts: { wantedCourseIds?: string[]; courseHours?: Record<string, number | null | undefined>; movableCourseIds?: Set<string> } = {},
): CompletenessResult {
  const reasons: string[] = [];
  const blocking: string[] = [];
  const placed = new Set(proposalSemesters.flatMap(s => s.course_ids));

  // 1. missing mandatory courses
  const missingMandatory = analysis.missing_mandatory.filter(c => !placed.has(c.course_id));
  if (missingMandatory.length) {
    const msg = `חסרים קורסי חובה: ${missingMandatory.map(c => c.name_he || c.course_id).join(', ')}.`;
    reasons.push(msg);
    blocking.push(msg);
  }

  // 2. unmet required categories — derived from the SAME getCategoryStatusReport
  // used to render the preview's category checklist, so the top status and the
  // checklist can never disagree (PART B/F).
  for (const cat of getCategoryStatusReport(analysis, placed)) {
    if (cat.satisfied) continue;
    if (cat.candidates.length > 0) {
      const msg = cat.missing === 1
        ? `חסר קורס אחד מקורסי הקטגוריה "${cat.name}".`
        : `חסרים ${cat.missing} קורסים מקטגוריית "${cat.name}".`;
      reasons.push(msg);
      blocking.push(msg);
    } else {
      // Category still unmet, but no eligible candidates exist — informational only.
      reasons.push(`אין קורס מועמד זמין בקטגוריה "${cat.name}".`);
    }
  }

  // 3. total degree hours (185 ש"ש) — hard requirement (PART A/B). The plan is
  // not complete while proposed_total_hours < required_total, unless the
  // elective pool is proven exhausted.
  let addedHours = 0;
  for (const cid of placed) {
    if (analysis.scheduled_course_ids.includes(cid)) continue; // already on the live board
    const h = opts.courseHours?.[cid];
    if (typeof h === 'number') addedHours += h;
  }
  const hoursShort = Math.max(0, analysis.hours.remaining_hours - addedHours);
  const proposed_total_hours = analysis.hours.required_total - hoursShort;

  // 2b. קורסי שער רוח — separate requirement, never filled by/with engineering electives.
  const generalStatus = getGeneralRequirementStatusReport(analysis, placed);
  let generalShortfall = analysis.hours.general_hours_shortfall ?? 0;
  if (generalStatus) {
    generalShortfall = generalStatus.missing;
    if (generalStatus.missing > 0) {
      if (generalStatus.candidates.length > 0) {
        const msg = `קורסי שער רוח: שובצו ${generalStatus.placed}/${generalStatus.required} נק"ז, חסרות ${generalStatus.missing} נק"ז.`;
        reasons.push(msg);
        blocking.push(msg);
      } else {
        reasons.push(`קורסי שער רוח: שובצו ${generalStatus.placed}/${generalStatus.required} נק"ז, חסרות ${generalStatus.missing} נק"ז — מאגר קורסי שער רוח אינו זמין, יש להשלים ידנית או להוסיף מאגר קורסים מתאים.`);
      }
    }
  }

  // Of the overall shortfall, the part that may legally be filled by technical
  // electives excludes the general/humanities shortfall (PART G.3).
  const electiveShort = Math.max(0, hoursShort - generalShortfall);

  if (analysis.hours.prior_hours_known === false) {
    // PART B/G — without a known prior-hours baseline, the 185 check is just
    // not meaningful; surface it as informational only.
    if (hoursShort > 0) {
      reasons.push('לא הוזנו שעות שכבר צברת, לכן חישוב 185 ש"ש אינו מדויק.');
    }
  } else if (electiveShort > 0) {
    // PART D — the remaining-hours pool is NOT restricted to categories with
    // missing > 0: any unscheduled/uncompleted course from elective_pool
    // (which spans all categories, including already-satisfied ones) is a
    // valid candidate to fill the remaining degree hours (PART A/B).
    const remainingCandidates = (analysis.elective_pool ?? []).filter(c => !placed.has(c.course_id));
    const msg = `חסרות כ-${electiveShort} ש"ש מתוך ${analysis.hours.required_total} ש"ש להשלמת התואר.`;
    reasons.push(msg);
    blocking.push(msg);
    if (remainingCandidates.length > 0) {
      // PART F — do not falsely claim no candidates exist when the pool is non-empty.
      reasons.push('נמצאו קורסי בחירה נוספים שאפשר לשבץ להשלמת השעות.');
    } else {
      reasons.push('לא נמצאו קורסים חוקיים נוספים במאגר. פירוט הסיבות מופיע בהסברים.');
    }
  }

  if (!generalStatus && generalShortfall > 0) {
    reasons.push(`חסרות ${generalShortfall} ש"ס בקורסי שער/רוח — יש להשלים ידנית או להוסיף מאגר קורסים מתאים.`);
  }

  // 3b. unreasonably overloaded plan (>30 ש"ש in a semester) usually means the
  // hours model is missing prior-credit info and over-filled the visible
  // board (PART E).
  for (const sem of proposalSemesters) {
    const hrs = sem.course_ids.reduce((s, cid) => s + (opts.courseHours?.[cid] || 0), 0);
    if (hrs > MAX_REASONABLE_SEMESTER_HOURS) {
      const msg = 'נוצר עומס לא סביר — כנראה חסר מידע על שעות שכבר צברת בתואר.';
      reasons.push(msg);
      blocking.push(msg);
    }
  }

  // 4. severe overload remains and movable courses exist
  for (const sem of proposalSemesters) {
    const hrs = sem.course_ids.reduce((s, cid) => s + (opts.courseHours?.[cid] || 0), 0);
    if (hrs > DEFAULT_MAX_HOURS_PER_SEMESTER + SEVERE_OVERLOAD_MARGIN && hrs <= MAX_REASONABLE_SEMESTER_HOURS) {
      const movableInSem = opts.movableCourseIds
        ? sem.course_ids.filter(cid => opts.movableCourseIds!.has(cid))
        : [];
      if (movableInSem.length > 0) {
        const msg = `סמסטר ${sem.semester_id} עמוס מדי (${hrs} ש"ש) למרות שניתן להעביר קורסים גמישים.`;
        reasons.push(msg);
        blocking.push(msg);
      }
    }
  }

  // ── Added electives count (for PART E's "קורסי בחירה שנוספו" line) ───────
  const wanted = new Set(opts.wantedCourseIds ?? []);
  let added_electives = 0;
  for (const cid of placed) {
    if (analysis.scheduled_course_ids.includes(cid) || analysis.completed_course_ids.includes(cid)) continue;
    if (wanted.has(cid)) continue;
    if (analysis.missing_mandatory.some(c => c.course_id === cid)) continue;
    added_electives++;
  }

  return { incomplete: blocking.length > 0, reasons, added_electives, proposed_total_hours };
}

export interface MissingRequirementCard {
  category_id: string | null;
  name: string;
  missing: number;
  candidates: CompletionCandidate[];
}

export interface CategoryStatus {
  category_id: string | null;
  name: string;
  satisfied: boolean;
  placed_course_ids: string[];
  missing: number;
  candidates: CompletionCandidate[];
  /** Total credits/courses required and currently placed (used by the שער רוח report). */
  required?: number;
  placed?: number;
}

/**
 * PART D — for every required elective category, report whether it's already
 * satisfied by courses in `placedIds` (with the placed course ids), or — if
 * not — the remaining shortfall and up to 3 best candidates.
 */
export interface MandatoryStatus {
  required: number;
  placed: number;
  missing: Array<{ course_id: string; name_he?: string }>;
}

/**
 * PART D — compact mandatory-course completion status, shown above the
 * elective category checklist in the preview's "דרישות תואר" section.
 */
export function getMandatoryStatusReport(
  analysis: CompletionAnalysis,
  placedIds: Set<string>,
): MandatoryStatus {
  const missing = analysis.missing_mandatory.filter(c => !placedIds.has(c.course_id));
  const placed = analysis.missing_mandatory.length - missing.length;
  return {
    required: analysis.missing_mandatory.length,
    placed,
    missing: missing.map(c => ({ course_id: c.course_id, name_he: c.name_he })),
  };
}

/**
 * PART (שער רוח) — status of the program's general/humanities credit
 * requirement, counted in נק"ז (credits) rather than course count. Returns
 * null if the program has no such requirement configured.
 */
export function getGeneralRequirementStatusReport(
  analysis: CompletionAnalysis,
  placedIds: Set<string>,
): CategoryStatus | null {
  const gr = analysis.general_requirement;
  if (!gr) return null;
  const placedFromGeneral = gr.candidates.filter(c => placedIds.has(c.course_id));
  const placedCredits = placedFromGeneral.reduce((sum, c) => sum + (typeof c.hours === 'number' ? c.hours : 0), 0);
  const totalPlaced = gr.placed + placedCredits + (analysis.hours.completed_general_hours ?? 0);
  const missing = Math.max(0, gr.required - totalPlaced);
  const remaining = gr.candidates.filter(c => !placedIds.has(c.course_id));
  const sorted = [...remaining].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  return {
    category_id: gr.category_id ?? null,
    name: gr.name,
    satisfied: missing === 0,
    placed_course_ids: placedFromGeneral.map(c => c.course_id),
    missing,
    candidates: sorted.slice(0, 3),
    required: gr.required,
    placed: totalPlaced,
  };
}

export function getCategoryStatusReport(
  analysis: CompletionAnalysis,
  placedIds: Set<string>,
): CategoryStatus[] {
  return analysis.categories.map(cat => {
    const placedFromCategory = cat.candidates.filter(c => placedIds.has(c.course_id));
    const stillMissing = Math.max(0, cat.missing - placedFromCategory.length);
    const remaining = cat.candidates.filter(c => !placedIds.has(c.course_id));
    const sorted = [...remaining].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
    return {
      category_id: cat.category_id ?? null,
      name: cat.name,
      satisfied: stillMissing === 0,
      placed_course_ids: placedFromCategory.map(c => c.course_id),
      missing: stillMissing,
      candidates: sorted.slice(0, 3),
    };
  });
}

/**
 * PART B — for each elective category still unmet by the proposal, return a
 * compact card with up to 3 best candidates. Only includes categories that
 * are still actually missing (i.e. `missing > 0` after subtracting placed
 * candidates).
 */
export function getMissingRequirementCards(
  analysis: CompletionAnalysis,
  placedIds: Set<string>,
): MissingRequirementCard[] {
  return getCategoryStatusReport(analysis, placedIds)
    .filter(c => c.missing > 0)
    .map(({ category_id, name, missing, candidates }) => ({ category_id, name, missing, candidates }));
}

/**
 * PART A — pick the single most important Hebrew reason to show in the top
 * status bar, so the user immediately understands why a plan can/can't be
 * applied — instead of a generic "יש לתקן שגיאות".
 */
export function pickPrimaryBlockingReason(
  completeness: CompletenessResult,
  missingCards: MissingRequirementCard[],
): string {
  if (!completeness.incomplete) {
    return completeness.reasons.length > 0
      ? 'ניתן להחיל — נותרו אזהרות בלבד'
      : 'תוכנית חוקית — ניתן להחיל';
  }

  // PART B/C — missing mandatory courses are the top-priority blocking reason.
  const mandatoryReason = completeness.reasons.find(r => r.startsWith('חסרים קורסי חובה') || r.includes('לא ניתן לשיבוץ חוקי'));
  if (mandatoryReason) {
    const count = mandatoryReason.match(/חסרים קורסי חובה: (.+)\./)?.[1]?.split(', ').length;
    return count ? `לא ניתן להחיל — חסרים ${count} קורסי חובה` : 'לא ניתן להחיל — חסרים קורסי חובה';
  }

  // PART E — unreasonable load (>30 ש"ש) takes priority: it usually means the
  // hours model over-filled the visible board due to missing prior-hours info.
  if (completeness.reasons.some(r => r.includes('עומס לא סביר'))) {
    return 'לא ניתן להחיל — נוצר עומס לא סביר';
  }

  const missingWithCandidates = missingCards.filter(c => c.missing > 0 && c.candidates.length > 0);
  if (missingWithCandidates.length) {
    return 'לא ניתן להחיל — חסרות דרישות תואר';
  }

  // PART A — total degree-hours shortfall with legal candidates remaining.
  if (completeness.reasons.some(r => r.startsWith('חסרות כ-') && r.endsWith('להשלמת התואר.'))) {
    return 'לא ניתן להחיל — חסרות שעות להשלמת התואר';
  }

  if (completeness.reasons.some(r => r.includes('עמוס מדי'))) {
    return 'לא ניתן להחיל — עומס גבוה מדי';
  }

  if (completeness.reasons.some(r => r.includes('אל תזיז') || r.includes('נעוץ'))) {
    return 'לא ניתן להחיל — קורס נעוץ הוזז';
  }

  return 'לא ניתן להחיל — יש לתקן שגיאות';
}

/** Score a candidate elective for repair-insertion (higher = preferred). */
export function scoreCandidate(c: CompletionCandidate): number {
  let score = 0;
  if (c.is_wanted) score += 5;
  if (c.has_syllabus_summary) score += 2;
  if (c.hours != null) score += 1;
  if (c.grade_average != null) score += c.grade_average / 100;
  return score;
}

/** Pick the best candidate, preferring ones not in `unwantedIds` if alternatives exist. */
export function pickBestCandidate(
  candidates: CompletionCandidate[],
  unwantedIds: Set<string> = new Set(),
): CompletionCandidate | null {
  if (!candidates.length) return null;
  const preferred = candidates.filter(c => !unwantedIds.has(c.course_id));
  const pool = preferred.length ? preferred : candidates;
  return [...pool].sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0];
}

export interface RepairCourseInfo {
  hours?: number | null;
  effective_allowed_semesters?: string[] | null;
  placement_policy?: string | null;
}

export interface RepairProposalShape {
  semesters: Array<{ semester_id: string; course_ids: string[] }>;
  warnings_he?: string[];
  [key: string]: unknown;
}

export interface RepairAddResult<P extends RepairProposalShape> {
  proposal: P;
  added: Array<{ course_id: string; category: string; semester_id: string }>;
}

export interface RepairMandatoryResult<P extends RepairProposalShape> {
  proposal: P;
  added: Array<{ course_id: string; semester_id: string }>;
  /** Mandatory courses that have no legal semester to be placed in (PART A.4). */
  unplaceable: Array<{ course_id: string; name_he?: string }>;
}

/**
 * PART A (phase 1) — deterministic repair: for every remaining mandatory
 * course not yet completed and not already scheduled in the proposal, insert
 * it into a legal semester before any elective repair/balancing runs.
 *
 * - placement_policy === 'fixed'  → only its single allowed/recommended semester.
 * - placement_policy === 'flexible' (or unset) → least-loaded legal semester
 *   from effective_allowed_semesters (or any known semester if unset).
 * - If no legal semester exists, the course is reported in `unplaceable`
 *   (PART A.4) and left out of the proposal.
 *
 * Pure function — does not mutate `proposal`.
 */
export function repairAddMissingMandatory<P extends RepairProposalShape>(
  proposal: P,
  analysis: CompletionAnalysis,
  opts: {
    courses: Record<string, RepairCourseInfo>;
    maxHoursPerSemester?: number | null;
    knownSemesterIds: string[];
  },
): RepairMandatoryResult<P> {
  const max = opts.maxHoursPerSemester ?? DEFAULT_MAX_HOURS_PER_SEMESTER;
  const sems = proposal.semesters.map(s => ({ ...s, course_ids: [...s.course_ids] }));
  for (const id of opts.knownSemesterIds) {
    if (!sems.some(s => s.semester_id === id)) sems.push({ semester_id: id, course_ids: [] });
  }
  const placed = new Set(sems.flatMap(s => s.course_ids));
  const added: Array<{ course_id: string; semester_id: string }> = [];
  const unplaceable: Array<{ course_id: string; name_he?: string }> = [];

  const hoursOf = (sem: { course_ids: string[] }) =>
    sem.course_ids.reduce((sum, cid) => sum + (opts.courses[cid]?.hours || 0), 0);

  for (const course of analysis.missing_mandatory) {
    // 6. Completed (filtered upstream into missing_mandatory) and already-placed
    // mandatory courses must not be scheduled again.
    if (placed.has(course.course_id)) continue;

    const info = opts.courses[course.course_id] || {};
    const allowed = info.effective_allowed_semesters?.length ? info.effective_allowed_semesters : null;

    let legalSems;
    if (info.placement_policy === 'fixed') {
      // 1. Fixed mandatory courses go only to their required/recommended semester(s).
      legalSems = allowed ? sems.filter(s => allowed.includes(s.semester_id)) : [];
    } else {
      // 2/3. Flexible (or unspecified) mandatory courses go to the
      // least-loaded legal semester among effective_allowed_semesters, or any
      // known semester if no restriction is set.
      legalSems = sems.filter(s => (allowed ? allowed.includes(s.semester_id) : true));
    }

    if (!legalSems.length) {
      // 4. No legal semester exists — blocking reason, reported via `unplaceable`.
      unplaceable.push({ course_id: course.course_id, name_he: course.name_he });
      continue;
    }

    // 5. Do not skip for overload — prefer a semester that stays within the
    // cap, but place the course regardless if every legal option is full.
    const hrs = info.hours || course.hours || 0;
    let target = legalSems
      .filter(s => hoursOf(s) + hrs <= max)
      .sort((a, b) => hoursOf(a) - hoursOf(b))[0];
    if (!target) target = [...legalSems].sort((a, b) => hoursOf(a) - hoursOf(b))[0];

    target.course_ids.push(course.course_id);
    placed.add(course.course_id);
    added.push({ course_id: course.course_id, semester_id: target.semester_id });
  }

  if (!added.length) return { proposal, added: [], unplaceable };

  return {
    proposal: {
      ...proposal,
      semesters: sems.filter(s => s.course_ids.length > 0 || proposal.semesters.some(ps => ps.semester_id === s.semester_id)),
      warnings_he: [...(proposal.warnings_he || []), 'קורסי חובה שלא היו משובצים בתוכנית הוספו אוטומטית.'],
    },
    added,
    unplaceable,
  };
}

/**
 * PART D — deterministic repair: for every elective category whose
 * requirement is still unmet (and the AI's proposal didn't already cover it),
 * insert the best eligible candidate into the least-loaded legal semester.
 *
 * Pure function — does not mutate `proposal`. Returns the same proposal
 * (by reference) with `added: []` if nothing needed to change.
 */
export function repairAddMissingElectives<P extends RepairProposalShape>(
  proposal: P,
  analysis: CompletionAnalysis,
  opts: {
    courses: Record<string, RepairCourseInfo>;
    maxHoursPerSemester?: number | null;
    unwantedCourseIds?: string[];
    knownSemesterIds: string[];
  },
): RepairAddResult<P> {
  const max = opts.maxHoursPerSemester ?? DEFAULT_MAX_HOURS_PER_SEMESTER;
  const unwanted = new Set(opts.unwantedCourseIds ?? []);
  const sems = proposal.semesters.map(s => ({ ...s, course_ids: [...s.course_ids] }));
  for (const id of opts.knownSemesterIds) {
    if (!sems.some(s => s.semester_id === id)) sems.push({ semester_id: id, course_ids: [] });
  }
  const placed = new Set(sems.flatMap(s => s.course_ids));
  const added: Array<{ course_id: string; category: string; semester_id: string }> = [];
  const extraWarnings: string[] = [];

  const hoursOf = (sem: { course_ids: string[] }) =>
    sem.course_ids.reduce((sum, cid) => sum + (opts.courses[cid]?.hours || 0), 0);

  for (const cat of analysis.categories) {
    const placedFromCategory = cat.candidates.filter(c => placed.has(c.course_id)).length;
    let needed = Math.max(0, cat.missing - placedFromCategory);
    let remainingCandidates = cat.candidates.filter(c => !placed.has(c.course_id));

    while (needed > 0 && remainingCandidates.length > 0) {
      const candidate = pickBestCandidate(remainingCandidates, unwanted);
      if (!candidate) break;
      remainingCandidates = remainingCandidates.filter(c => c.course_id !== candidate.course_id);

      const info = opts.courses[candidate.course_id] || {};
      const allowed = info.effective_allowed_semesters?.length ? info.effective_allowed_semesters : opts.knownSemesterIds;
      const legalSems = sems.filter(s => allowed.includes(s.semester_id));
      if (!legalSems.length) continue;

      // least-loaded legal semester that stays within the cap, if possible
      let target = legalSems
        .filter(s => hoursOf(s) + (info.hours || 0) <= max)
        .sort((a, b) => hoursOf(a) - hoursOf(b))[0];
      if (!target) target = [...legalSems].sort((a, b) => hoursOf(a) - hoursOf(b))[0];

      target.course_ids.push(candidate.course_id);
      placed.add(candidate.course_id);
      added.push({ course_id: candidate.course_id, category: cat.name, semester_id: target.semester_id });
      if (unwanted.has(candidate.course_id)) {
        extraWarnings.push(`נבחר קורס שסומן ל"הימנעות" כדי למלא דרישת תואר חובה ב"${cat.name}" (${candidate.name_he || candidate.course_id}), כיוון שזהו הקורס החוקי היחיד שנותר.`);
      }
      needed--;
    }
  }

  if (!added.length) return { proposal, added: [] };

  return {
    proposal: {
      ...proposal,
      semesters: sems.filter(s => s.course_ids.length > 0 || proposal.semesters.some(ps => ps.semester_id === s.semester_id)),
      warnings_he: [...(proposal.warnings_he || []), 'נוספו קורסי בחירה אוטומטית כדי להשלים דרישות תואר.', ...extraWarnings],
    },
    added,
  };
}

/** PART C — one rejected candidate + why it couldn't be used to fill remaining hours. */
export interface RepairHoursRejection {
  course_id: string;
  reason: 'already_scheduled' | 'completed' | 'no_legal_semester' | 'not_countable_toward_degree';
}

/** PART C — debug/reporting for repairAddHoursToDegree. */
export interface RepairHoursDebug {
  remaining_hours_needed: number;
  candidates_before_filter: number;
  candidates_after_filter: number;
  rejected: RepairHoursRejection[];
  chosen: Array<{ course_id: string; hours: number; semester_id: string }>;
  candidates_still_available: number;
}

export interface RepairHoursResult<P extends RepairProposalShape> {
  proposal: P;
  added: Array<{ course_id: string; semester_id: string; hours: number }>;
  proposed_total_hours: number;
  /** True if total < required and the elective pool was exhausted with no legal placement left. */
  exhausted: boolean;
  /** True if the addition cap (MAX_ADDED_ELECTIVES_FOR_HOURS / unknown-prior-hours default) was hit before reaching the target. */
  capped: boolean;
  /** PART C — debug/reporting: pool sizes, rejection reasons, and what remains. */
  debug: RepairHoursDebug;
}

/**
 * PART B — after mandatory courses and required categories are filled, keep
 * inserting eligible elective/specialization courses (from
 * `analysis.elective_pool`, which spans ALL categories, not just the four
 * required ones) into the least-loaded legal semester until the proposal
 * reaches `DEGREE_REQUIRED_HOURS` total known hours, or until no legal
 * candidate remains (`exhausted: true`).
 *
 * Pure function — does not mutate `proposal`.
 */
export function repairAddHoursToDegree<P extends RepairProposalShape>(
  proposal: P,
  analysis: CompletionAnalysis,
  opts: {
    courses: Record<string, RepairCourseInfo>;
    maxHoursPerSemester?: number | null;
    unwantedCourseIds?: string[];
    knownSemesterIds: string[];
  },
): RepairHoursResult<P> {
  const max = opts.maxHoursPerSemester ?? DEFAULT_MAX_HOURS_PER_SEMESTER;
  const unwanted = new Set(opts.unwantedCourseIds ?? []);
  const sems = proposal.semesters.map(s => ({ ...s, course_ids: [...s.course_ids] }));
  for (const id of opts.knownSemesterIds) {
    if (!sems.some(s => s.semester_id === id)) sems.push({ semester_id: id, course_ids: [] });
  }
  const placed = new Set(sems.flatMap(s => s.course_ids));
  const added: Array<{ course_id: string; semester_id: string; hours: number }> = [];

  const hoursOf = (sem: { course_ids: string[] }) =>
    sem.course_ids.reduce((sum, cid) => sum + (opts.courses[cid]?.hours || 0), 0);

  let addedHours = 0;
  for (const cid of placed) {
    if (analysis.scheduled_course_ids.includes(cid)) continue;
    const h = opts.courses[cid]?.hours;
    if (typeof h === 'number') addedHours += h;
  }
  let total = analysis.hours.known_total_hours + addedHours;

  // PART D/G — the part of the shortfall that may legally be filled by
  // technical electives excludes the general/humanities shortfall, and the
  // target is the program-specific required_total (not a hard-coded 185).
  const generalShortfall = analysis.hours.general_hours_shortfall ?? 0;
  const target = analysis.hours.required_total - generalShortfall;
  const priorKnown = analysis.hours.prior_hours_known !== false;
  const maxAdditions = priorKnown ? MAX_ADDED_ELECTIVES_FOR_HOURS : DEFAULT_ADDED_ELECTIVES_WHEN_PRIOR_HOURS_UNKNOWN;

  // PART A — the candidate pool for remaining hours spans ALL of
  // analysis.elective_pool, including courses from categories that are
  // already satisfied (cat.missing === 0). The only filters here are: not
  // already placed, not already scheduled/completed (elective_pool already
  // excludes scheduled/completed candidates), and — per-candidate during the
  // loop — legal semester / countable hours.
  const candidates_before_filter = (analysis.elective_pool ?? []).length;
  let pool = (analysis.elective_pool ?? []).filter(c => !placed.has(c.course_id));
  const candidates_after_filter = pool.length;
  const rejected: RepairHoursRejection[] = [];
  for (const c of (analysis.elective_pool ?? [])) {
    if (placed.has(c.course_id)) {
      rejected.push({ course_id: c.course_id, reason: analysis.scheduled_course_ids.includes(c.course_id) ? 'already_scheduled' : 'already_scheduled' });
    }
  }
  for (const cid of analysis.completed_course_ids ?? []) {
    if ((analysis.elective_pool ?? []).some(c => c.course_id === cid) && !placed.has(cid)) {
      rejected.push({ course_id: cid, reason: 'completed' });
    }
  }

  let exhausted = false;
  let capped = false;

  while (pool.length > 0 && added.length < maxAdditions) {
    if (priorKnown && total >= target) break;
    const candidate = pickBestCandidate(pool, unwanted);
    if (!candidate) { exhausted = true; break; }
    pool = pool.filter(c => c.course_id !== candidate.course_id);

    const info = opts.courses[candidate.course_id] || {};
    const allowed = info.effective_allowed_semesters?.length ? info.effective_allowed_semesters : opts.knownSemesterIds;
    const legalSems = sems.filter(s => allowed.includes(s.semester_id));
    if (!legalSems.length) {
      rejected.push({ course_id: candidate.course_id, reason: 'no_legal_semester' });
      continue;
    }

    let semTarget = legalSems
      .filter(s => hoursOf(s) + (info.hours || 0) <= max)
      .sort((a, b) => hoursOf(a) - hoursOf(b))[0];
    if (!semTarget) semTarget = [...legalSems].sort((a, b) => hoursOf(a) - hoursOf(b))[0];

    semTarget.course_ids.push(candidate.course_id);
    placed.add(candidate.course_id);
    const h = info.hours ?? candidate.hours ?? 0;
    total += h;
    added.push({ course_id: candidate.course_id, semester_id: semTarget.semester_id, hours: h });
  }

  if (priorKnown && total < target && pool.length === 0) exhausted = true;
  if (priorKnown && total < target && added.length >= maxAdditions && pool.length > 0) capped = true;

  const debug: RepairHoursDebug = {
    remaining_hours_needed: Math.max(0, target - (analysis.hours.known_total_hours + addedHours)),
    candidates_before_filter,
    candidates_after_filter,
    rejected,
    chosen: added.map(a => ({ course_id: a.course_id, hours: a.hours, semester_id: a.semester_id })),
    candidates_still_available: pool.length,
  };

  if (!added.length) return { proposal, added: [], proposed_total_hours: total, exhausted, capped, debug };

  const warnings = [...(proposal.warnings_he || []), 'נוספו קורסי בחירה/התמחות נוספים כדי להשלים את שעות התואר.'];
  if (capped) {
    warnings.push('המערכת ניסתה להוסיף יותר מדי קורסים. כנראה חסר מידע על שעות שכבר צברת.');
  }

  return {
    proposal: {
      ...proposal,
      semesters: sems.filter(s => s.course_ids.length > 0 || proposal.semesters.some(ps => ps.semester_id === s.semester_id)),
      warnings_he: warnings,
    },
    added,
    proposed_total_hours: total,
    debug,
    exhausted,
    capped,
  };
}

export interface RepairGeneralResult<P extends RepairProposalShape> {
  proposal: P;
  added: Array<{ course_id: string; semester_id: string; hours: number }>;
  /** True if the requirement could not be fully filled because the candidate pool ran out. */
  exhausted: boolean;
}

/**
 * שער רוח repair — fills the program's general/humanities credit requirement
 * (analysis.general_requirement) from its own candidate pool, completely
 * separate from engineering elective categories. Must run BEFORE
 * repairAddHoursToDegree so its added hours count toward the 185 total via
 * the normal addedHours computation there.
 *
 * Pure function — does not mutate `proposal`.
 */
export function repairAddGeneralCourses<P extends RepairProposalShape>(
  proposal: P,
  analysis: CompletionAnalysis,
  opts: {
    courses: Record<string, RepairCourseInfo>;
    maxHoursPerSemester?: number | null;
    knownSemesterIds: string[];
  },
): RepairGeneralResult<P> {
  const gr = analysis.general_requirement;
  if (!gr) return { proposal, added: [], exhausted: false };

  const max = opts.maxHoursPerSemester ?? DEFAULT_MAX_HOURS_PER_SEMESTER;
  const sems = proposal.semesters.map(s => ({ ...s, course_ids: [...s.course_ids] }));
  for (const id of opts.knownSemesterIds) {
    if (!sems.some(s => s.semester_id === id)) sems.push({ semester_id: id, course_ids: [] });
  }
  const placed = new Set(sems.flatMap(s => s.course_ids));
  const added: Array<{ course_id: string; semester_id: string; hours: number }> = [];

  const hoursOf = (sem: { course_ids: string[] }) =>
    sem.course_ids.reduce((sum, cid) => sum + (opts.courses[cid]?.hours || 0), 0);

  let totalCredits = gr.placed + (analysis.hours.completed_general_hours ?? 0);
  for (const c of gr.candidates) {
    if (placed.has(c.course_id) && typeof c.hours === 'number') totalCredits += c.hours;
  }
  const target = gr.required;

  let pool = gr.candidates.filter(c => !placed.has(c.course_id));
  let exhausted = false;

  while (totalCredits < target) {
    const candidate = pickBestCandidate(pool);
    if (!candidate) { exhausted = true; break; }
    pool = pool.filter(c => c.course_id !== candidate.course_id);

    const info = opts.courses[candidate.course_id] || {};
    const allowed = info.effective_allowed_semesters?.length ? info.effective_allowed_semesters : opts.knownSemesterIds;
    const legalSems = sems.filter(s => allowed.includes(s.semester_id));
    if (!legalSems.length) continue;

    let semTarget = legalSems
      .filter(s => hoursOf(s) + (info.hours || 0) <= max)
      .sort((a, b) => hoursOf(a) - hoursOf(b))[0];
    if (!semTarget) semTarget = [...legalSems].sort((a, b) => hoursOf(a) - hoursOf(b))[0];

    semTarget.course_ids.push(candidate.course_id);
    placed.add(candidate.course_id);
    const h = info.hours ?? candidate.hours ?? 0;
    totalCredits += h;
    added.push({ course_id: candidate.course_id, semester_id: semTarget.semester_id, hours: h });
  }

  if (!added.length) return { proposal, added: [], exhausted };

  return {
    proposal: {
      ...proposal,
      semesters: sems.filter(s => s.course_ids.length > 0 || proposal.semesters.some(ps => ps.semester_id === s.semester_id)),
      warnings_he: [...(proposal.warnings_he || []), 'נוספו קורסי שער רוח כדי להשלים את דרישת התואר.'],
    },
    added,
    exhausted,
  };
}

export interface HoursStatus {
  proposed_total_hours: number;
  required_total: number;
  remaining: number;
  unknown_hour_courses: number;
  added_elective_hours: number;
  /** Hours already completed toward the degree (PART F). */
  completed_hours: number;
  /** False if the user never entered prior completed-degree hours (PART F). */
  prior_hours_known: boolean;
}

/** PART C/F — compact "שעות בתוכנית: X/185" status for the preview. */
export function getHoursStatusReport(
  analysis: CompletionAnalysis,
  proposalSemesters: Array<{ semester_id: string; course_ids: string[] }>,
  courseHours: Record<string, number | null | undefined> = {},
): HoursStatus {
  const placed = new Set(proposalSemesters.flatMap(s => s.course_ids));
  let added_elective_hours = 0;
  for (const cid of placed) {
    if (analysis.scheduled_course_ids.includes(cid)) continue;
    const h = courseHours[cid];
    if (typeof h === 'number') added_elective_hours += h;
  }
  const proposed_total_hours = analysis.hours.known_total_hours + added_elective_hours;
  return {
    proposed_total_hours,
    required_total: analysis.hours.required_total,
    remaining: Math.max(0, analysis.hours.required_total - proposed_total_hours),
    unknown_hour_courses: analysis.hours.unknown_hour_courses,
    added_elective_hours,
    completed_hours: analysis.hours.known_completed_hours,
    prior_hours_known: analysis.hours.prior_hours_known !== false,
  };
}

export interface LoadBalanceCourseInfo {
  hours?: number | null;
  effective_allowed_semesters?: string[] | null;
  placement_policy?: string | null;
  course_type?: string | null;
}

export interface LoadBalanceContext {
  courses: Record<string, LoadBalanceCourseInfo>;
  maxHoursPerSemester: number | null | undefined;
  pinnedCourseIds?: Set<string>;
  completedCourseIds?: Set<string>;
}

export interface OverloadedSemesterReport {
  semester_id: string;
  hours: number;
  movable: string[];
  not_movable: string[];
}

export interface RepairLoadResult<P extends RepairProposalShape> {
  proposal: P;
  repaired: boolean;
  unmovedOverloaded: OverloadedSemesterReport[];
}

/** Is this course movable for load-balancing — never fixed/pinned/completed. */
export function isMovableForBalance(cid: string, info: LoadBalanceCourseInfo | undefined, ctx: LoadBalanceContext): boolean {
  if (!info) return false;
  if (info.placement_policy === 'fixed') return false;
  if (ctx.pinnedCourseIds?.has(cid)) return false;
  if (ctx.completedCourseIds?.has(cid)) return false;
  return true;
}

/** True electives (by course_type or placement_policy) — moved first when balancing. */
export function isElectiveLike(info: LoadBalanceCourseInfo | undefined): boolean {
  return info?.course_type === 'elective' || info?.placement_policy === 'elective';
}

/** Flexible mandatory courses — moved only after electives are exhausted. */
export function isFlexibleMandatory(info: LoadBalanceCourseInfo | undefined): boolean {
  return !isElectiveLike(info) && info?.placement_policy === 'flexible';
}

/** Sort tier for balancing: 0 = elective, 1 = flexible mandatory, 2 = everything else movable. */
function _balanceTier(info: LoadBalanceCourseInfo | undefined): number {
  if (isElectiveLike(info)) return 0;
  if (isFlexibleMandatory(info)) return 1;
  return 2;
}

/**
 * PART A — load-balancing repair. Greedily moves courses out of overloaded
 * semesters into the least-loaded legal semester, preferring electives
 * first (most flexible), then other movable courses. Stops when no semester
 * exceeds `max` or no legal move remains. Mirrored client-side in
 * app/web/semester_board_viewer.html (repairPlanLoad), kept in sync manually.
 */
export function repairPlanLoad<P extends RepairProposalShape>(proposal: P, ctx: LoadBalanceContext): RepairLoadResult<P> {
  const max = ctx.maxHoursPerSemester;
  if (max == null) return { proposal, repaired: false, unmovedOverloaded: [] };

  const sems = proposal.semesters.map(s => ({ ...s, course_ids: [...s.course_ids] }));
  const allSemIds = sems.map(s => s.semester_id);
  const hoursOf = (sem: { course_ids: string[] }) =>
    sem.course_ids.reduce((sum, cid) => sum + (ctx.courses[cid]?.hours || 0), 0);

  let repaired = false;
  let guard = 0;
  while (guard++ < 50) {
    const hours = sems.map(hoursOf);
    const overIdx = hours.findIndex(h => h > max);
    if (overIdx === -1) break;

    const sem = sems[overIdx];

    const candidates = sem.course_ids
      .map(cid => ({ cid, info: ctx.courses[cid] }))
      .filter(({ cid, info }) => isMovableForBalance(cid, info, ctx))
      .sort((a, b) => (isElectiveLike(a.info) === isElectiveLike(b.info)) ? 0 : (isElectiveLike(a.info) ? -1 : 1));

    let moved = false;
    for (const { cid, info } of candidates) {
      const ch = info?.hours || 0;
      const allowed = info?.effective_allowed_semesters?.length
        ? info.effective_allowed_semesters
        : (isElectiveLike(info) ? allSemIds : null);
      if (!allowed) continue;

      const legalIdx = sems
        .map((_, j) => j)
        .filter(j => j !== overIdx && allowed.includes(sems[j].semester_id));
      if (!legalIdx.length) continue;

      const fitting = legalIdx.filter(j => max - hoursOf(sems[j]) >= ch);
      const pool = fitting.length ? fitting : legalIdx;
      const bestJ = pool.sort((a, b) => hoursOf(sems[a]) - hoursOf(sems[b]))[0];

      const k = sem.course_ids.indexOf(cid);
      sem.course_ids.splice(k, 1);
      sems[bestJ].course_ids.push(cid);
      moved = true;
      repaired = true;
      break;
    }
    if (!moved) break;
  }

  const unmovedOverloaded: OverloadedSemesterReport[] = sems
    .map(sem => ({ sem, hours: hoursOf(sem) }))
    .filter(({ hours }) => hours > max)
    .map(({ sem, hours }) => {
      const movable: string[] = [];
      const notMovable: string[] = [];
      for (const cid of sem.course_ids) {
        (isMovableForBalance(cid, ctx.courses[cid], ctx) ? movable : notMovable).push(cid);
      }
      return { semester_id: sem.semester_id, hours, movable, not_movable: notMovable };
    });

  if (!repaired) return { proposal, repaired: false, unmovedOverloaded };
  return { proposal: { ...proposal, semesters: sems }, repaired: true, unmovedOverloaded };
}
