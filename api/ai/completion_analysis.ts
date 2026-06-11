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

  // 2. unmet elective categories with available candidates
  for (const cat of analysis.categories) {
    const placedFromCategory = cat.candidates.filter(c => placed.has(c.course_id)).length + (cat.placed - cat.candidates.length > 0 ? 0 : 0);
    const stillMissing = Math.max(0, cat.missing - cat.candidates.filter(c => placed.has(c.course_id)).length);
    if (stillMissing > 0 && cat.candidates.some(c => !placed.has(c.course_id))) {
      const msg = stillMissing === 1
        ? `חסר קורס אחד מקורסי הקטגוריה "${cat.name}".`
        : `חסרים ${stillMissing} קורסים מקטגוריית "${cat.name}".`;
      reasons.push(msg);
      blocking.push(msg);
    } else if (stillMissing > 0) {
      // Category still unmet, but no eligible candidates exist — informational only.
      reasons.push(`אין קורס מועמד זמין בקטגוריה "${cat.name}".`);
    } else if (cat.missing > 0 && placedFromCategory >= cat.missing) {
      reasons.push(`הדרישה הושלמה: קטגוריית "${cat.name}".`);
    }
  }

  // 3. remaining degree hours, with electives added on top of the live board
  let addedHours = 0;
  for (const cid of placed) {
    if (analysis.scheduled_course_ids.includes(cid)) continue; // already on the live board
    const h = opts.courseHours?.[cid];
    if (typeof h === 'number') addedHours += h;
  }
  const remainingAfter = Math.max(0, analysis.hours.remaining_hours - addedHours);
  if (remainingAfter > SEVERE_OVERLOAD_MARGIN * 2 && addedHours === 0 && analysis.hours.remaining_hours > 0) {
    const msg = `חסרות כ-${remainingAfter} שעות מתוך ${analysis.hours.required_total} ש"ש להשלמת התואר, ולא נוספו קורסי בחירה.`;
    reasons.push(msg);
    blocking.push(msg);
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

  return { incomplete: blocking.length > 0, reasons, added_electives };
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
      needed--;
    }
  }

  if (!added.length) return { proposal, added: [] };

  return {
    proposal: {
      ...proposal,
      semesters: sems.filter(s => s.course_ids.length > 0 || proposal.semesters.some(ps => ps.semester_id === s.semester_id)),
      warnings_he: [...(proposal.warnings_he || []), 'נוספו קורסי בחירה אוטומטית כדי להשלים דרישות תואר.'],
    },
    added,
  };
}
