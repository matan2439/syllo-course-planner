/** Shared types and system-prompt builder for the course-planner AI endpoint. */

export interface CourseInPlan {
  course_id: string;
  name_he?: string;
  hours?: number;
  difficulty_level?: string;
  difficulty_score?: number;
  course_type?: string;
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

export interface PlanContext {
  program_name?: string;
  semesters: SemesterPlan[];
  mandatory_unplaced?: Array<{ course_id: string; name_he?: string; hours?: number }>;
  requirements_progress?: RequirementsProgress;
  prerequisite_issues?: PrereqIssue[];
  grade_signals?: Record<string, {
    average_grade?: number;
    median_grade?: number | null;
    pass_rate?: number | null;
    num_students_total?: number;
  }>;
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

function semestersSection(semesters: SemesterPlan[]): string {
  if (!semesters.length) return 'אין קורסים משובצים עדיין.';
  return semesters.map(sem => {
    const overloaded = sem.total_hours >= 16 ? ' ⚠ עומס גבוה' : '';
    const courseLines = sem.courses.map(c => {
      const parts: string[] = [`  • ${c.name_he || c.course_id} (${c.course_id})`];
      if (c.hours != null) parts.push(`${c.hours} ש"ש`);
      if (c.course_type) parts.push(c.course_type === 'mandatory' ? 'חובה' : 'בחירה');
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
  ];

  if (ctx.grade_signals && Object.keys(ctx.grade_signals).length) {
    sections.push('', gradeSignalsSection(ctx.grade_signals));
  }

  if (course_context) {
    sections.push('', '### פרטי קורס ספציפי', course_context);
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
