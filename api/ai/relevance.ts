/**
 * Phase 2A — generic, topic-agnostic relevance scoring.
 *
 * The previous scorer (api/ai/completion_analysis.ts: scoreCareerRelevance)
 * matched user free-text against a small set of hand-curated Hebrew keyword
 * groups (FEM/analysis, mechanical design, robotics/control, lab/industry).
 * That hard-coded one specific user's profile into the planner.
 *
 * This module replaces that approach with:
 *   1. extractPreferenceTerms — generic tokenizer + light Hebrew normalization
 *      + avoid-context detection, producing structured terms for arbitrary
 *      Hebrew/English requests.
 *   2. buildCourseSearchText — concat the syllabus fields we actually have
 *      (syllabus_summary_he, syllabus_topics_he, syllabus_assessment_he,
 *      syllabus_structure_he, program_category_name_he, course_type).
 *   3. lexicalRelevance — token overlap between request and course text,
 *      with a small substring fallback for compound words.
 *   4. courseUtility — flat practicality bonus (lab/project/applied/sim).
 *   5. buildSelectionReason — deterministic Hebrew explanation composed
 *      from actual matched facts (no static topic-specific strings).
 *
 * Pure TypeScript: no Node-only deps so it can be mirrored 1:1 in the
 * inline-script client (semester_board_viewer.html) following the existing
 * `_xxxLocal` duplication pattern.
 */

// ── Tokenization & stopwords ────────────────────────────────────────────────

/**
 * Hebrew stopwords + English connectives. Includes the lone letter prefixes
 * ו/ה when they appear as their own token (we still strip prefix letters
 * from compound tokens separately, see normalizeToken).
 */
const HEBREW_STOPWORDS = new Set([
  'אני', 'רוצה', 'מעדיף', 'מעדיפה', 'חשוב', 'לי', 'עם', 'בלי', 'כמה',
  'שיותר', 'שפחות', 'קורסים', 'קורס', 'כקורס', 'מסלול', 'תחום', 'בתחום', 'של',
  // Generic curriculum words — never a topic the user wants to avoid/pursue.
  'בחירה', 'חירה', 'כבחירה', 'בחירות', 'חובה', 'מקצוע', 'נקודות', 'נקז',
  'על', 'את', 'אם', 'יש', 'ולא', 'לא', 'גם', 'אבל', 'יותר', 'פחות',
  'גבוה', 'גבוהה', 'נמוך', 'נמוכה', 'ו', 'ה', 'או', 'כי', 'זה',
  'להימנע', 'להתמקד',
  'a', 'an', 'the', 'and', 'or', 'but', 'with', 'without', 'no',
  'i', 'me', 'my', 'want', 'prefer', 'would', 'like', 'for', 'to',
  'of', 'in', 'on', 'is', 'are',
]);

/** Words that signal the *following* token(s) are things to avoid. */
const AVOID_TRIGGERS_HE = ['בלי', 'להימנע', 'שפחות', 'פחות', 'לא', 'ולא'];
const AVOID_TRIGGERS_EN = ['without', 'no', 'avoid', 'less'];

/** Two-word avoid phrases — checked on the raw lowercased text. */
const AVOID_PHRASES = [
  'לא רוצה', 'לא מעוניין', 'לא מעוניינת',
  'כמה שפחות', 'לא בא לי',
  'don\'t want', 'do not want', 'not interested',
];

const PRACTICAL_KEYWORDS = [
  'תעשייה', 'תעשיית', 'תעשייתי', 'תעשייתית',
  'פרקטי', 'פרקטיים', 'פרקטית', 'שימושי', 'יישומי', 'יישומית',
  'כלים', 'סימולציה', 'סימולציות', 'תכן', 'תכנון', 'פרויקט', 'פרויקטים',
  'מעבדה', 'מעבדות', 'מקצועי',
  'applied', 'practical', 'industry', 'industrial', 'tools', 'hands-on', 'handson',
];

const INDUSTRY_VALUE_KEYWORDS = [
  'תעשייתי', 'תעשייה', 'תעשיית', 'מקצועי', 'מקצועית',
  'industry', 'industrial', 'real-world', 'professional',
];

const EASY_KEYWORDS = ['קל', 'קלים', 'קלה', 'easy', 'light'];

// ── Public types ────────────────────────────────────────────────────────────

export interface PreferenceTerms {
  interest_terms: string[];
  avoid_terms: string[];
  grade_target?: number;
  wants_practical?: boolean;
  wants_industry_value?: boolean;
  wants_easy?: boolean;
  raw_text: string;
}

export interface LexicalRelevance {
  score: number;
  matched_terms: string[];
  avoided_terms: string[];
}

export interface CourseUtility {
  score: number;
  reasons: string[];
}

/** Minimal shape of a course used by the scorers — matches the parsed JSON
 *  board entries (data/parsed_json/*) and the CompletionCandidate flows.
 *  All fields optional so partial fixtures work in tests. */
export interface CourseLike {
  name_he?: string | null;
  syllabus_summary_he?: string | null;
  syllabus_topics_he?: string[] | null;
  syllabus_assessment_he?: string | null;
  syllabus_structure_he?: string | null;
  program_category_name_he?: string | null;
  course_type?: string | null;
}

// ── Internal helpers ────────────────────────────────────────────────────────

/** Split on whitespace and Hebrew/English punctuation, keeping technical
 *  tokens like FEM, CAE, MATLAB intact (alphanumerics + internal dashes). */
function tokenize(text: string): string[] {
  if (!text) return [];
  // Replace common punctuation with spaces; keep apostrophes/dashes inside words.
  const cleaned = text
    .replace(/[.,;:!?\(\)\[\]\{\}״"׳'`]/g, ' ')
    .replace(/[–—\-_]/g, ' ');
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  return tokens.map(t => t.toLowerCase());
}

/** Light Hebrew normalization for matching only (NOT for display):
 *  strip leading single-letter prefixes ה/ו/ב/ל/מ/כ when the remaining stem
 *  is still >=3 chars, and strip simple plural suffixes ים/ות when the stem
 *  remains >=4 chars. Safe enough that "פרויקטים" matches "פרויקט". */
function normalizeToken(t: string): string {
  if (!t) return t;
  let s = t;
  // Only strip a single-letter Hebrew prefix when the remaining stem is still
  // at least 4 chars — short words like "מכני" / "תכן" must not be butchered.
  if (s.length >= 5 && /^[הובלמכש]/.test(s)) {
    const stripped = s.slice(1);
    if (stripped.length >= 4) s = stripped;
  }
  if (s.length >= 6) {
    if (s.endsWith('ים')) s = s.slice(0, -2);
    else if (s.endsWith('ות')) s = s.slice(0, -2);
  }
  return s;
}

function isPureNumber(t: string): boolean {
  return /^\d+$/.test(t);
}

function isContentToken(t: string): boolean {
  if (!t || t.length < 2) return false;
  if (HEBREW_STOPWORDS.has(t)) return false;
  if (isPureNumber(t)) return false;
  return true;
}

/** Same regex as completion_analysis.parseGradeTarget — duplicated here so
 *  this module stays self-contained and easy to mirror in the client. */
export function parseGradeTargetLocal(text?: string | null): number | undefined {
  if (!text) return undefined;
  const m = text.match(/ממוצע[^\d]{0,15}(\d{2,3})/);
  let val: number | undefined;
  if (m) {
    val = parseInt(m[1], 10);
  } else {
    const en = text.match(/\b(?:gpa|average)\b[^\d]{0,15}(\d{2,3})/i);
    if (en) val = parseInt(en[1], 10);
  }
  if (val == null || !Number.isFinite(val)) return undefined;
  if (val < 60 || val > 100) return undefined;
  return val;
}

// ── 1. extractPreferenceTerms ───────────────────────────────────────────────

/**
 * Generic preference extractor. The output structure is the same regardless
 * of topic — there's no special path for FEM/robotics/control. Anything the
 * user mentions becomes an interest_term; anything in an avoid context
 * becomes an avoid_term.
 */
export function extractPreferenceTerms(text: string): PreferenceTerms {
  const raw = text || '';
  const lower = raw.toLowerCase();

  // Pass 1: phrase-level avoid detection — mark spans the tokenizer can't
  // see across token boundaries (e.g. "לא רוצה X").
  let workingText = raw;
  const avoidSpans: string[] = [];
  for (const phrase of AVOID_PHRASES) {
    const idx = lower.indexOf(phrase);
    if (idx >= 0) {
      // Pull the next ~40 chars after the phrase into the avoid bucket.
      const after = raw.slice(idx + phrase.length, idx + phrase.length + 40);
      avoidSpans.push(after);
      workingText = workingText.replace(new RegExp(phrase.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i'), ' ');
    }
  }

  const tokens = tokenize(workingText);

  const interestSet = new Set<string>();
  const avoidSet = new Set<string>();

  // Pass 2: walk tokens; when we see an avoid trigger, the next few content
  // tokens go into avoid_terms instead of interest_terms. We store the
  // *normalized* form (Hebrew prefix-stripped, plural-stripped) so downstream
  // matching can compare like-for-like, and so the structured output is a
  // stable list of lexemes regardless of incidental prefixes ל/ו/ב/...
  let avoidWindow = 0;
  const addTerm = (set: Set<string>, tok: string) => {
    // Reject generic words in their raw form too (before normalization may
    // mangle a non-prefixed word, e.g. "בחירה" -> "חירה").
    if (HEBREW_STOPWORDS.has(tok)) return;
    const n = normalizeToken(tok);
    if (!n || n.length < 2) return;
    // Re-check stopword list against the *normalized* form too — otherwise
    // tokens like "וקורסים" pass isContentToken (raw form not in stopwords),
    // get normalized to "קורסים"/"קורס" and pollute interest/avoid sets,
    // substring-matching nearly every course text.
    if (HEBREW_STOPWORDS.has(n)) return;
    set.add(n);
  };
  for (const tok of tokens) {
    if (AVOID_TRIGGERS_HE.includes(tok) || AVOID_TRIGGERS_EN.includes(tok)) {
      avoidWindow = 3; // next up to 3 content tokens are avoids
      continue;
    }
    if (!isContentToken(tok)) {
      // Stopwords don't consume the avoid window.
      continue;
    }
    if (avoidWindow > 0) {
      addTerm(avoidSet, tok);
      avoidWindow--;
    } else {
      addTerm(interestSet, tok);
    }
  }

  // Pass 3: avoid spans (from phrase detection above) — tokenize and push
  // their content tokens into avoid_terms too.
  for (const span of avoidSpans) {
    for (const tok of tokenize(span)) {
      if (isContentToken(tok)) addTerm(avoidSet, tok);
    }
  }

  // Avoid terms shouldn't simultaneously be interest terms.
  for (const a of avoidSet) interestSet.delete(a);

  const grade_target = parseGradeTargetLocal(raw);

  const hasAny = (kws: string[]) => kws.some(k => lower.includes(k));
  const wants_practical = hasAny(PRACTICAL_KEYWORDS);
  const wants_industry_value = hasAny(INDUSTRY_VALUE_KEYWORDS);
  // wants_easy: explicit easy keyword, OR "ממוצע גבוה" in a positive (non-avoid) context.
  const wants_easy = hasAny(EASY_KEYWORDS) || /ממוצע\s+גבוה/.test(lower);

  return {
    interest_terms: [...interestSet],
    avoid_terms: [...avoidSet],
    grade_target,
    wants_practical: wants_practical || undefined,
    wants_industry_value: wants_industry_value || undefined,
    wants_easy: wants_easy || undefined,
    raw_text: raw,
  };
}

// ── 1b. explicit course-NAME avoid resolution ───────────────────────────────

/**
 * Issue C — normalize a course name for tolerant matching: lowercase, fold the
 * common Hebrew level-letter suffixes (א'/ב'/ג'/ד') to digits, strip
 * parentheses/quotes/punctuation, collapse whitespace. General — not specific
 * to any course.
 */
export function normalizeCourseName(name?: string | null): string {
  if (!name) return '';
  let s = String(name).toLowerCase();
  // Fold standalone Hebrew ordinal-letter level suffixes to digits. \b does not
  // work for Hebrew letters, so anchor on a space/start boundary + optional
  // geresh, treating the letter as a separate token.
  s = s.replace(/(^|\s)ב['׳]?(?=\s|$)/g, ' 2 ').replace(/(^|\s)א['׳]?(?=\s|$)/g, ' 1 ')
       .replace(/(^|\s)ג['׳]?(?=\s|$)/g, ' 3 ').replace(/(^|\s)ד['׳]?(?=\s|$)/g, ' 4 ');
  s = s.replace(/[()[\]{}.,;:!?"״'׳`\-–—_]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Issue 1 — data-driven course eligibility / exclusion config (server mirror of
 * the client EXCLUDED_* config). General + extensible (regex/substring list).
 *   - EXCLUDED_COURSE_NAME_PATTERNS: name substrings marking honors-only courses
 *     (e.g. "מצטיינים"); only eligible when the student is an honors student.
 *   - EXCLUDED_COURSE_NAMES: explicit course names excluded for everyone for now.
 */
export const EXCLUDED_COURSE_NAME_PATTERNS = ['מצטיינים'];
export const EXCLUDED_COURSE_NAMES = ['פרויקט יישומי בהנדסה מכנית'];

export interface EligibilityPrefs {
  is_honors_student?: boolean | null;
}

/**
 * Issue 1 — is a course eligible for this student?
 * False when (a) name matches an honors pattern AND !is_honors_student, or
 * (b) name matches the explicit excluded list. By name match (uses
 * normalizeCourseName), so it generalizes to any matching course.
 */
export function isCourseEligible(
  course: { name_he?: string | null; name?: string | null } | null | undefined,
  prefs?: EligibilityPrefs | null,
): boolean {
  if (!course) return true;
  const name = course.name_he || course.name || '';
  if (!name) return true;
  const isHonors = !!(prefs && prefs.is_honors_student);
  for (const pat of EXCLUDED_COURSE_NAME_PATTERNS) {
    if (name.includes(pat) && !isHonors) return false;
  }
  const norm = normalizeCourseName(name);
  for (const ex of EXCLUDED_COURSE_NAMES) {
    const exNorm = normalizeCourseName(ex);
    if (exNorm && norm.includes(exNorm)) return false;
  }
  return true;
}

/** Issue 1 — resolve the set of ineligible course IDs by name match. */
export function resolveIneligibleCourseIds(
  courses: Array<{ course_id: string; name_he?: string | null; name?: string | null }>,
  prefs?: EligibilityPrefs | null,
): Set<string> {
  const result = new Set<string>();
  for (const c of courses || []) {
    if (!c?.course_id) continue;
    if (!isCourseEligible(c, prefs)) result.add(c.course_id);
  }
  return result;
}

const NAME_AVOID_TRIGGERS = [
  'לא רוצה', 'לא מעוניין', 'לא מעוניינת', 'בלי', 'להימנע מ', 'להימנע',
  'אל תשבץ', 'אל תכלול', 'לא', 'don\'t want', 'do not want', 'avoid', 'without', 'no ',
];

/**
 * Issue C — detect explicit course-NAME avoid phrases in free text and resolve
 * them to course_id(s) by matching against the provided course list's name_he,
 * tolerant of the (2)/2/ב' suffix and parentheses. Returns the set of
 * explicitly-avoided ids. General: matches any named course.
 */
export function resolveAvoidedCourseIds(
  text: string | null | undefined,
  courses: Array<{ course_id: string; name_he?: string | null }>,
): Set<string> {
  const result = new Set<string>();
  if (!text || !courses?.length) return result;
  const lower = String(text).toLowerCase();
  if (!NAME_AVOID_TRIGGERS.some(t => lower.includes(t))) return result;

  const normText = normalizeCourseName(text);
  for (const c of courses) {
    if (!c?.name_he) continue;
    const norm = normalizeCourseName(c.name_he);
    if (norm.length < 3) continue;
    if (normText.includes(norm)) result.add(c.course_id);
  }
  return result;
}

// ── 2. buildCourseSearchText ────────────────────────────────────────────────

export function buildCourseSearchText(course: CourseLike): string {
  if (!course) return '';
  const parts: string[] = [];
  if (course.name_he) parts.push(course.name_he);
  if (course.syllabus_summary_he) parts.push(course.syllabus_summary_he);
  if (course.syllabus_topics_he && course.syllabus_topics_he.length) {
    parts.push(course.syllabus_topics_he.join(' '));
  }
  if (course.syllabus_assessment_he) parts.push(course.syllabus_assessment_he);
  if (course.syllabus_structure_he) parts.push(course.syllabus_structure_he);
  if (course.program_category_name_he) parts.push(course.program_category_name_he);
  if (course.course_type) parts.push(course.course_type);
  return parts.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

// ── 3. lexicalRelevance ─────────────────────────────────────────────────────

/** Returns true if normalized `interest` matches any normalized `courseTok`
 *  in `courseTokens`. For interest tokens >=4 chars long, a substring match
 *  is also acceptable (so "תנוד" matches inside compound words and
 *  "מערכות" matches inside "מערכותבקרה" if the course writes that as one
 *  token, etc.). Shorter tokens require exact normalized equality. */
function matchToken(interestNorm: string, courseTokens: Set<string>, courseNormSet: Set<string>): boolean {
  if (courseNormSet.has(interestNorm)) return true;
  if (interestNorm.length >= 4) {
    for (const ct of courseTokens) {
      if (ct.includes(interestNorm)) return true;
    }
    for (const ct of courseNormSet) {
      if (ct.includes(interestNorm)) return true;
    }
  }
  return false;
}

const INTEREST_HIT_CAP = 5;

export function lexicalRelevance(
  courseText: string,
  prefs: { interest_terms: string[]; avoid_terms: string[] },
): LexicalRelevance {
  if (!courseText) return { score: 0, matched_terms: [], avoided_terms: [] };

  const rawTokens = tokenize(courseText);
  const courseTokens = new Set(rawTokens);
  const courseNormSet = new Set(rawTokens.map(normalizeToken));

  const matched: string[] = [];
  const avoided: string[] = [];

  for (const term of prefs.interest_terms || []) {
    const n = normalizeToken(term);
    if (!n) continue;
    if (matchToken(n, courseTokens, courseNormSet)) {
      matched.push(term);
    }
  }
  for (const term of prefs.avoid_terms || []) {
    const n = normalizeToken(term);
    if (!n) continue;
    if (matchToken(n, courseTokens, courseNormSet)) {
      avoided.push(term);
    }
  }

  const interestHits = Math.min(matched.length, INTEREST_HIT_CAP);
  const score = interestHits * 1 - avoided.length * 1.5;
  return { score, matched_terms: matched, avoided_terms: avoided };
}

// ── 4. courseUtility ────────────────────────────────────────────────────────

const UTILITY_PRIMARY = ['מעבדה', 'פרויקט', 'סדנה', 'תכן', 'ניסוי', 'יישום'];
const UTILITY_SECONDARY = ['דוח', 'מצגת', 'יישומי', 'תעשייה', 'סימולציה'];

const UTILITY_LABEL_HE: Record<string, string> = {
  'מעבדה': 'מעבדה',
  'פרויקט': 'פרויקט',
  'סדנה': 'סדנה',
  'תכן': 'תכן/עיצוב',
  'ניסוי': 'ניסויים',
  'יישום': 'יישום',
  'דוח': 'דוחות',
  'מצגת': 'מצגת',
  'יישומי': 'תוכן יישומי',
  'תעשייה': 'זיקה לתעשייה',
  'סימולציה': 'סימולציות',
};

export function courseUtility(course: CourseLike): CourseUtility {
  const summary = (course.syllabus_summary_he || '').toLowerCase();
  const assessment = (course.syllabus_assessment_he || '').toLowerCase();
  const name = (course.name_he || '').toLowerCase();
  const combined = `${name} ${summary} ${assessment}`;

  let score = 0;
  const reasons: string[] = [];
  const seen = new Set<string>();

  // +1.0 once if any primary keyword hits in name/summary/assessment.
  for (const kw of UTILITY_PRIMARY) {
    if (combined.includes(kw)) {
      if (!seen.has('__primary')) {
        score += 1.0;
        seen.add('__primary');
      }
      const label = UTILITY_LABEL_HE[kw] || kw;
      if (!reasons.includes(label)) reasons.push(label);
    }
  }

  // +0.5 once if any secondary keyword hits in summary/assessment.
  for (const kw of UTILITY_SECONDARY) {
    if (summary.includes(kw) || assessment.includes(kw)) {
      if (!seen.has('__secondary')) {
        score += 0.5;
        seen.add('__secondary');
      }
      const label = UTILITY_LABEL_HE[kw] || kw;
      if (!reasons.includes(label)) reasons.push(label);
    }
  }

  // +0.5 if summary is informative.
  if ((course.syllabus_summary_he || '').length > 200) score += 0.5;

  // +0.3 if topics list is rich.
  if ((course.syllabus_topics_he?.length ?? 0) >= 5) score += 0.3;

  // -0.5 boilerplate detection: starts with "שעות: N" or summary essentially empty.
  const summaryRaw = (course.syllabus_summary_he || '').trim();
  if (summaryRaw.length > 0 && summaryRaw.length < 50) score -= 0.5;
  if (/^שעות[: ]+\d/.test(summaryRaw)) score -= 0.5;

  // Cap.
  if (score > 2.5) score = 2.5;
  if (score < -1) score = -1;

  return { score, reasons };
}

// ── 5. buildSelectionReason ─────────────────────────────────────────────────

export interface BuildSelectionReasonArgs {
  course?: CourseLike;
  matched_terms?: string[];
  utility_reasons?: string[];
  category?: string | null;
  grade_target?: number | null;
  grade_average?: number | null;
}

export function buildSelectionReason(args: BuildSelectionReasonArgs): string {
  const parts: string[] = [];

  if (args.matched_terms && args.matched_terms.length) {
    const shown = args.matched_terms.slice(0, 4).join(', ');
    parts.push(`מתאים לבקשה (מילים שתואמו: ${shown})`);
  }

  if (args.utility_reasons && args.utility_reasons.length) {
    parts.push(`כולל ${args.utility_reasons.slice(0, 4).join(', ')}`);
  }

  if (args.category) {
    parts.push(`ממלא דרישה בקטגוריית ${args.category}`);
  }

  if (args.grade_target != null && args.grade_average != null) {
    if (args.grade_average >= args.grade_target) {
      parts.push(`ממוצע היסטורי ${args.grade_average} עומד ביעד (${args.grade_target}+)`);
    } else {
      parts.push(`ממוצע היסטורי ${args.grade_average} מתחת ליעד שביקשת (${args.grade_target}+)`);
    }
  }

  if (!parts.length) return 'נבחר על בסיס התאמה כללית';
  return parts.join(' • ');
}
