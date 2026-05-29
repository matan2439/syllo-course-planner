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
  grade_signals?: Record<string, { average_grade?: number; num_students_total?: number }>;
}

export interface SystemPromptInput {
  program_id: string;
  plan_context: PlanContext;
  course_context?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function semestersSection(semesters: SemesterPlan[]): string {
  if (!semesters.length) return 'אין קורסים משובצים עדיין.';
  return semesters.map(sem => {
    const courseLines = sem.courses.map(c => {
      const parts: string[] = [`  • ${c.name_he || c.course_id} (${c.course_id})`];
      if (c.hours != null) parts.push(`${c.hours} ש"ש`);
      if (c.difficulty_level) parts.push(`קושי: ${c.difficulty_level}`);
      if (c.category) parts.push(`קטגוריה: ${c.category}`);
      if (c.missing_prerequisites?.length)
        parts.push(`⚠ דרישות קדם חסרות: ${c.missing_prerequisites.join(', ')}`);
      return parts.join(' | ');
    }).join('\n');
    return `**${sem.label}** (${sem.total_hours} ש"ש סה"כ)\n${courseLines}`;
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
  signals: Record<string, { average_grade?: number; num_students_total?: number }> | undefined,
): string {
  if (!signals || !Object.keys(signals).length) return '';
  const lines = Object.entries(signals)
    .map(([cid, s]) => `  • ${cid}: ממוצע ${s.average_grade ?? '?'} (${s.num_students_total ?? '?'} סטודנטים)`)
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
3. כאשר מידע חסר (ציונים, סילבוס, סוג הגשה), ציין זאת במפורש.
4. המלצות הן ייעוציות בלבד — לא ייעוץ אקדמי רשמי.
5. אל תציע לשנות קורסי חובה נעולים — רק התייחס אליהם כעובדה קיימת.
6. אם אין לך מספיק מידע לענות, אמור זאת בפירוש.

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
