/** Shared types and system-prompt builder for the course-planner AI endpoint. */

export interface CourseInPlan {
  course_id: string;
  name_he?: string;
  hours?: number;
  difficulty_level?: string;
  difficulty_score?: number;
  course_type?: string;
  /** 'fixed' = mandatory locked to its semester; 'flexible' = movable mandatory; 'elective'. */
  placement_policy?: string | null;
  /** Semesters this course may legally be placed in (for movability reasoning). */
  effective_allowed_semesters?: string[] | null;
  /** True for year-long (annual) courses that occupy BOTH spanned semesters
   *  together. They are immovable, must not be split, and their degree hours are
   *  counted once (count_hours_once) even though they appear in two semesters. */
  is_annual?: boolean;
  spans_semesters?: string[] | null;
  count_hours_once?: boolean;
  category?: string;
  missing_prerequisites?: string[];
  // Difficulty sub-scores (1-5 scale; null/missing if not yet computed)
  workload_score?: number | null;
  conceptual_complexity_score?: number | null;
  prerequisite_depth_score?: number | null;
  assessment_intensity_score?: number | null;
  difficulty_confidence?: number | null;
  // Assessment / syllabus availability — booleans/labels only, no URLs (keeps context compact)
  assessment_type?: string | null;
  has_syllabus?: boolean;
  has_syllabus_summary?: boolean;
  /** Phase 2B — concise syllabus content inlined into the prompt so the LLM
   *  can ground its answers in actual topic text rather than a yes/no flag. */
  syllabus_summary_he?: string | null;
  syllabus_topics_he?: string[] | null;
}

export interface SemesterPlan {
  id: string;
  label: string;
  courses: CourseInPlan[];
  total_hours: number;
}

export interface CategoryProgress {
  name: string;
  required: number;
  placed: number;
}

export interface RequirementsProgress {
  completed_hours: number;
  required_hours: number;
  categories: CategoryProgress[];
}

export interface PrereqIssue {
  course_id: string;
  name_he?: string;
  missing: string[];
}

/** A course the user has personally marked as completed, in progress, or planned. */
export interface PersonalStatusCourse {
  course_id: string;
  name_he?: string;
  semester_label?: string;
}

/** Personal academic status — distinct from the official board placement. */
export interface PersonalStatus {
  completed?: PersonalStatusCourse[];
  currently_taking?: PersonalStatusCourse[];
  planned?: PersonalStatusCourse[];
}

/** Prerequisite issues that arise specifically from the user's personal course status. */
export interface PersonalPrereqIssue {
  course_id: string;
  name_he?: string;
  issues: string[];
}

export interface PlanContext {
  program_name?: string;
  semesters: SemesterPlan[];
  mandatory_unplaced?: Array<{ course_id: string; name_he?: string; hours?: number }>;
  requirements_progress?: RequirementsProgress;
  prerequisite_issues?: PrereqIssue[];
  personal_status?: PersonalStatus;
  personal_prerequisite_issues?: PersonalPrereqIssue[];
  grade_signals?: Record<string, {
    average_grade?: number;
    median_grade?: number | null;
    pass_rate?: number | null;
    num_students_total?: number;
  }>;
  /** course_ids the user marked as "אל תזיז" — must stay in their current semester. */
  pinned_course_ids?: string[];
  /** User preferences carried over from the plan-generation UI, for chat context (PART F). */
  preferences?: {
    wanted_course_ids?: string[];
    unwanted_course_ids?: string[];
    extra_request_he?: string;
  };
  /** Semesters whose total_hours already exceed a typical weekly cap. */
  overload_warnings?: Array<{ semester_id: string; label: string; total_hours: number }>;
  /** Elective category requirements with eligible (not yet completed/scheduled) candidates. */
  category_requirements?: Array<{
    name: string;
    category_id?: string | null;
    required: number;
    placed: number;
    candidates: Array<{
      course_id: string;
      name_he?: string;
      hours?: number | null;
      has_syllabus_summary?: boolean;
      grade_average?: number | null;
      is_wanted?: boolean;
      /** Semesters this course may legally be placed in (PART A). */
      effective_allowed_semesters?: string[] | null;
      /** Raw syllabus/program offering data, if known. */
      offered_semesters?: string[] | null;
      /** Whether effective_allowed_semesters is high-confidence (syllabus-sourced). */
      offering_confident?: boolean;
    }>;
  }>;
  /** קורסי שער רוח (humanities) requirement — program-specific, distinct from engineering electives. */
  general_course_requirements?: {
    name: string;
    /** Required נק"ז for this category for the current program (e.g. 6 for Mechanical Engineering). */
    required_credits: number;
    candidates: Array<{
      course_id: string;
      name_he?: string;
      hours?: number | null;
      has_syllabus_summary?: boolean;
      grade_average?: number | null;
      is_wanted?: boolean;
    }>;
  };
  /** Progress toward the degree-hour requirement. */
  total_hours_progress?: {
    known_completed_hours: number;
    /**
     * Hours of currently_taking/planned personal-status courses that are NOT
     * placed on the board — prior progress accrued before any AI proposal.
     * Tracked separately from known_completed_hours so the canonical
     * degree-progress model can count them under
     * `currently_planned_before_proposal` exactly once (Phase 1 unification).
     */
    currently_planned_hours?: number;
    /** Program-specific total degree hours; defaults to 185 if omitted. */
    degree_required_hours?: number;
    /** Manually entered total completed-degree hours — preferred over known_completed_hours if present. */
    manual_completed_degree_hours?: number;
    /** קורסי שער/רוח hours required by the degree. */
    required_general_hours?: number;
    /** קורסי שער/רוח hours already completed. */
    completed_general_hours?: number;
  };
  /** Courses that may legally be moved between semesters (not pinned, not completed). */
  movable_courses?: Array<{
    course_id: string;
    name_he?: string;
    current_semester: string | null;
    hours?: number | null;
    effective_allowed_semesters?: string[] | null;
  }>;
}

/** Personal status entries can carry a known hours figure for degree-hour accounting. */
export interface PersonalStatusCourseWithHours extends PersonalStatusCourse {
  hours?: number | null;
}

export interface SystemPromptInput {
  program_id: string;
  plan_context: PlanContext;
  course_context?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Render a 1-5 sub-score compactly, or omit if unknown. */
function subScore(label: string, value: number | null | undefined): string | null {
  return value != null ? `${label} ${value}` : null;
}

/** Phase 2B — render a concise inline syllabus slice for a candidate course
 *  line: first ~200 chars of summary (truncated at a word boundary) plus up
 *  to 8 topics. Returns null when both inputs are empty. Total output is
 *  kept under ~250 chars per course to control prompt size. */
function renderInlineSyllabus(
  summary: string | null | undefined,
  topics: string[] | null | undefined,
): string | null {
  const parts: string[] = [];
  if (summary && summary.trim()) {
    let s = summary.trim().replace(/\s+/g, ' ');
    if (s.length > 200) {
      const slice = s.slice(0, 200);
      const lastSpace = slice.lastIndexOf(' ');
      s = (lastSpace > 120 ? slice.slice(0, lastSpace) : slice) + '...';
    }
    parts.push(`סילבוס: ${s}`);
  }
  if (topics && topics.length) {
    const shown = topics.slice(0, 8).map(t => t.trim()).filter(Boolean);
    if (shown.length) parts.push(`נושאים: ${shown.join(', ')}`);
  }
  if (!parts.length) return null;
  let joined = parts.join(' | ');
  if (joined.length > 250) joined = joined.slice(0, 247) + '...';
  return joined;
}

function semestersSection(semesters: SemesterPlan[]): string {
  if (!semesters.length) return 'אין קורסים משובצים עדיין.';
  return semesters.map(sem => {
    const overloaded = sem.total_hours >= 16 ? ' ⚠ עומס גבוה' : '';
    const courseLines = sem.courses.map(c => {
      const parts: string[] = [`  • ${c.name_he || c.course_id} (${c.course_id})`];
      if (c.hours != null) parts.push(`${c.hours} ש"ש`);
      if (c.course_type) parts.push(c.course_type === 'mandatory' ? 'חובה' : 'בחירה');
      // Flexibility token so the LLM knows which mandatory courses may be moved
      // for load balancing ('גמיש' = movable, 'קבוע' = locked to its semester).
      if (c.is_annual) {
        // Annual (year-long) course: occupies both spanned semesters together,
        // immovable, must not be split, degree hours counted once.
        parts.push("שנתי (א'+ב') — לא ניתן להזזה/פיצול, שעות נספרות פעם אחת");
      } else if (c.placement_policy === 'flexible') parts.push('גמיש');
      else if (c.placement_policy === 'fixed') parts.push('קבוע');
      if (c.category) parts.push(`קטגוריה: ${c.category}`);
      if (c.difficulty_level) parts.push(`קושי כולל: ${c.difficulty_level}${c.difficulty_score != null ? ` (${c.difficulty_score})` : ''}`);

      const subScores = [
        subScore('עומס', c.workload_score),
        subScore('מורכבות', c.conceptual_complexity_score),
        subScore('עומק דרישות קדם', c.prerequisite_depth_score),
        subScore('עצימות הערכה', c.assessment_intensity_score),
      ].filter(Boolean);
      if (subScores.length) parts.push(`(${subScores.join(', ')})`);

      if (c.assessment_type) parts.push(`סוג הערכה: ${c.assessment_type}`);
      if (c.has_syllabus === false) parts.push('אין סילבוס זמין');
      else {
        // Phase 2B — inline a small slice of actual syllabus content rather
        // than a bare "יש תקציר סילבוס זמין" flag. Capped at ~250 chars total
        // so prompt size stays controlled.
        const inlined = renderInlineSyllabus(c.syllabus_summary_he, c.syllabus_topics_he);
        if (inlined) parts.push(inlined);
        else if (c.has_syllabus_summary) parts.push('יש תקציר סילבוס זמין');
      }

      if (c.difficulty_confidence != null && c.difficulty_confidence < 0.6)
        parts.push('⚠ נתוני קושי חלקיים — אמינות נמוכה');

      if (c.missing_prerequisites?.length)
        parts.push(`⚠ דרישות קדם חסרות: ${c.missing_prerequisites.join(', ')}`);
      return parts.join(' | ');
    }).join('\n');
    return `**${sem.label}** (${sem.total_hours} ש"ש סה"כ)${overloaded}\n${courseLines}`;
  }).join('\n\n');
}

function mandatoryUnplacedSection(
  courses: Array<{ course_id: string; name_he?: string; hours?: number }> | undefined,
): string {
  if (!courses?.length) return 'כל קורסי החובה משובצים.';
  return courses
    .map(c => `  • ${c.name_he || c.course_id} — ${c.hours ?? '?'} ש"ש`)
    .join('\n');
}

function requirementsSection(req: RequirementsProgress | undefined): string {
  if (!req) return 'אין מידע על דרישות התואר.';
  const catLines = req.categories
    .map(cat => `  • ${cat.name}: ${cat.placed}/${cat.required} קורסים`)
    .join('\n');
  return (
    `שעות מתוכננות: ${req.completed_hours}/${req.required_hours} ש"ש\n` +
    (catLines || '  (אין קטגוריות)')
  );
}

function prereqIssuesSection(issues: PrereqIssue[] | undefined): string {
  if (!issues?.length) return 'לא זוהו בעיות דרישות קדם.';
  return issues
    .map(
      i =>
        `  • ${i.name_he || i.course_id}: חסרים ${i.missing.join(', ')}`,
    )
    .join('\n');
}

function personalStatusSection(status: PersonalStatus | undefined): string {
  if (!status) return 'לא הוזן מידע אישי על קורסים שהושלמו/נלמדים/מתוכננים.';

  const fmt = (list: PersonalStatusCourse[] | undefined): string =>
    !list?.length
      ? '  (אין)'
      : list
          .map(c => `  • ${c.name_he || c.course_id} (${c.course_id})${c.semester_label ? ` — ${c.semester_label}` : ''}`)
          .join('\n');

  return [
    'קורסים שהושלמו (סטטוס אישי):',
    fmt(status.completed),
    '',
    'קורסים הנלמדים כעת (סטטוס אישי):',
    fmt(status.currently_taking),
    '',
    'קורסים מתוכננים לסמסטרים עתידיים (סטטוס אישי):',
    fmt(status.planned),
  ].join('\n');
}

function personalPrereqIssuesSection(issues: PersonalPrereqIssue[] | undefined): string {
  if (!issues?.length) return 'לא זוהו בעיות דרישות קדם הנובעות מהסטטוס האישי.';
  return issues
    .map(i => `  • ${i.name_he || i.course_id}:\n${i.issues.map(m => `    - ${m}`).join('\n')}`)
    .join('\n');
}

function preferencesSection(prefs: PlanContext['preferences']): string | null {
  if (!prefs) return null;
  const lines: string[] = [];
  if (prefs.wanted_course_ids?.length) lines.push(`קורסים שהמשתמש רוצה לקחת: ${prefs.wanted_course_ids.join(', ')}`);
  if (prefs.unwanted_course_ids?.length) lines.push(`קורסים שהמשתמש מעדיף להימנע מהם: ${prefs.unwanted_course_ids.join(', ')}`);
  if (prefs.extra_request_he) lines.push(`בקשה כללית אחרונה מהמשתמש: ${prefs.extra_request_he}`);
  if (!lines.length) return null;
  return lines.join('\n');
}

function gradeSignalsSection(
  signals: PlanContext['grade_signals'],
): string {
  if (!signals || !Object.keys(signals).length) return '';
  const lines = Object.entries(signals)
    .map(([cid, s]) => {
      const parts = [`ממוצע ${s.average_grade ?? '?'}`];
      if (s.median_grade != null) parts.push(`חציון ${s.median_grade}`);
      if (s.pass_rate != null) parts.push(`אחוז עוברים ${Math.round(s.pass_rate * 100)}%`);
      parts.push(`${s.num_students_total ?? '?'} סטודנטים`);
      return `  • ${cid}: ${parts.join(', ')}`;
    })
    .join('\n');
  return `### נתוני ציונים היסטוריים (מ-Arazim TAU Refactor)\n${lines}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parses a few key fields out of the (free-text) course_context block and, if any
 * workload-relevant data is present, builds a short deterministic Hebrew summary
 * sentence. This makes it harder for the model to ignore hours/syllabus data when
 * answering workload questions, even if difficulty_score is missing.
 */
function buildWorkloadSummary(courseContext: string): string | null {
  const grab = (label: string): string | null => {
    const m = courseContext.match(new RegExp(`^${label}: (.+)$`, 'm'));
    return m ? m[1].trim() : null;
  };

  const parts: string[] = [];
  const semesterScope = grab('היקף לפי הסילבוס');
  const lecture  = grab('שעות הרצאה');
  const tutorial = grab('שעות תרגול');
  const lab      = grab('שעות מעבדה');
  const format   = grab('אופן הוראה');
  const hasSyllabus = /^תקציר סילבוס: /m.test(courseContext);

  if (semesterScope)        parts.push(semesterScope);
  if (lecture)               parts.push(`${lecture} שעות הרצאה`);
  if (tutorial)              parts.push(`${tutorial} שעות תרגול`);
  if (lab)                   parts.push(`${lab} שעות מעבדה`);
  if (format)                parts.push(`אופן הוראה: ${format}`);

  if (!parts.length && !hasSyllabus) return null;

  const lines: string[] = [];
  if (parts.length) lines.push(`לקורס זה קיימים נתוני עומס: ${parts.join(', ')}.`);
  if (hasSyllabus)  lines.push('בנוסף, קיים תקציר סילבוס עם נושאי לימוד, מבנה והערכה — יש להשתמש בו לתיאור אופי העומס (תיאורטי/מעבדה/פרויקט/הגשות).');
  lines.push('יש להשתמש במידע זה במענה על שאלות עומס, גם אם difficulty_score (ציון קושי מספרי) חסר.');
  return lines.join(' ');
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const { program_id, plan_context: ctx, course_context } = input;
  const programName = ctx.program_name || program_id;

  const sections = [
    `## תוכנית לימודים: ${programName}`,
    '',
    '### סמסטרים מתוכננים',
    semestersSection(ctx.semesters),
    '',
    '### קורסי חובה שטרם שובצו',
    mandatoryUnplacedSection(ctx.mandatory_unplaced),
    '',
    '### התקדמות לדרישות התואר',
    requirementsSection(ctx.requirements_progress),
    '',
    '### בעיות דרישות קדם',
    prereqIssuesSection(ctx.prerequisite_issues),
    '',
    '### סטטוס אישי (השלמה / לימוד נוכחי / תכנון אישי)',
    'הערה: הסטטוס האישי הוא בנוסף לשיבוץ הרשמי בלוח, ואינו משנה אותו. קורס',
    'יכול להופיע בלוח בסמסטר רשמי אחד, בעוד שהמשתמש לומד אותו בפועל בסמסטר אחר.',
    personalStatusSection(ctx.personal_status),
    '',
    '### בעיות דרישות קדם הנובעות מהסטטוס האישי',
    personalPrereqIssuesSection(ctx.personal_prerequisite_issues),
  ];

  if (ctx.grade_signals && Object.keys(ctx.grade_signals).length) {
    sections.push('', gradeSignalsSection(ctx.grade_signals));
  }

  const prefsSection = preferencesSection(ctx.preferences);
  if (prefsSection) {
    sections.push('', '### העדפות המשתמש', prefsSection);
  }

  if (course_context) {
    const workloadSummary = buildWorkloadSummary(course_context);
    sections.push('', '### פרטי קורס ספציפי', course_context);
    if (workloadSummary) sections.push('', '### סיכום נתוני עומס לקורס זה (לשימוש בתשובות על עומס)', workloadSummary);
  }

  const planBlock = sections.join('\n');

  return `אתה עוזר AI חכם לתכנון לימודים באוניברסיטת תל-אביב.

## כללים
1. ענה תמיד בעברית ברורה ותמציתית.
2. אל תמציא עובדות על קורסים — השתמש אך ורק במידע שסופק לך.
3. כאשר מידע חסר (ציונים, סילבוס, סוג הגשה, ציוני קושי), ציין זאת במפורש ואל תנחש.
4. המלצות הן ייעוציות בלבד — לא ייעוץ אקדמי רשמי.
5. אל תציע לשנות קורסי חובה נעולים — רק התייחס אליהם כעובדה קיימת.
6. אם אין לך מספיק מידע לענות, אמור זאת בפירוש.
7. תהיה ספציפי: ציין שמות קורסים ומספרי קורס, ושימוש במספרים בפועל מהתוכנית
   (שעות שבועיות, ציוני קושי, ממוצעים) ולא תיאורים כלליים.
8. סמסטר עם 16 ש"ש ומעלה מסומן "⚠ עומס גבוה" — אם נשאלת על איזון התוכנית,
   ציין במפורש אילו סמסטרים עמוסים ואילו קורסים ספציפיים תורמים לכך
   (למשל קורסים עם עומס/מורכבות גבוהים או הרבה שעות שבועיות).
9. שים לב לשילובים מסוכנים: כמה קורסים עם ציוני "מורכבות" או "עומס" גבוהים
   באותו סמסטר, או קורס קשה לצד עומס שעות גבוה.
10. אם נשאלת על דרישות התואר, התבסס על "התקדמות לדרישות התואר" ועל
    "קורסי חובה שטרם שובצו" כדי לציין מה עוד חסר.
11. אם בפרטי הקורס הספציפי מופיע "תקציר סילבוס" (syllabus_summary_he) ושדות
    סילבוס נוספים (נושאי לימוד, דרישות קדם, מטלות/הערכה, מבנה הקורס) — השתמש
    במידע זה כדי לענות על שאלות אודות תוכן הקורס. אל תאמר שאין מידע מהסילבוס
    אם תקציר כזה סופק. אל תמציא פרטים מעבר למה שכתוב בתקציר.
12. אם נכתב במפורש "הסילבוס לא פורסם/לא זמין במערכת" — ציין זאת בפירוש ואל
    תנחש מה מכיל הסילבוס. אך המשך לענות על סמך מידע אחר שכן קיים (קטגוריה,
    שעות שבועיות אם ידועות, ציונים, דרישות קדם).
12a. חוסר במידע על "שעות שבועיות" או "רמת קושי" אינו אומר שאין תקציר סילבוס —
    בדוק את שדה "תקציר סילבוס" בנפרד. אם קיים תקציר סילבוס, ענה על שאלות תוכן
    ומבנה ממנו גם אם נתוני שעות/קושי חסרים.
12b. בשאלות על רמת קושי כאשר נתוני הקושי חסרים: אל תאמר "אין מידע" סתם —
    ענה על סמך מה שכן קיים (תקציר סילבוס, נתוני ציונים/ממוצעים אם יש, ודרישות
    קדם), וציין במפורש שציון קושי מספרי אינו זמין לקורס זה.
12c. בשאלות על עומס הקורס ("כמה שעות מעבדה", "מה סוג העומס", וכדומה): היעדר
    difficulty_score / ציון קושי כולל אינו אומר שאין מידע על עומס. השתמש בכל
    הנתונים הזמינים — שעות סמסטריאליות, שעות הרצאה/תרגול/מעבדה, אופן הוראה,
    תקציר/נושאי/מבנה/הערכת הסילבוס, ונתוני ציונים — כדי לתאר את העומס בפועל.
    אמור "אין מדד קושי מספרי לקורס זה" רק כאשר difficulty_score אכן חסר, ואל
    תאמר "אין מידע על העומס" אם קיימים נתוני שעות ו/או תקציר סילבוס.
13. הבחן תמיד בין שיבוץ רשמי בלוח (כולל placement_policy וה-recommended_semester)
    לבין הסטטוס האישי של המשתמש (קורסים שהושלמו, נלמדים כעת, או מתוכננים אישית).
    אל תניח שקורס "הושלם" רק כי הוא מופיע בסמסטר מוקדם בלוח הרשמי — התבסס אך ורק
    על המידע בסעיף "סטטוס אישי".
14. אם המשתמש מבקש במפורש שינוי קונקרטי בתוכנית (למשל "תחליף לי את הקורס הזה
    במשהו יותר קשור לתכן", "תוריד עומס מסמסטר ג׳ ב׳", "הוסף לי קורס X"), הצע
    שינוי קונקרטי: לאחר ההסבר בעברית, צרף בלוק קוד JSON יחיד בפורמט הבא,
    עם השיבוץ המלא והמעודכן של *כל* הסמסטרים (כולל סמסטרים שלא השתנו):
    \`\`\`json
    {"semesters":[{"semester_id":"year_3_semester_a","course_ids":["..."]}, ...],"rationale_he":"הסבר קצר"}
    \`\`\`
    semester_id חייב להיות אחד מ: year_3_semester_a, year_3_semester_b, year_4_semester_a, year_4_semester_b.
    course_ids הם מספרי קורס בלבד (כפי שהופיעו בנתוני התוכנית). אל תכלול את בלוק
    ה-JSON אם המשתמש רק שואל שאלה ולא מבקש שינוי בתוכנית.

## נתוני התוכנית הנוכחית

${planBlock}`;
}

/** Summarise total hours per semester for context or tools. */
export function computeSemesterLoads(
  semesters: SemesterPlan[],
): Array<{ id: string; label: string; total_hours: number; course_count: number }> {
  return semesters.map(sem => ({
    id: sem.id,
    label: sem.label,
    total_hours: sem.total_hours,
    course_count: sem.courses.length,
  }));
}

/** Return courses belonging to a given category across all semesters. */
export function findCoursesByCategory(
  semesters: SemesterPlan[],
  categoryId: string,
): CourseInPlan[] {
  return semesters.flatMap(sem =>
    sem.courses.filter(c => c.category === categoryId || c.course_type === categoryId),
  );
}

/** Collect all prerequisite issues across the plan. */
export function checkPrerequisites(semesters: SemesterPlan[]): PrereqIssue[] {
  return semesters
    .flatMap(sem => sem.courses)
    .filter(c => c.missing_prerequisites && c.missing_prerequisites.length > 0)
    .map(c => ({
      course_id: c.course_id,
      name_he: c.name_he,
      missing: c.missing_prerequisites!,
    }));
}

/** Return categories where placed < required. */
export function findMissingDegreeRequirements(
  progress: RequirementsProgress | undefined,
): CategoryProgress[] {
  if (!progress) return [];
  return progress.categories.filter(cat => cat.placed < cat.required);
}
