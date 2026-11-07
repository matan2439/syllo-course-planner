/** Catalog facts remain tied to the published board, never to edited placements. */
import { parsePrerequisiteExpression, type PrerequisiteExpression } from './prerequisite-expression';

export interface DegreeCatalogFacts {
  courseHours: Record<string, number | null>;
  mandatorySemesters: Record<string, string>;
  prerequisiteExpressions?: Record<string, PrerequisiteExpression | null>;
}

export function degreeCatalogFacts(
  board: unknown,
  earlyCourses: readonly { courseId: string; semesterId: string; creditHours: number }[] = [],
): DegreeCatalogFacts {
  const facts: DegreeCatalogFacts = { courseHours: {}, mandatorySemesters: {}, prerequisiteExpressions: {} };
  for (const course of earlyCourses) {
    facts.courseHours[course.courseId] = course.creditHours;
    facts.mandatorySemesters[course.courseId] = course.semesterId;
  }
  if (!board || typeof board !== 'object') return facts;
  const raw = board as { semesters?: unknown; metadata?: { program_repository_courses?: unknown } };
  const readCourse = (value: unknown, semester?: string) => {
    if (!value || typeof value !== 'object') return;
    const course = value as Record<string, unknown>;
    const id = course.course_id;
    if (typeof id !== 'string' || !id) return;
    const hours = course.weekly_hours;
    facts.courseHours[id] = typeof hours === 'number' && Number.isFinite(hours) && hours >= 0 ? hours : null;
    // A missing list is unknown. Only an explicit legacy array can mean empty AND.
    facts.prerequisiteExpressions![id] = parsePrerequisiteExpression(course.prerequisite_expression === undefined &&
      Array.isArray(course.prerequisites) ? { all_of: course.prerequisites.map(course_id => ({ course_id })) }
      : course.prerequisite_expression);
    if (semester && (course.is_mandatory === true || course.course_type === 'mandatory')) {
      facts.mandatorySemesters[id] = semester;
    }
  };
  if (Array.isArray(raw.metadata?.program_repository_courses)) {
    raw.metadata.program_repository_courses.forEach(course => readCourse(course));
  }
  if (Array.isArray(raw.semesters)) for (const value of raw.semesters) {
    if (!value || typeof value !== 'object') continue;
    const semester = value as { semester_id?: unknown; courses?: unknown };
    if (typeof semester.semester_id === 'string' && Array.isArray(semester.courses)) {
      semester.courses.forEach(course => readCourse(course, semester.semester_id as string));
    }
  }
  return facts;
}
