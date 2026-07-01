/**
 * CourseProfile — a normalized, structured record for EVERY course in a
 * program's eligible universe, built once from the program board_json.
 *
 * The planner reasons over CourseProfiles, never over the raw board JSON, so
 * that the full universe (all placed courses + the whole elective repository)
 * is available — not a pre-filtered subset. Courses are never dropped for
 * being hard, risky, or unpreferred; explicit user exclusion is recorded as
 * `excluded=true` (with a reason) rather than by omission, so the trace can
 * still explain it.
 *
 * Field values come only from parsed data already in board_json. Missing or
 * ambiguous data is reflected in `data_confidence` + `provenance`, not guessed;
 * an optional LLM syllabus-fill (a separate tool) may later refine low-
 * confidence fields, but never the deterministic facts the validators rely on.
 */

export interface CourseProvenance {
  /** Where the course record came from ('program' | 'elective' | …). */
  source: string | null;
  /** board_json data_quality marker, if present. */
  data_quality: string | null;
  /** URL backing the offering (this-year semester availability), if known. */
  offering_source_url: string | null;
  /** How the name was sourced, if known. */
  name_source: string | null;
}

export interface CourseProfile {
  course_id: string;
  name_he: string | null;

  // ── requirement bucket / classification ──────────────────────────────────
  /** Elective category / requirement bucket id (program_category_id ∪ category_id). */
  category_id: string | null;
  category_name_he: string | null;
  is_mandatory: boolean;
  course_type: string | null;
  /** 'fixed' | 'flexible' | 'elective' | null. */
  placement_policy: string | null;

  // ── credits / weekly hours ────────────────────────────────────────────────
  hours: number | null;

  // ── offering / legal-semester inputs (consumed by getLegalSemesters) ──────
  offered_semesters: string[] | null;
  effective_allowed_semesters: string[] | null;
  recommended_semester: string | null;
  allowed_semesters: string[] | null;
  program_allowed_semesters: string[] | null;

  // ── prerequisites / co-requisites ─────────────────────────────────────────
  prerequisites: string[];
  corequisites: string[];

  // ── syllabus ──────────────────────────────────────────────────────────────
  syllabus_url: string | null;
  syllabus_available: boolean;
  syllabus_summary_he: string | null;
  syllabus_topics_he: string[];

  // ── assessment / workload indicators ──────────────────────────────────────
  assessment_type: string | null;
  workload_score: number | null;
  difficulty_score: number | null;
  difficulty_level: string | null;
  grade_average: number | null;

  // ── relation to user preferences ──────────────────────────────────────────
  is_wanted: boolean;
  is_unwanted: boolean;

  // ── annual course deduplication ───────────────────────────────────────────
  /** Shared ID for annual course pairs (e.g. semester A + semester B of the same course). */
  root_course_id?: string;
  /** When true, only one of the paired annual courses counts toward degree hours. */
  count_hours_once?: boolean;

  // ── exclusion / disallowed status (never dropped — flagged) ───────────────
  excluded: boolean;
  exclusion_reason: string | null;

  // ── data confidence + provenance ──────────────────────────────────────────
  /** 0..1 aggregate confidence in this profile's data completeness. */
  data_confidence: number;
  provenance: CourseProvenance;
}

export interface BuildProfilesOptions {
  /** course_ids the user has completed — excluded from planning (not from the map). */
  completedCourseIds?: Set<string> | string[];
  /** course_ids the user explicitly wants. */
  wantedCourseIds?: string[];
  /** course_ids the user explicitly does not want. */
  unwantedCourseIds?: string[];
  /** course_ids hard-disallowed (explicit exclusion / honors-only / etc). */
  disallowedCourseIds?: string[];
}

// ── helpers ─────────────────────────────────────────────────────────────────

function toSet(v: Set<string> | string[] | undefined): Set<string> {
  if (!v) return new Set();
  return v instanceof Set ? v : new Set(v);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function nullableStrArr(v: unknown): string[] | null {
  return Array.isArray(v) ? strArr(v) : null;
}

/** Map a confidence value that may be a number (0..1) or a label to 0..1, or null. */
function confValue(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.min(1, v));
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'high') return 0.9;
    if (s === 'medium' || s === 'med') return 0.6;
    if (s === 'low') return 0.3;
  }
  return null;
}

const GRADE_PATH = (raw: any): number | null =>
  num(raw?.grade_signal?.average_grade) ?? num(raw?.grade_average) ?? num(raw?.tau_factor_avg_grade);

/**
 * Aggregate data_confidence from the available confidence signals. Each present
 * signal contributes; a course with no signals and no syllabus/hours data lands
 * low (<0.6) so it is flagged as needing refinement.
 */
function computeDataConfidence(raw: any): number {
  const signals = [
    confValue(raw.difficulty_confidence),
    confValue(raw.syllabus_confidence),
    confValue(raw.offering_source_confidence),
  ].filter((x): x is number => x != null);

  if (signals.length) {
    return signals.reduce((a, b) => a + b, 0) / signals.length;
  }
  // No explicit confidence: derive a coarse value from data presence.
  let score = 0.2;
  if (raw.syllabus_text_available || raw.syllabus_summary_he) score += 0.2;
  if (num(raw.weekly_hours) != null) score += 0.1;
  if (num(raw.difficulty_score) != null) score += 0.1;
  return Math.min(1, score);
}

/**
 * Merge two raw course records for the same course_id (semester-placed entry +
 * repository entry). The placed entry is richer for placement/prereqs; the repo
 * entry may carry category/offering/assessment. Prefer defined values, with the
 * placed (`base`) entry winning ties.
 */
function mergeRaw(base: any, extra: any): any {
  const out: any = { ...extra, ...base };
  for (const k of Object.keys(extra)) {
    if (out[k] == null && extra[k] != null) out[k] = extra[k];
  }
  return out;
}

function toProfile(raw: any, opts: BuildProfilesOptions): CourseProfile {
  const wanted = new Set(opts.wantedCourseIds ?? []);
  const unwanted = new Set(opts.unwantedCourseIds ?? []);
  const disallowed = toSet(opts.disallowedCourseIds);

  const id = raw.course_id;
  const isDisallowed = disallowed.has(id);
  const isUnwanted = unwanted.has(id);

  let excluded = false;
  let exclusion_reason: string | null = null;
  if (isDisallowed) {
    excluded = true;
    exclusion_reason = 'הקורס סומן כלא-זמין (חריגה מפורשת / קורס מצטיינים / חופף).';
  }

  return {
    course_id: id,
    name_he: typeof raw.name_he === 'string' ? raw.name_he : null,

    category_id: raw.program_category_id ?? raw.category_id ?? null,
    category_name_he: raw.program_category_name_he ?? null,
    is_mandatory: raw.is_mandatory === true || raw.course_type === 'mandatory',
    course_type: raw.course_type ?? (raw.is_mandatory ? 'mandatory' : 'elective'),
    placement_policy: raw.placement_policy ?? null,

    hours: num(raw.weekly_hours),

    offered_semesters: nullableStrArr(raw.offered_semesters),
    effective_allowed_semesters: nullableStrArr(raw.effective_allowed_semesters),
    recommended_semester: typeof raw.recommended_semester === 'string' ? raw.recommended_semester : null,
    allowed_semesters: nullableStrArr(raw.allowed_semesters),
    program_allowed_semesters: nullableStrArr(raw.program_allowed_semesters),

    prerequisites: strArr(raw.prerequisites),
    corequisites: strArr(raw.corequisites),

    syllabus_url: typeof raw.syllabus_url === 'string' ? raw.syllabus_url : null,
    syllabus_available: !!(raw.syllabus_text_available || raw.syllabus_summary_he),
    syllabus_summary_he: typeof raw.syllabus_summary_he === 'string' ? raw.syllabus_summary_he : null,
    syllabus_topics_he: strArr(raw.syllabus_topics_he ?? raw.syllabus_ai_topics),

    assessment_type: typeof raw.assessment_type === 'string' ? raw.assessment_type : null,
    workload_score: num(raw.workload_score),
    difficulty_score: num(raw.difficulty_score),
    difficulty_level: typeof raw.difficulty_level === 'string' ? raw.difficulty_level : null,
    grade_average: GRADE_PATH(raw),

    is_wanted: wanted.has(id),
    is_unwanted: isUnwanted,

    root_course_id: typeof raw.root_course_id === 'string' ? raw.root_course_id : undefined,
    count_hours_once: raw.count_hours_once === true ? true : undefined,

    excluded,
    exclusion_reason,

    data_confidence: computeDataConfidence(raw),
    provenance: {
      source: raw.source ?? null,
      data_quality: raw.data_quality ?? null,
      offering_source_url: raw.offering_source_url ?? null,
      name_source: raw.name_source ?? null,
    },
  };
}

/**
 * Build a CourseProfile for EVERY course in the program's eligible universe:
 * every course placed in a semester ∪ every metadata.program_repository_courses
 * entry. No truncation, no top-N, no category filter.
 */
export function buildCourseProfiles(
  boardJson: any,
  opts: BuildProfilesOptions = {},
): Map<string, CourseProfile> {
  // Collect raw records by id, merging placed + repository data for the same id.
  const rawById = new Map<string, any>();
  const add = (c: any) => {
    if (!c || typeof c.course_id !== 'string') return;
    const existing = rawById.get(c.course_id);
    rawById.set(c.course_id, existing ? mergeRaw(existing, c) : c);
  };

  for (const sem of boardJson?.semesters ?? []) {
    for (const c of sem.courses ?? []) add(c);
  }
  for (const c of boardJson?.metadata?.program_repository_courses ?? []) add(c);
  // קורסי שער רוח / general candidates, if the board carries them.
  const general = boardJson?.metadata?.general_course_requirements?.candidates
    ?? boardJson?.general_course_requirements?.candidates;
  for (const c of general ?? []) add(c);

  const profiles = new Map<string, CourseProfile>();
  for (const [id, raw] of rawById) {
    profiles.set(id, toProfile(raw, opts));
  }
  return profiles;
}
