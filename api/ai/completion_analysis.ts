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

/** Fallback per-semester hour cap used when the user hasn't set one — matches
 *  the board's semester-card display cap so the same number is shown
 *  everywhere (board header, AI preferences, validation, preview). */
export const DEFAULT_MAX_HOURS_PER_SEMESTER = 20;

/** How far over the cap counts as "severe" overload (blocking if movable courses exist). */
export const SEVERE_OVERLOAD_MARGIN = 3;

/**
 * PART A — single source of truth for the effective per-semester hour cap:
 * the user's explicit AI-planner preference if set, otherwise the board
 * default. Used by the board header, AI planner preferences, generate-plan
 * request body, repairPlanLoad, validation/applyability, preview top status
 * and warning messages — never a stale/separate default.
 */
export function getEffectiveMaxHoursPreference(maxWeeklyHoursPreference?: number | null): number {
  return (maxWeeklyHoursPreference != null && maxWeeklyHoursPreference > 0)
    ? maxWeeklyHoursPreference
    : DEFAULT_MAX_HOURS_PER_SEMESTER;
}

/** Hard cap on how many electives repairAddHoursToDegree may add (PART E). */
export const MAX_ADDED_ELECTIVES_FOR_HOURS = 12;

/** When prior completed-degree hours are unknown, add at most this many extra electives beyond required categories (PART G). */
export const DEFAULT_ADDED_ELECTIVES_WHEN_PRIOR_HOURS_UNKNOWN = 6;

/** Any semester above this weekly load is considered an unreasonable plan (PART E). */
export const MAX_REASONABLE_SEMESTER_HOURS = 30;

// ── Professional/career relevance scoring ───────────────────────────────────
//
// Tags a candidate course against career-direction groups based on keyword
// matching of its name/syllabus text vs. the user's free-text request
// (`extra_request_he`). A group is "active" if the user's text mentions any
// of its trigger keywords; an active group then boosts any candidate whose
// own text matches the same keyword set, and supplies the Hebrew reason
// shown in the preview (PART B).
export interface CareerRelevanceGroup {
  tag: string;
  reason: string;
  keywords: string[];
}

export const CAREER_RELEVANCE_GROUPS: CareerRelevanceGroup[] = [
  {
    tag: 'fem_analysis',
    reason: 'נבחר כי הוא רלוונטי לאנליזות/FEM/תורת התנודות',
    keywords: [
      'אלמנטים סופיים', 'fem', 'אנליז', 'סימול', 'cae', 'חוזק', 'חומרים',
      'מכניקת המוצקים', 'מכניקת מוצקים', 'מכניקה', 'תנודות', 'רעידות', 'דינמיקה',
    ],
  },
  {
    tag: 'mechanical_design',
    reason: 'נבחר כי הוא מחזק תכן מכני/הנדסי ופיתוח מוצר',
    keywords: ['תכן', 'עיצוב', 'פיתוח מוצר', 'ייצור', 'מוצר', 'הנדסי'],
  },
  {
    tag: 'robotics_control',
    reason: 'נבחר כי הוא קשור לרובוטיקה',
    keywords: ['רובוטיקה', 'מכטרוניקה', 'מערכות מכניות', 'אוטומציה'],
  },
  {
    tag: 'industry_lab',
    reason: 'נבחר כי הוא נותן ניסיון מעבדתי/פרויקטלי רלוונטי לתעשייה (סימולציות/תכן/אנליזה)',
    keywords: ['מעבדה', 'פרויקט'],
  },
];

/**
 * PART D — "בקרה" (control) is treated separately from רובוטיקה: the user's
 * profile said "קצת רובוטיקה, not necessarily control" — so robotics courses
 * match the robotics_control group above, but a course that is primarily
 * about בקרה (control theory/systems) is penalized unless the user
 * explicitly asked for control.
 */
export const CONTROL_HEAVY_KEYWORDS = ['בקרה', 'מערכות בקרה', 'תורת הבקרה'];
export const CONTROL_INTEREST_KEYWORDS = ['בקרה', 'control'];

/**
 * Keywords for courses that are usually weakly related to a mechanical
 * design/analysis/robotics direction. These are penalized whenever the
 * user's free-text interest does not explicitly mention them, regardless of
 * whether other interest groups are active (PART D).
 */
export const WEAK_RELEVANCE_KEYWORDS = [
  'מבני נתונים', 'מיקרו אלקטרוניקה', 'ננו אלקטרוניקה', 'מיקרו וננו', 'אלקטרוניקה',
  'מערכות לבישות', 'לביש', 'מדעי המחשב', 'אלגוריתמים',
];

/**
 * PART D — biomedical/biology/medicine-related keywords are always
 * penalized unless the user's free-text request explicitly mentions them
 * (ביורפואה, רפואה, ביולוגיה, פולימרים בהקשר רפואי, וכו').
 */
export const BIOMEDICAL_KEYWORDS = [
  'ביורפואה', 'ביורפואי', 'רפואי', 'רפואה', 'ביולוגי', 'ביולוגיה',
  'תאים', 'רקמות', 'קליני', 'medical', 'biomedical', 'biology',
];
export const BIOMEDICAL_INTEREST_KEYWORDS = ['ביורפואה', 'ביורפואי', 'רפואי', 'רפואה', 'ביולוגי', 'medical', 'biomedical', 'biology'];

export const DEFAULT_WEAK_RELEVANCE_REASON = 'נבחר בעיקר להשלמת דרישת תואר';

/** PART D — reason attached when a weak-match course is still chosen as a filler. */
export const WEAK_MATCH_FILLER_REASON = 'נבחר בעיקר להשלמת דרישת תואר כי לא נמצאה חלופה רלוונטית יותר.';

export interface CareerRelevanceResult {
  /** Added to the candidate's overall score (positive = boost, negative = penalty). */
  score: number;
  /** Hebrew reason shown to the user for why this course was selected (PART B). */
  reason: string;
  /** The matched relevance group, if any. */
  tag: string | null;
}

/**
 * PART A — score how relevant `candidate` is to the user's stated career
 * direction (`interestText`, e.g. preferences.extra_request_he). Returns 0/
 * neutral if `interestText` is empty — the relevance layer never overrides
 * legal/category requirements, it only ranks among legal candidates.
 */
export function scoreCareerRelevance(
  candidate: { name_he?: string | null; syllabus_summary_he?: string | null; syllabus_topics_he?: string[] | null },
  interestText?: string | null,
): CareerRelevanceResult {
  const text = [
    candidate.name_he || '',
    candidate.syllabus_summary_he || '',
    ...(candidate.syllabus_topics_he || []),
  ].join(' ').toLowerCase();

  const interest = (interestText || '').toLowerCase();

  // PART D — biomedical/biology/medicine courses are always penalized unless
  // explicitly requested, regardless of whether other interest groups match.
  const wantsBiomedical = BIOMEDICAL_INTEREST_KEYWORDS.some(k => interest.includes(k));
  if (!wantsBiomedical && BIOMEDICAL_KEYWORDS.some(k => text.includes(k))) {
    return { score: -3, reason: DEFAULT_WEAK_RELEVANCE_REASON, tag: null };
  }

  // PART D — control-heavy courses are penalized unless the user explicitly
  // asked for control ("not necessarily control" in the user's profile).
  const wantsControl = CONTROL_INTEREST_KEYWORDS.some(k => interest.includes(k));
  if (!wantsControl && CONTROL_HEAVY_KEYWORDS.some(k => text.includes(k))) {
    return { score: -1, reason: DEFAULT_WEAK_RELEVANCE_REASON, tag: null };
  }

  if (!interestText || !interestText.trim()) {
    return { score: 0, reason: DEFAULT_WEAK_RELEVANCE_REASON, tag: null };
  }

  // Active groups = groups the user's free-text request mentions.
  const activeGroups = CAREER_RELEVANCE_GROUPS.filter(g => g.keywords.some(k => interest.includes(k)));
  if (!activeGroups.length) {
    return { score: 0, reason: DEFAULT_WEAK_RELEVANCE_REASON, tag: null };
  }

  for (const g of activeGroups) {
    if (g.keywords.some(k => text.includes(k))) {
      return { score: 3, reason: g.reason, tag: g.tag };
    }
  }

  // No active-direction match — penalize courses that are characteristically
  // unrelated to a mechanical design/analysis/robotics direction.
  if (WEAK_RELEVANCE_KEYWORDS.some(k => text.includes(k))) {
    return { score: -2, reason: WEAK_MATCH_FILLER_REASON, tag: null };
  }

  // PART D — the user has an active interest profile but this course doesn't
  // match any of it: still a weak match, chosen only as filler if needed.
  return { score: 0, reason: WEAK_MATCH_FILLER_REASON, tag: null };
}

export interface CompletionCandidate {
  course_id: string;
  name_he?: string;
  hours?: number | null;
  has_syllabus_summary?: boolean;
  grade_average?: number | null;
  is_wanted?: boolean;
  /** Optional syllabus text used for career-relevance scoring (PART A), when available. */
  syllabus_summary_he?: string | null;
  syllabus_topics_he?: string[] | null;
  /** Semesters this course may legally be placed in (PART A — semester legality). */
  effective_allowed_semesters?: string[] | null;
  /** Raw syllabus/program offering data, if known. */
  offered_semesters?: string[] | null;
  /** Whether effective_allowed_semesters is high-confidence (syllabus-sourced). */
  offering_confident?: boolean;
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
  /**
   * Hours of currently_taking/planned personal-status courses not on the
   * board — prior progress, counted under `currently_planned_before_proposal`
   * in the canonical degree-progress model. Excluded from known_completed_hours
   * to avoid double counting (Phase 1 unification).
   */
  currently_planned_hours: number;
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
        effective_allowed_semesters: c.effective_allowed_semesters ?? null,
        offered_semesters:    c.offered_semesters ?? null,
        offering_confident:   c.offering_confident ?? false,
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
  // Manual completed total handling (Phase 1): when a manual total exists it is
  // used ONLY as the completed_before_proposal baseline (status-derived
  // completed-course hours are not added on top, to avoid double counting).
  // currently_planned_before_proposal and proposed_added are still computed and
  // added on top — they are NOT dropped.
  const known_completed_hours = prior_hours_known ? manualCompleted : completedHoursFromStatuses;
  // currently_taking/planned off-board hours are prior progress tracked
  // separately from completed (canonical currently_planned_before_proposal).
  const currently_planned_hours = typeof totalHoursProgress?.currently_planned_hours === 'number'
    ? totalHoursProgress.currently_planned_hours : 0;
  const unknown_completed = (ctx.personal_status?.completed ?? [])
    .filter((c: any) => c.hours == null).length;

  const known_total_hours = known_completed_hours + currently_planned_hours + known_scheduled_hours;
  const unknown_hour_courses = unknown_scheduled + unknown_completed;
  const remaining_hours = Math.max(0, required_total - known_total_hours);

  const hours: CompletionHours = {
    required_total,
    known_completed_hours,
    known_scheduled_hours,
    currently_planned_hours,
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
/**
 * PART A — render a candidate label with an explicit semester restriction so
 * the AI never proposes placing a course in a semester it isn't offered in
 * (e.g. "מבוא לאלמנטים סופיים (0542-4223) [רק סמסטר א׳]").
 */
function candidateLabelWithSemesters(c: CompletionCandidate): string {
  const base = `${c.name_he || c.course_id} (${c.course_id})`;
  const allowed = c.effective_allowed_semesters;
  if (allowed && allowed.length === 1) {
    const semLabel = allowed[0] === 'A' ? 'סמסטר א׳' : allowed[0] === 'B' ? 'סמסטר ב׳' : allowed[0];
    return `${base} [רק ${semLabel}${c.offering_confident ? '' : ' — לא מאומת'}]`;
  }
  if (allowed && allowed.length > 1) {
    return `${base} [סמסטרים: ${allowed.join(', ')}]`;
  }
  return base;
}

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
      const cands = cat.candidates.slice(0, 6).map(c => candidateLabelWithSemesters(c)).join(', ');
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

export interface DegreeHoursStatus {
  completed_degree_hours: number;
  proposed_plan_hours: number;
  total_after_plan: number;
  degree_required_hours: number;
  missing_hours: number;
  satisfied: boolean;
}

/**
 * PART B — single source of truth for the 185-ש"ש degree-hour requirement.
 * All validation/preview/applyability checks must use this instead of any
 * separate "remaining points/hours" bucket.
 */
export function getDegreeHoursStatus(
  analysis: CompletionAnalysis,
  proposalSemesters: Array<{ course_ids: string[] }>,
  courseHours: Record<string, number | null | undefined>,
): DegreeHoursStatus {
  const placed = new Set((proposalSemesters || []).flatMap(s => s.course_ids || []));
  let proposed_plan_hours = 0;
  for (const cid of placed) {
    if (analysis.scheduled_course_ids.includes(cid)) continue;
    const h = courseHours[cid];
    if (typeof h === 'number') proposed_plan_hours += h;
  }
  const completed_degree_hours = analysis.hours.known_total_hours;
  const total_after_plan = completed_degree_hours + proposed_plan_hours;
  const degree_required_hours = analysis.hours.required_total;
  const missing_hours = Math.max(0, degree_required_hours - total_after_plan);
  return {
    completed_degree_hours,
    proposed_plan_hours,
    total_after_plan,
    degree_required_hours,
    missing_hours,
    satisfied: total_after_plan >= degree_required_hours,
  };
}

export interface DegreeProgress {
  required: number;
  // ── Canonical six-field model (Phase 1 unification) ──────────────────────
  completed_before_proposal: number;
  current_board: number;
  currently_planned_before_proposal: number;
  proposed_added: number;
  total_after_proposal: number;
  remaining_to_degree: number;
  // ── Backward-compatible aliases (existing consumers read these names) ────
  /** @deprecated alias of completed_before_proposal */
  completed: number;
  /** @deprecated alias of currently_planned_before_proposal */
  currently_planned: number;
  /** @deprecated alias of total_after_proposal */
  total_after: number;
  /** @deprecated alias of remaining_to_degree */
  remaining: number;
  overshoot: number;
  unknown_hours_count: number;
  warnings: string[];
}

/**
 * PART C — single source of truth for degree-hour progress (TS mirror of
 * computeDegreeProgress in app/web/semester_board_viewer.html). Used by
 * both the status-chip render and the draft-summary render so all UI
 * surfaces show the same numbers.
 *
 * `analysis.hours.known_completed_hours` already represents `completed`
 * (manual total if known, else status-derived completed-course hours —
 * computed without double counting in buildCompletionAnalysis).
 * `analysis.hours.known_scheduled_hours` represents `current_board` (hours
 * of courses currently on the board, from buildCompletionAnalysis).
 */
export function computeDegreeProgress(
  analysis: CompletionAnalysis,
  proposalSemesters: Array<{ course_ids: string[] }> = [],
  courseHours: Record<string, number | null | undefined> = {},
): DegreeProgress {
  const scheduledSet = new Set(analysis.scheduled_course_ids);
  const completedSet = new Set(analysis.completed_course_ids);
  const placed = new Set((proposalSemesters || []).flatMap(s => s.course_ids || []));
  let proposed_added = 0;
  let unknown_hours_count = analysis.hours.unknown_hour_courses || 0;
  for (const cid of placed) {
    // Global dedup: a proposed course counts once, only if it isn't already
    // counted under completed / current_board (currently_planned ids are not
    // tracked here — those off-board hours come from the analysis baseline).
    if (scheduledSet.has(cid)) continue;     // already current_board
    if (completedSet.has(cid)) continue;     // already completed_before_proposal
    const h = courseHours[cid];
    if (typeof h === 'number') proposed_added += h;
    else unknown_hours_count++;
  }

  const required = analysis.hours.required_total;
  const completed_before_proposal = analysis.hours.known_completed_hours;
  const current_board = analysis.hours.known_scheduled_hours;
  const currently_planned_before_proposal = analysis.hours.currently_planned_hours || 0;
  const total_after_proposal =
    completed_before_proposal + current_board + currently_planned_before_proposal + proposed_added;
  const remaining_to_degree = Math.max(0, required - total_after_proposal);
  const overshoot = Math.max(0, total_after_proposal - required);

  const warnings: string[] = [];
  if (unknown_hours_count > 0) {
    warnings.push(`${unknown_hours_count} קורסים ללא שעות ידועות לא נכללו בחישוב`);
  }

  return {
    required,
    completed_before_proposal,
    current_board,
    currently_planned_before_proposal,
    proposed_added,
    total_after_proposal,
    remaining_to_degree,
    // Backward-compatible aliases for existing consumers.
    completed: completed_before_proposal,
    currently_planned: currently_planned_before_proposal,
    total_after: total_after_proposal,
    remaining: remaining_to_degree,
    overshoot, unknown_hours_count, warnings,
  };
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
  /** The highest semester load actually occurring in the proposed plan (not a limit). */
  peakSemHours: number;
  /** PART A/D — the effective cap that was checked for this plan (getEffectiveMaxHoursPreference). */
  effectiveMaxHours: number;
  allCategoriesSatisfied: boolean;
  warningCount: number;
}): string[] {
  const bullets: string[] = [];
  if (opts.addedElectives > 0) {
    bullets.push(opts.addedElectives === 1 ? 'נוסף קורס בחירה אחד' : `נוספו ${opts.addedElectives} קורסי בחירה`);
  }
  if (opts.peakSemHours > 0) {
    bullets.push(`העומס הגבוה ביותר בתוכנית: ${opts.peakSemHours} ש״ש`);
  }
  if (opts.effectiveMaxHours > 0) {
    bullets.push(`המגבלה שנבדקה בתוכנית זו: ${opts.effectiveMaxHours} ש״ש`);
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
    const gr = analysis.general_requirement;
    const before = (gr?.placed ?? 0) + (analysis.hours.completed_general_hours ?? 0);
    const addedGeneralCredits = Math.max(0, (generalStatus.placed ?? 0) - before);
    if (generalStatus.missing > 0) {
      if (generalStatus.candidates.length > 0) {
        // PART E — שער רוח is its own shortfall, never the generic "חסרות X ש"ש להשלמת התואר" message.
        const msg = `יש להשלים עוד ${generalStatus.missing} נק"ז שער רוח, אך לא נמצאו קורסי שער רוח חוקיים נוספים לשיבוץ.`;
        reasons.push(msg);
        blocking.push(msg);
      } else {
        reasons.push(`קורסי שער רוח: שובצו ${generalStatus.placed}/${generalStatus.required} נק"ז, חסרות ${generalStatus.missing} נק"ז — מאגר קורסי שער רוח אינו זמין, יש להשלים ידנית או להוסיף מאגר קורסים מתאים.`);
      }
    } else if (before < (generalStatus.required ?? 0)) {
      // PART A/E — שער רוח shortfall fully filled by repairAddGeneralCourses.
      const required = generalStatus.required ?? 0;
      if (addedGeneralCredits > 0) {
        reasons.push(`קורסי שער רוח: ${before}/${required} הושלם, נוספו ${addedGeneralCredits} נק"ז — קורסי שער רוח: ${required}/${required} לאחר התוכנית.`);
      } else {
        reasons.push(`קורסי שער רוח: ${required}/${required} לאחר התוכנית.`);
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
    const hrs = getSemesterLoad(sem, Object.fromEntries(Object.entries(opts.courseHours || {}).map(([cid, h]) => [cid, { hours: h }])));
    if (hrs > MAX_REASONABLE_SEMESTER_HOURS) {
      const msg = 'נוצר עומס לא סביר — כנראה חסר מידע על שעות שכבר צברת בתואר.';
      reasons.push(msg);
      blocking.push(msg);
    }
  }

  // 4. severe overload remains and movable courses exist
  for (const sem of proposalSemesters) {
    const hrs = getSemesterLoad(sem, Object.fromEntries(Object.entries(opts.courseHours || {}).map(([cid, h]) => [cid, { hours: h }])));
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

  // PART C — show the exact overloaded semester/load/cap instead of a
  // generic "עומס גבוה מדי" message.
  const overloadReason = completeness.reasons.find(r => r.includes('עמוס'));
  if (overloadReason) {
    return `לא ניתן להחיל — ${overloadReason}`;
  }

  if (completeness.reasons.some(r => r.includes('אל תזיז') || r.includes('נעוץ'))) {
    return 'לא ניתן להחיל — קורס נעוץ הוזז';
  }

  return 'לא ניתן להחיל — יש לתקן שגיאות';
}

/**
 * PART F — parse a stated grade-average target (e.g. "חשוב לי ממוצע ציונים
 * מעל 82" / "ממוצע מעל 85") from the user's free-text request. Returns null
 * if no target is stated.
 */
export function parseGradeTarget(interestText?: string | null): number | null {
  if (!interestText) return null;
  const m = interestText.match(/ממוצע[^\d]{0,15}(\d{2,3})/);
  if (!m) return null;
  const val = parseInt(m[1], 10);
  return Number.isFinite(val) && val >= 60 && val <= 100 ? val : null;
}

/**
 * PART F — score how compatible a candidate's historical grade average is
 * with the user's stated target. Courses with no published average are
 * neutral. When the user cares about a high average, courses with a low
 * historical average are mildly penalized and high-average courses are
 * mildly boosted, so the planner leans toward courses where students
 * historically score well.
 */
export function scoreGradeCompatibility(
  candidate: { grade_average?: number | null },
  interestText?: string | null,
): number {
  const target = parseGradeTarget(interestText);
  if (target == null || candidate.grade_average == null) return 0;
  const diff = candidate.grade_average - target;
  // Scale to a small, bounded contribution (±1.5) so it nudges ranking
  // without overriding career-relevance or legality.
  return Math.max(-1.5, Math.min(1.5, diff / 10));
}

/** Score a candidate elective for repair-insertion (higher = preferred). */
export function scoreCandidate(c: CompletionCandidate, interestText?: string | null): number {
  let score = 0;
  if (c.is_wanted) score += 5;
  if (c.has_syllabus_summary) score += 2;
  if (c.hours != null) score += 1;
  if (c.grade_average != null) score += c.grade_average / 100;
  // PART A/E — career-fit score, ranks among legal candidates only.
  score += scoreCareerRelevance(c, interestText).score;
  // PART F — grade-average target compatibility.
  score += scoreGradeCompatibility(c, interestText);
  return score;
}

/** Pick the best candidate, preferring ones not in `unwantedIds` if alternatives exist. */
export function pickBestCandidate(
  candidates: CompletionCandidate[],
  unwantedIds: Set<string> = new Set(),
  interestText?: string | null,
): CompletionCandidate | null {
  if (!candidates.length) return null;
  const preferred = candidates.filter(c => !unwantedIds.has(c.course_id));
  const pool = preferred.length ? preferred : candidates;
  return [...pool].sort((a, b) => scoreCandidate(b, interestText) - scoreCandidate(a, interestText))[0];
}

/**
 * PART C — pick the candidate that best closes the remaining hours `gap`
 * toward the 185-ש"ש degree total, minimizing overshoot:
 *   exact fit (hours === gap) > smallest overshoot (hours > gap) > largest
 *   undershoot (hours < gap, picks the closest). Among equally-good fits,
 *   falls back to scoreCandidate (career relevance, wanted, etc.).
 * `gap` <= 0 means the degree total is already met — caller should stop
 * adding courses entirely in that case (handled by the loop's `total >= target`
 * check); this function is only consulted while gap > 0.
 */
export function pickBestCandidateForGap(
  candidates: CompletionCandidate[],
  courses: Record<string, RepairCourseInfo>,
  gap: number,
  unwantedIds: Set<string> = new Set(),
  interestText?: string | null,
): CompletionCandidate | null {
  if (!candidates.length) return null;
  const preferred = candidates.filter(c => !unwantedIds.has(c.course_id));
  const pool = preferred.length ? preferred : candidates;

  const fitRank = (c: CompletionCandidate): number => {
    const h = courses[c.course_id]?.hours ?? c.hours ?? 0;
    if (h === gap) return 0;            // exact fit
    if (h > gap) return 1 + (h - gap);  // smallest overshoot wins (rank closest to 0)
    return 1000 + (gap - h);            // undershoot — least preferred, smallest undershoot wins
  };

  return [...pool].sort((a, b) => {
    const fa = fitRank(a);
    const fb = fitRank(b);
    if (fa !== fb) return fa - fb;
    return scoreCandidate(b, interestText) - scoreCandidate(a, interestText);
  })[0];
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
  added: Array<{ course_id: string; category: string; semester_id: string; selection_reason?: string }>;
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
    /** PART A — user's free-text career-direction request (e.g. preferences.extra_request_he). */
    userInterestText?: string | null;
  },
): RepairAddResult<P> {
  const max = opts.maxHoursPerSemester ?? DEFAULT_MAX_HOURS_PER_SEMESTER;
  const unwanted = new Set(opts.unwantedCourseIds ?? []);
  const sems = proposal.semesters.map(s => ({ ...s, course_ids: [...s.course_ids] }));
  for (const id of opts.knownSemesterIds) {
    if (!sems.some(s => s.semester_id === id)) sems.push({ semester_id: id, course_ids: [] });
  }
  const placed = new Set(sems.flatMap(s => s.course_ids));
  const added: Array<{ course_id: string; category: string; semester_id: string; selection_reason?: string }> = [];
  const extraWarnings: string[] = [];

  const hoursOf = (sem: { course_ids: string[] }) =>
    sem.course_ids.reduce((sum, cid) => sum + (opts.courses[cid]?.hours || 0), 0);

  for (const cat of analysis.categories) {
    const placedFromCategory = cat.candidates.filter(c => placed.has(c.course_id)).length;
    let needed = Math.max(0, cat.missing - placedFromCategory);
    let remainingCandidates = cat.candidates.filter(c => !placed.has(c.course_id));

    while (needed > 0 && remainingCandidates.length > 0) {
      const candidate = pickBestCandidate(remainingCandidates, unwanted, opts.userInterestText);
      if (!candidate) break;
      remainingCandidates = remainingCandidates.filter(c => c.course_id !== candidate.course_id);

      const info = opts.courses[candidate.course_id] || {};
      const allowed = info.effective_allowed_semesters?.length ? info.effective_allowed_semesters : opts.knownSemesterIds;
      const legalSems = sems.filter(s => allowed.includes(s.semester_id));
      if (!legalSems.length) continue;

      // least-loaded legal semester that stays within the cap, if possible
      const fitting = legalSems.filter(s => hoursOf(s) + (info.hours || 0) <= max);
      const relevance = scoreCareerRelevance(candidate, opts.userInterestText);
      let target: typeof sems[number] | undefined;
      // PART C — foundational analysis courses (e.g. FEM) are scheduled as
      // early as legally possible so they can unlock later labs/projects,
      // rather than the least-loaded semester.
      if (relevance.tag === 'fem_analysis' && fitting.length) {
        target = [...fitting].sort((a, b) => opts.knownSemesterIds.indexOf(a.semester_id) - opts.knownSemesterIds.indexOf(b.semester_id))[0];
      } else if (fitting.length) {
        target = [...fitting].sort((a, b) => hoursOf(a) - hoursOf(b))[0];
      }
      if (!target) target = [...legalSems].sort((a, b) => hoursOf(a) - hoursOf(b))[0];

      target.course_ids.push(candidate.course_id);
      placed.add(candidate.course_id);
      added.push({ course_id: candidate.course_id, category: cat.name, semester_id: target.semester_id, selection_reason: relevance.reason });
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
  added: Array<{ course_id: string; semester_id: string; hours: number; selection_reason?: string }>;
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
    /** PART A — user's free-text career-direction request (e.g. preferences.extra_request_he). */
    userInterestText?: string | null;
  },
): RepairHoursResult<P> {
  const max = opts.maxHoursPerSemester ?? DEFAULT_MAX_HOURS_PER_SEMESTER;
  const unwanted = new Set(opts.unwantedCourseIds ?? []);
  const sems = proposal.semesters.map(s => ({ ...s, course_ids: [...s.course_ids] }));
  for (const id of opts.knownSemesterIds) {
    if (!sems.some(s => s.semester_id === id)) sems.push({ semester_id: id, course_ids: [] });
  }
  const placed = new Set(sems.flatMap(s => s.course_ids));
  const added: Array<{ course_id: string; semester_id: string; hours: number; selection_reason?: string }> = [];

  const hoursOf = (sem: { course_ids: string[] }) =>
    sem.course_ids.reduce((sum, cid) => sum + (opts.courses[cid]?.hours || 0), 0);

  let addedHours = 0;
  for (const cid of placed) {
    if (analysis.scheduled_course_ids.includes(cid)) continue;
    const h = opts.courses[cid]?.hours;
    if (typeof h === 'number') addedHours += h;
  }
  let total = analysis.hours.known_total_hours + addedHours;

  // PART B/C — target is simply the program-specific required_total (not a
  // hard-coded 185). Any שער רוח courses already added by
  // repairAddGeneralCourses are part of `placed`/`addedHours` above and so
  // already count toward `total` here — do NOT subtract the general shortfall
  // again, that would double-count it and leave the plan 4 ש"ש short of 185.
  const target = analysis.hours.required_total;
  // PART B/C — generic electives must not be added while the שער רוח
  // requirement is still unmet (it must be filled first, by
  // repairAddGeneralCourses, never by engineering electives).
  const generalStatusForGate = getGeneralRequirementStatusReport(analysis, placed);
  const generalShortfall = generalStatusForGate ? generalStatusForGate.missing : (analysis.hours.general_hours_shortfall ?? 0);
  const priorKnown = analysis.hours.prior_hours_known !== false;
  const maxAdditions = generalShortfall > 0 ? 0 : (priorKnown ? MAX_ADDED_ELECTIVES_FOR_HOURS : DEFAULT_ADDED_ELECTIVES_WHEN_PRIOR_HOURS_UNKNOWN);

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
    // PART C — prefer the candidate whose hours best close the remaining
    // gap (exact fit > smallest overshoot > largest undershoot), to minimize
    // overshoot past the 185-ש"ש degree total.
    const gap = target - total;
    const candidate = priorKnown
      ? pickBestCandidateForGap(pool, opts.courses, gap, unwanted, opts.userInterestText)
      : pickBestCandidate(pool, unwanted, opts.userInterestText);
    if (!candidate) { exhausted = true; break; }
    pool = pool.filter(c => c.course_id !== candidate.course_id);

    const info = opts.courses[candidate.course_id] || {};
    const allowed = info.effective_allowed_semesters?.length ? info.effective_allowed_semesters : opts.knownSemesterIds;
    const legalSems = sems.filter(s => allowed.includes(s.semester_id));
    if (!legalSems.length) {
      rejected.push({ course_id: candidate.course_id, reason: 'no_legal_semester' });
      continue;
    }

    const fitting = legalSems.filter(s => hoursOf(s) + (info.hours || 0) <= max);
    const relevance = scoreCareerRelevance(candidate, opts.userInterestText);
    let semTarget: typeof sems[number] | undefined;
    // PART C — foundational analysis courses (e.g. FEM) are scheduled as
    // early as legally possible so they can unlock later labs/projects.
    if (relevance.tag === 'fem_analysis' && fitting.length) {
      semTarget = [...fitting].sort((a, b) => opts.knownSemesterIds.indexOf(a.semester_id) - opts.knownSemesterIds.indexOf(b.semester_id))[0];
    } else if (fitting.length) {
      semTarget = [...fitting].sort((a, b) => hoursOf(a) - hoursOf(b))[0];
    }
    if (!semTarget) semTarget = [...legalSems].sort((a, b) => hoursOf(a) - hoursOf(b))[0];

    semTarget.course_ids.push(candidate.course_id);
    placed.add(candidate.course_id);
    const h = info.hours ?? candidate.hours ?? 0;
    total += h;
    added.push({ course_id: candidate.course_id, semester_id: semTarget.semester_id, hours: h, selection_reason: relevance.reason });
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
  // PART F — if every addition was a low-relevance "filler" course (no
  // career-direction match), say so explicitly rather than silently adding them.
  if (opts.userInterestText && added.every(a => a.selection_reason === DEFAULT_WEAK_RELEVANCE_REASON || a.selection_reason === WEAK_MATCH_FILLER_REASON)) {
    warnings.push('נוספו קורסים פחות קשורים כדי להשלים שעות תואר.');
  }
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
  name_he?: string | null;
}

export interface LoadBalanceContext {
  courses: Record<string, LoadBalanceCourseInfo>;
  maxHoursPerSemester: number | null | undefined;
  pinnedCourseIds?: Set<string>;
  completedCourseIds?: Set<string>;
}

/**
 * PART A — single source of truth for a semester's weekly-hour load. Used by
 * the semester card, warnings, blocking reasons, repairPlanLoad, and the
 * preview summary so the same proposal can never show two different numbers
 * for the same semester. Mirrored client-side (getSemesterLoadLocal).
 */
export function getSemesterLoad(
  semester: { course_ids: string[] },
  courses: Record<string, { hours?: number | null }>,
): number {
  return semester.course_ids.reduce((sum, cid) => sum + (courses[cid]?.hours || 0), 0);
}

export interface CourseLegalityInfo {
  course_id?: string;
  name_he?: string | null;
  placement_policy?: string | null;
  course_type?: string | null;
  recommended_semester?: string | null;
  effective_allowed_semesters?: string[] | null;
  program_allowed_semesters?: string[] | null;
  allowed_semesters?: string[] | null;
  offered_semesters?: string[] | null;
}

export interface LegalSemestersResult {
  semesters: string[];
  /** False when the result is a best-effort fallback (no program/effective data). */
  confident: boolean;
}

/**
 * PART A/B — single source of truth for which semesters a course may
 * legally be placed in (priority model):
 *  - fixed: only its recommended/required semester.
 *  - flexible/mandatory: effective_allowed_semesters (this year's actual
 *    offering) is authoritative when present, even if narrower than
 *    program_allowed_semesters/allowed_semesters; otherwise fall back to
 *    program_allowed_semesters (or allowed_semesters).
 *  - elective: effective_allowed_semesters / offered_semesters if known,
 *    else any remaining known semester (not confident — warning, not block).
 */
export function getLegalSemesters(course: CourseLegalityInfo, knownSemesterIds: string[] = []): LegalSemestersResult {
  const effective = course.effective_allowed_semesters?.length ? course.effective_allowed_semesters : null;
  const program = course.program_allowed_semesters?.length
    ? course.program_allowed_semesters
    : (course.allowed_semesters?.length ? course.allowed_semesters : null);

  if (course.placement_policy === 'fixed') {
    const fixed = course.recommended_semester
      ? [course.recommended_semester]
      : (effective || program || []);
    return { semesters: fixed, confident: true };
  }

  if (course.placement_policy === 'flexible' || course.course_type === 'mandatory') {
    if (effective) return { semesters: effective, confident: true };
    if (program) return { semesters: program, confident: true };
    if (course.offered_semesters?.length) return { semesters: course.offered_semesters, confident: false };
    return { semesters: knownSemesterIds, confident: false };
  }

  // elective
  if (effective) return { semesters: effective, confident: true };
  if (course.offered_semesters?.length) return { semesters: course.offered_semesters, confident: false };
  return { semesters: knownSemesterIds, confident: false };
}

/** PART B — single helper for "is this course legal in this semester?". */
export function isCourseAllowedInSemester(course: CourseLegalityInfo, semesterId: string, knownSemesterIds: string[] = []): boolean {
  const { semesters } = getLegalSemesters(course, knownSemesterIds);
  return semesters.length === 0 || semesters.includes(semesterId);
}

/** PART B — debug/explanatory reason for a legality result (Hebrew, user-facing). */
export function getCourseSemesterLegalityReason(
  course: CourseLegalityInfo,
  semesterId: string,
  semesterLabels?: Record<string, string>,
  knownSemesterIds: string[] = [],
): { allowed: boolean; confident: boolean; reason: string } {
  const name = course.name_he || course.course_id || 'הקורס';
  const { semesters, confident } = getLegalSemesters(course, knownSemesterIds);
  const allowed = semesters.length === 0 || semesters.includes(semesterId);
  const label = (id: string) => semesterLabels?.[id] || id;

  if (!confident) {
    return {
      allowed: true,
      confident: false,
      reason: `לא נמצאה ודאות מלאה לגבי סמסטר ההיצע של ${name}`,
    };
  }
  if (allowed) {
    if (course.placement_policy === 'fixed') {
      return { allowed: true, confident: true, reason: `${name} מותר בסמסטר זה (קורס חובה קבוע בסמסטר ${label(semesterId)})` };
    }
    return { allowed: true, confident: true, reason: `${name} מותר בסמסטר זה לפי program_allowed_semesters` };
  }
  if (course.placement_policy === 'fixed') {
    return {
      allowed: false,
      confident: true,
      reason: `לא מותר כי placement_policy=fixed והסמסטר הנדרש הוא ${semesters.map(label).join(', ') || 'לא ידוע'}`,
    };
  }
  return {
    allowed: false,
    confident: true,
    reason: `${name} אינו מותר בסמסטר זה — הסמסטרים המותרים הם: ${semesters.map(label).join(', ')}`,
  };
}

export interface OverloadedSemesterReport {
  semester_id: string;
  hours: number;
  movable: string[];
  not_movable: string[];
  /** PART C — exact reason each non-movable course stayed put. */
  not_movable_reasons: Array<{ course_id: string; reason: string }>;
}

/** PART E — a single move attempt (accepted or rejected), for the debug report. */
export interface LoadMoveLogEntry {
  course_id: string;
  course_name?: string | null;
  from_semester: string;
  to_semester: string;
  accepted: boolean;
  reason: string;
  before_load: number;
  after_load: number;
}

export interface RepairLoadResult<P extends RepairProposalShape> {
  proposal: P;
  repaired: boolean;
  /** PART D — number of courses actually moved to reduce overload. */
  movedCount: number;
  /** PART E — every move attempted (accepted and rejected), in order. */
  moveLog: LoadMoveLogEntry[];
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
  if (max == null) return { proposal, repaired: false, movedCount: 0, moveLog: [], unmovedOverloaded: [] };

  const sems = proposal.semesters.map(s => ({ ...s, course_ids: [...s.course_ids] }));
  const allSemIds = sems.map(s => s.semester_id);
  const hoursOf = (sem: { course_ids: string[] }) => getSemesterLoad(sem, ctx.courses);

  // PART A/B — minimize the maximum load, then variance: each pass, target
  // the globally heaviest over-max semester (not just the first), try to
  // move its best candidate (electives → general/שער רוח → flexible
  // mandatory → other movable) to the least-loaded legal semester, and only
  // commit the move if it actually reduces (or doesn't worsen) the current
  // maximum load. Every attempt — accepted or rejected — is logged for the
  // PART E debug report and PART D final message.
  let repaired = false;
  let movedCount = 0;
  const moveLog: LoadMoveLogEntry[] = [];
  let guard = 0;
  while (guard++ < 200) {
    const hours = sems.map(hoursOf);
    const maxHours = Math.max(...hours);
    if (maxHours <= max) break;
    const overIdx = hours.indexOf(maxHours);
    const sem = sems[overIdx];

    const candidates = sem.course_ids
      .map(cid => ({ cid, info: ctx.courses[cid] }))
      .filter(({ cid, info }) => isMovableForBalance(cid, info, ctx))
      .sort((a, b) => _balanceTier(a.info) - _balanceTier(b.info));

    let moved = false;
    for (const { cid, info } of candidates) {
      const ch = info?.hours || 0;
      // PART B.7 — fall back to "any known semester" when no explicit
      // effective_allowed_semesters is set (electives and unrestricted
      // flexible/general courses alike), but never invent a target for a
      // course that genuinely has a restricted allowed-semester list.
      const allowed = info?.effective_allowed_semesters?.length
        ? info.effective_allowed_semesters
        : allSemIds;

      const legalIdx = sems
        .map((_, j) => j)
        .filter(j => j !== overIdx && allowed.includes(sems[j].semester_id));
      if (!legalIdx.length) continue;

      const fitting = legalIdx.filter(j => max - hoursOf(sems[j]) >= ch);
      const pool = fitting.length ? fitting : legalIdx;
      const bestJ = pool.sort((a, b) => hoursOf(sems[a]) - hoursOf(sems[b]))[0];

      // Only commit if it actually helps: the new max load must not exceed
      // the current max (i.e. it lowers this semester's load without
      // creating a worse one elsewhere).
      const newOverHours = hoursOf(sem) - ch;
      const newTargetHours = hoursOf(sems[bestJ]) + ch;
      const helps = newTargetHours < maxHours;

      if (!helps) {
        moveLog.push({
          course_id: cid,
          course_name: info?.name_he ?? null,
          from_semester: sem.semester_id,
          to_semester: sems[bestJ].semester_id,
          accepted: false,
          reason: `נדחה כי הסמסטר היה מגיע ל-${newTargetHours}/${max}`,
          before_load: maxHours,
          after_load: newTargetHours,
        });
        continue;
      }

      const k = sem.course_ids.indexOf(cid);
      sem.course_ids.splice(k, 1);
      sems[bestJ].course_ids.push(cid);
      moveLog.push({
        course_id: cid,
        course_name: info?.name_he ?? null,
        from_semester: sem.semester_id,
        to_semester: sems[bestJ].semester_id,
        accepted: true,
        reason: `התקבל, עומס ${sem.semester_id} ירד מ-${maxHours} ל-${newOverHours}`,
        before_load: maxHours,
        after_load: newOverHours,
      });
      moved = true;
      repaired = true;
      movedCount++;
      break;
    }
    if (!moved) break;
  }

  const unmovedOverloaded: OverloadedSemesterReport[] = sems
    .map((sem, idx) => ({ sem, idx, hours: hoursOf(sem) }))
    .filter(({ hours }) => hours > max)
    .map(({ sem, idx, hours }) => {
      const movable: string[] = [];
      const notMovable: string[] = [];
      const notMovableReasons: Array<{ course_id: string; reason: string }> = [];
      for (const cid of sem.course_ids) {
        const info = ctx.courses[cid];
        if (!isMovableForBalance(cid, info, ctx)) {
          notMovable.push(cid);
          let reason: string;
          if (!info) reason = 'אין מידע על הקורס';
          else if (ctx.completedCourseIds?.has(cid)) reason = 'completed';
          else if (ctx.pinnedCourseIds?.has(cid)) reason = 'pinned';
          else if (info.placement_policy === 'fixed') reason = 'fixed_mandatory';
          else reason = 'no_legal_target';
          notMovableReasons.push({ course_id: cid, reason });
          continue;
        }
        // PART A — "movable" here means a legal target semester actually
        // exists (already tried and exhausted above), not just movable by
        // policy — otherwise the caller would report "movable courses exist"
        // even though no legal move was ever possible.
        const allowed = info?.effective_allowed_semesters?.length ? info.effective_allowed_semesters : allSemIds;
        const hasLegalTarget = sems.some((other, j) => j !== idx && allowed.includes(other.semester_id));
        if (hasLegalTarget) {
          movable.push(cid);
        } else {
          notMovable.push(cid);
          notMovableReasons.push({ course_id: cid, reason: 'no_legal_target' });
        }
      }
      return { semester_id: sem.semester_id, hours, movable, not_movable: notMovable, not_movable_reasons: notMovableReasons };
    });

  if (!repaired) return { proposal, repaired: false, movedCount, moveLog, unmovedOverloaded };
  return { proposal: { ...proposal, semesters: sems }, repaired: true, movedCount, moveLog, unmovedOverloaded };
}

// ─────────────────────────────────────────────────────────────────────────
// Plan quality scoring & optimization (PARTS A-E of the optimization task)
// ─────────────────────────────────────────────────────────────────────────

export interface ScorePlanContext {
  /** course_id -> info used for load/relevance/legality lookups. */
  courses: Record<string, RepairCourseInfo & CompletionCandidate>;
  maxHoursPerSemester?: number | null;
  knownSemesterIds: string[];
  userInterestText?: string | null;
  wantedCourseIds?: string[] | null;
  unwantedCourseIds?: string[] | null;
  /** If false, the plan is illegal and must score the worst regardless of other factors. */
  legal: boolean;
}

export interface PlanScoreBreakdown {
  loadBalance: number;
  relevance: number;
  sequencing: number;
  preferences: number;
}

export interface PlanScoreResult {
  score: number;
  legal: boolean;
  breakdown: PlanScoreBreakdown;
}

/**
 * PART A — combine legality (hard gate, computed by the caller via
 * validatePlanProposal/evaluatePlanCompleteness), load balance, professional
 * relevance, sequencing and user preferences into a single comparable score.
 * Higher is better. Illegal plans always score below legal ones.
 */
export function scorePlan<P extends RepairProposalShape>(proposal: P, ctx: ScorePlanContext): PlanScoreResult {
  const max = ctx.maxHoursPerSemester ?? DEFAULT_MAX_HOURS_PER_SEMESTER;
  const known = ctx.knownSemesterIds;
  const wanted = new Set(ctx.wantedCourseIds ?? []);
  const avoided = new Set(ctx.unwantedCourseIds ?? []);

  const loads = proposal.semesters.map(s => getSemesterLoad(s, ctx.courses));
  const peak = loads.length ? Math.max(...loads) : 0;
  const mean = loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : 0;
  const variance = loads.length ? loads.reduce((a, b) => a + (b - mean) ** 2, 0) / loads.length : 0;
  const overCount = loads.filter(h => h > max).length;
  // PART 2 — penalize a high peak, variance between semesters, and any
  // semester above the user's max.
  const loadBalance = -(peak * 1) - (Math.sqrt(variance) * 2) - (overCount * 10);

  let relevance = 0;
  let sequencing = 0;
  let preferences = 0;
  for (const sem of proposal.semesters) {
    const semIndex = known.indexOf(sem.semester_id);
    for (const cid of sem.course_ids) {
      const info = ctx.courses[cid];
      if (!info) continue;

      // PART 3 — professional relevance, reusing the career-relevance scorer.
      const rel = scoreCareerRelevance(info, ctx.userInterestText);
      relevance += rel.score;

      // PART 4 — sequencing: foundational analysis courses (e.g. FEM) are
      // worth more the earlier they're scheduled, so they can unlock labs.
      if (rel.tag === 'fem_analysis' && semIndex >= 0 && known.length > 1) {
        sequencing += (known.length - 1 - semIndex);
      }

      // PART 5 — user wanted/avoided preferences.
      if (wanted.has(cid)) preferences += 2;
      if (avoided.has(cid)) preferences -= 3;
    }
  }

  const breakdown: PlanScoreBreakdown = { loadBalance, relevance, sequencing, preferences };
  if (!ctx.legal) {
    return { score: -Infinity, legal: false, breakdown };
  }
  return { score: loadBalance + relevance * 2 + sequencing + preferences, legal: true, breakdown };
}

/**
 * PART B — pick the highest-scoring legal plan among candidates. Falls back
 * to the first candidate if none are legal (caller still has to surface why).
 */
export function pickBestPlan<P extends RepairProposalShape>(
  plans: Array<{ proposal: P; legal: boolean; ctx: ScorePlanContext }>,
): { proposal: P; score: PlanScoreResult } | null {
  if (!plans.length) return null;
  const scored = plans.map(p => ({ proposal: p.proposal, score: scorePlan(p.proposal, { ...p.ctx, legal: p.legal }) }));
  const legal = scored.filter(s => s.score.legal);
  const pool = legal.length ? legal : scored;
  return [...pool].sort((a, b) => b.score.score - a.score.score)[0];
}

/**
 * PART C.1 — replace electives whose career relevance is negative (weak)
 * with a same-category candidate that is legal in the same semester and has
 * a higher relevance score, if one exists. Returns the updated proposal and
 * a list of swaps made (for the preview's "מדוע זו התוכנית שנבחרה?" section).
 */
export function replaceWeakElectives<P extends RepairProposalShape>(
  proposal: P,
  analysis: CompletionAnalysis,
  opts: {
    courses: Record<string, RepairCourseInfo>;
    knownSemesterIds: string[];
    userInterestText?: string | null;
  },
): { proposal: P; replaced: Array<{ removed: string; added: string; semester_id: string; reason: string }> } {
  if (!opts.userInterestText || !opts.userInterestText.trim()) return { proposal, replaced: [] };

  const sems = proposal.semesters.map(s => ({ ...s, course_ids: [...s.course_ids] }));
  const placed = new Set(sems.flatMap(s => s.course_ids));
  const replaced: Array<{ removed: string; added: string; semester_id: string; reason: string }> = [];

  for (const cat of analysis.categories) {
    const placedCandidates = cat.candidates.filter(c => placed.has(c.course_id));
    const unplacedCandidates = cat.candidates.filter(c => !placed.has(c.course_id));
    for (const current of placedCandidates) {
      const currentRel = scoreCareerRelevance(current, opts.userInterestText);
      if (currentRel.score >= 0) continue; // only swap weakly-related courses

      const sem = sems.find(s => s.course_ids.includes(current.course_id));
      if (!sem) continue;

      const better = [...unplacedCandidates]
        .filter(c => !placed.has(c.course_id))
        .map(c => ({ c, rel: scoreCareerRelevance(c, opts.userInterestText) }))
        .filter(({ rel }) => rel.score > currentRel.score)
        .filter(({ c }) => {
          const info = opts.courses[c.course_id];
          const allowed = info?.effective_allowed_semesters?.length ? info.effective_allowed_semesters : opts.knownSemesterIds;
          return allowed.includes(sem.semester_id);
        })
        .sort((a, b) => b.rel.score - a.rel.score)[0];

      if (!better) continue;

      const idx = sem.course_ids.indexOf(current.course_id);
      sem.course_ids[idx] = better.c.course_id;
      placed.delete(current.course_id);
      placed.add(better.c.course_id);
      replaced.push({ removed: current.course_id, added: better.c.course_id, semester_id: sem.semester_id, reason: better.rel.reason });
    }
  }

  if (!replaced.length) return { proposal, replaced: [] };
  return { proposal: { ...proposal, semesters: sems }, replaced };
}

/**
 * PART C.2 — move courses tagged `fem_analysis` (e.g. מבוא לאלמנטים סופיים)
 * to the earliest legal semester with room, if they're currently scheduled
 * later than that. Pinned/completed courses are left untouched by the
 * caller (they're filtered out of `movableCourseIds`).
 */
export function moveFoundationCoursesEarlier<P extends RepairProposalShape>(
  proposal: P,
  opts: {
    courses: Record<string, RepairCourseInfo & CompletionCandidate>;
    maxHoursPerSemester?: number | null;
    knownSemesterIds: string[];
    userInterestText?: string | null;
    movableCourseIds?: Set<string>;
  },
): { proposal: P; moved: Array<{ course_id: string; from: string; to: string }> } {
  if (!opts.userInterestText || !opts.userInterestText.trim()) return { proposal, moved: [] };

  const max = opts.maxHoursPerSemester ?? DEFAULT_MAX_HOURS_PER_SEMESTER;
  const sems = proposal.semesters.map(s => ({ ...s, course_ids: [...s.course_ids] }));
  const hoursOf = (sem: { course_ids: string[] }) => sem.course_ids.reduce((sum, cid) => sum + (opts.courses[cid]?.hours || 0), 0);
  const moved: Array<{ course_id: string; from: string; to: string }> = [];

  for (const sem of sems) {
    for (const cid of [...sem.course_ids]) {
      const info = opts.courses[cid];
      if (!info) continue;
      if (opts.movableCourseIds && !opts.movableCourseIds.has(cid)) continue;
      const rel = scoreCareerRelevance(info, opts.userInterestText);
      if (rel.tag !== 'fem_analysis') continue;

      const currentIdx = opts.knownSemesterIds.indexOf(sem.semester_id);
      const allowed = info.effective_allowed_semesters?.length ? info.effective_allowed_semesters : opts.knownSemesterIds;
      const earlier = sems.find(s =>
        opts.knownSemesterIds.indexOf(s.semester_id) < currentIdx
        && allowed.includes(s.semester_id)
        && hoursOf(s) + (info.hours || 0) <= max,
      );
      if (!earlier) continue;

      sem.course_ids = sem.course_ids.filter(c => c !== cid);
      earlier.course_ids.push(cid);
      moved.push({ course_id: cid, from: sem.semester_id, to: earlier.semester_id });
    }
  }

  if (!moved.length) return { proposal, moved: [] };
  return { proposal: { ...proposal, semesters: sems }, moved };
}

export type QualityLabel = 'גבוהה' | 'בינונית' | 'נמוכה' | 'טוב' | 'בינוני' | 'חלש' | 'תקין' | 'חסום';

export interface PlanQualityExplanation {
  bullets: string[];
  labels: {
    professional_fit: QualityLabel;
    load_balance: QualityLabel;
    legality: QualityLabel;
    sequencing: QualityLabel;
  };
}

/**
 * PART D — short, user-facing explanation of why the previewed plan looks
 * the way it does, plus qualitative labels derived from the score breakdown.
 */
export function explainPlanQuality(score: PlanScoreResult, opts: { userInterestText?: string | null }): PlanQualityExplanation {
  const bullets: string[] = [];
  const hasInterest = !!(opts.userInterestText && opts.userInterestText.trim());

  if (hasInterest && score.breakdown.relevance > 0) {
    bullets.push('העדיפה קורסים בתחום אנליזות/תכן/רובוטיקה');
  }
  if (score.breakdown.sequencing > 0) {
    bullets.push('שיבצה קורסי בסיס מוקדם ככל האפשר');
  }
  if (score.breakdown.loadBalance > -20) {
    bullets.push('איזנה עומס עד למינימום האפשרי תחת האילוצים');
  }
  if (hasInterest && score.breakdown.relevance >= 0) {
    bullets.push('נמנעה מקורסים פחות רלוונטיים כאשר היו חלופות');
  }

  const professional_fit: QualityLabel = !hasInterest
    ? 'בינונית'
    : score.breakdown.relevance > 3 ? 'גבוהה' : score.breakdown.relevance >= 0 ? 'בינונית' : 'נמוכה';
  const load_balance: QualityLabel = score.breakdown.loadBalance > -10 ? 'טוב' : score.breakdown.loadBalance > -25 ? 'בינוני' : 'חלש';
  const legality: QualityLabel = score.legal ? 'תקין' : 'חסום';
  const sequencing: QualityLabel = score.breakdown.sequencing > 1 ? 'טוב' : score.breakdown.sequencing >= 0 ? 'בינוני' : 'חלש';

  return { bullets, labels: { professional_fit, load_balance, legality, sequencing } };
}
