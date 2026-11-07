/** Catalog facts remain tied to the published board, never to edited placements. */
import { parsePrerequisiteExpression, type PrerequisiteExpression } from './prerequisite-expression';

export interface DegreeCatalogFacts {
  courseHours: Record<string, number | null>;
  mandatorySemesters: Record<string, string>;
  prerequisiteExpressions?: Record<string, PrerequisiteExpression | null>;
  trackCandidateIds?: string[];
}

function recordMandatoryHome(homes: Record<string, string>, id: string, home: string): void {
  const previous = homes[id];
  const year = /^year_([1-9]\d*)_semester_[ab]$/.exec(home)?.[1];
  const priorYear = previous && /^year_([1-9]\d*)_semester_[ab]$/.exec(previous)?.[1];
  homes[id] = previous && (!year || !priorYear || year !== priorYear) ? 'unknown' : home;
}

export function degreeCatalogFacts(
  board: unknown,
  earlyCourses: readonly { courseId: string; semesterId: string; creditHours: number }[] = [],
): DegreeCatalogFacts {
  const facts: DegreeCatalogFacts = { courseHours: {}, mandatorySemesters: {}, prerequisiteExpressions: {} };
  for (const course of earlyCourses) {
    facts.courseHours[course.courseId] = course.creditHours;
    recordMandatoryHome(facts.mandatorySemesters, course.courseId, course.semesterId);
  }
  if (!board || typeof board !== 'object') return facts;
  const raw = board as { semesters?: unknown; metadata?: { program_repository_courses?: unknown;
    program_requirements_categories?: { categories?: unknown }; degree_rule_track_course_ids?: unknown;
    degree_rule_mandatory_semesters?: unknown } };
  const homes = raw.metadata?.degree_rule_mandatory_semesters;
  if (homes && typeof homes === 'object' && !Array.isArray(homes)) {
    for (const [id, home] of Object.entries(homes)) {
      if (typeof home === 'string' && /^year_[1-9]\d*_semester_[ab]$/.test(home)) recordMandatoryHome(facts.mandatorySemesters, id, home);
    }
  }
  const trackPool = new Set<string>();
  let hasTrackPool = false;
  if (Array.isArray(raw.metadata?.degree_rule_track_course_ids)) {
    hasTrackPool = true;
    raw.metadata.degree_rule_track_course_ids.forEach(id => { if (typeof id === 'string') trackPool.add(id); });
  }
  const categories = raw.metadata?.program_requirements_categories?.categories;
  if (Array.isArray(categories)) for (const category of categories) {
    if (category?.group === 'track' && Array.isArray(category.course_ids)) {
      hasTrackPool = true;
      category.course_ids.forEach((id: unknown) => { if (typeof id === 'string') trackPool.add(id); });
    }
  }
  if (hasTrackPool) facts.trackCandidateIds = [...trackPool];
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
      recordMandatoryHome(facts.mandatorySemesters, id, semester);
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

/** Both window catalogs are evidence. Conflicting facts stay unknown. */
export function mergeDegreeCatalogFacts(catalogs: readonly DegreeCatalogFacts[]): DegreeCatalogFacts {
  const merged: DegreeCatalogFacts = { courseHours: {}, mandatorySemesters: {}, prerequisiteExpressions: {} };
  const track = new Set<string>();
  for (const catalog of catalogs) {
    for (const [id, hours] of Object.entries(catalog.courseHours)) {
      merged.courseHours[id] = Object.prototype.hasOwnProperty.call(merged.courseHours, id) && merged.courseHours[id] !== hours ? null : hours;
    }
    for (const [id, expression] of Object.entries(catalog.prerequisiteExpressions ?? {})) {
      merged.prerequisiteExpressions![id] = Object.prototype.hasOwnProperty.call(merged.prerequisiteExpressions, id) &&
        JSON.stringify(merged.prerequisiteExpressions![id]) !== JSON.stringify(expression) ? null : expression;
    }
    for (const [id, home] of Object.entries(catalog.mandatorySemesters)) recordMandatoryHome(merged.mandatorySemesters, id, home);
    if (catalog.trackCandidateIds) {
      catalog.trackCandidateIds.forEach(id => track.add(id));
      merged.trackCandidateIds = [...track];
    }
  }
  return merged;
}
