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
}

export interface CompletionAnalysis {
  completed_course_ids: string[];
  scheduled_course_ids: string[];
  missing_mandatory: Array<{ course_id: string; name_he?: string; hours?: number }>;
  categories: CompletionCategory[];
  /** Union of all category candidates (incl. already-satisfied categories), deduped — used to fill remaining degree hours (PART D). */
  elective_pool: CompletionCandidate[];
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

  // ── Elective pool for filling remaining degree hours (PART D) ────────────
  const electivePoolMap = new Map<string, CompletionCandidate>();
  for (const cat of categories) {
    for (const c of cat.candidates) {
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

  const completedHoursCtx = (ctx as any).total_hours_progress?.known_completed_hours;
  const known_completed_hours = typeof completedHoursCtx === 'number' ? completedHoursCtx : 0;
  const unknown_completed = (ctx.personal_status?.completed ?? [])
    .filter((c: any) => c.hours == null).length;

  const known_total_hours = known_completed_hours + known_scheduled_hours;
  const unknown_hour_courses = unknown_scheduled + unknown_completed;
  const remaining_hours = Math.max(0, DEGREE_REQUIRED_HOURS - known_total_hours);

  const hours: CompletionHours = {
    required_total:        DEGREE_REQUIRED_HOURS,
    known_completed_hours,
    known_scheduled_hours,
    known_total_hours,
    remaining_hours,
    unknown_hour_courses,
    approximate: unknown_hour_courses > 0,
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
  if (hoursShort > 0) {
    const remainingCandidates = (analysis.elective_pool ?? []).filter(c => !placed.has(c.course_id));
    if (remainingCandidates.length > 0) {
      const msg = `חסרות כ-${hoursShort} ש"ש מתוך ${DEGREE_REQUIRED_HOURS} ש"ש להשלמת התואר.`;
      reasons.push(msg);
      blocking.push(msg);
    } else {
      reasons.push(`חסרות כ-${hoursShort} ש"ש מתוך ${DEGREE_REQUIRED_HOURS} ש"ש, ולא נמצאו קורסי בחירה חוקיים נוספים להשלמתן.`);
    }
  }

  // 4. severe overload remains and movable courses exist
  for (const sem of proposalSemesters) {
    const hrs = sem.course_ids.reduce((s, cid) => s + (opts.courseHours?.[cid] || 0), 0);
    if (hrs > DEFAULT_MAX_HOURS_PER_SEMESTER + SEVERE_OVERLOAD_MARGIN) {
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

export interface RepairHoursResult<P extends RepairProposalShape> {
  proposal: P;
  added: Array<{ course_id: string; semester_id: string; hours: number }>;
  proposed_total_hours: number;
  /** True if total < 185 and the elective pool was exhausted with no legal placement left. */
  exhausted: boolean;
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

  let pool = (analysis.elective_pool ?? []).filter(c => !placed.has(c.course_id));
  let exhausted = false;

  while (total < DEGREE_REQUIRED_HOURS && pool.length > 0) {
    const candidate = pickBestCandidate(pool, unwanted);
    if (!candidate) { exhausted = true; break; }
    pool = pool.filter(c => c.course_id !== candidate.course_id);

    const info = opts.courses[candidate.course_id] || {};
    const allowed = info.effective_allowed_semesters?.length ? info.effective_allowed_semesters : opts.knownSemesterIds;
    const legalSems = sems.filter(s => allowed.includes(s.semester_id));
    if (!legalSems.length) continue;

    let target = legalSems
      .filter(s => hoursOf(s) + (info.hours || 0) <= max)
      .sort((a, b) => hoursOf(a) - hoursOf(b))[0];
    if (!target) target = [...legalSems].sort((a, b) => hoursOf(a) - hoursOf(b))[0];

    target.course_ids.push(candidate.course_id);
    placed.add(candidate.course_id);
    const h = info.hours ?? candidate.hours ?? 0;
    total += h;
    added.push({ course_id: candidate.course_id, semester_id: target.semester_id, hours: h });
  }

  if (total < DEGREE_REQUIRED_HOURS && pool.length === 0) exhausted = true;

  if (!added.length) return { proposal, added: [], proposed_total_hours: total, exhausted };

  return {
    proposal: {
      ...proposal,
      semesters: sems.filter(s => s.course_ids.length > 0 || proposal.semesters.some(ps => ps.semester_id === s.semester_id)),
      warnings_he: [...(proposal.warnings_he || []), 'נוספו קורסי בחירה/התמחות נוספים כדי להגיע ל-185 ש"ש.'],
    },
    added,
    proposed_total_hours: total,
    exhausted,
  };
}

export interface HoursStatus {
  proposed_total_hours: number;
  required_total: number;
  remaining: number;
  unknown_hour_courses: number;
  added_elective_hours: number;
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
    required_total: DEGREE_REQUIRED_HOURS,
    remaining: Math.max(0, DEGREE_REQUIRED_HOURS - proposed_total_hours),
    unknown_hour_courses: analysis.hours.unknown_hour_courses,
    added_elective_hours,
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
