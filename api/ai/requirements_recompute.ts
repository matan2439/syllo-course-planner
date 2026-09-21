/**
 * Recomputes the degree-requirements snapshot (`program_requirements_validation`) for ANY plan.
 *
 * The shipped board JSON carries this snapshot for the base board only, so after a manual edit or a
 * proposal the client-side badge would keep showing the base numbers. The rules must not be
 * re-implemented in React, so the server does it: this is a line-for-line port of
 * `validate_program_plan` in app/analysis/program_requirements.py (same inputs, same Hebrew strings,
 * same rounding). tests/api/requirements_recompute.test.ts checks it against Python-generated golden
 * output, so the two cannot drift silently.
 *
 * Returns null (caller keeps the base snapshot) whenever the board does not carry every input the
 * check needs - e.g. a board generated before `is_core` / `mandatory_course_ids` were emitted.
 */

// A type alias (not an interface) so it is assignable to the wire schema's passthrough shape.
export type RecomputedRequirements = {
  valid: boolean;
  total_required_hours: number;
  planned_hours: number;
  unknown_hours_courses: number;
  remaining_hours: number;
  core_courses_total_min: number;
  core_courses_selected: number;
  core_courses_satisfied: boolean;
  category_results: Array<{
    category_id: string;
    name_he: string;
    min_courses: number;
    needs_review: boolean;
    selected_courses: string[];
    selected_count: number;
    satisfied: boolean;
    missing_count: number;
  }>;
  missing_mandatory_courses: string[];
  missing_required_categories: string[];
  warnings: string[];
  explanation: string;
};

interface CategoryBlock {
  category_id: string;
  name_he?: string;
  min_courses?: number;
  needs_review?: boolean;
  is_core: boolean;
  course_ids: string[];
}

/** Mirrors eligibility_engine.normalize_course_id: 8 digits -> 'xxxx-xxxx', anything else unchanged. */
export function normalizeCourseIdLikePython(courseId: string): string {
  const digits = courseId.replace(/\D/g, '');
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : courseId;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

export function recomputeRequirements(
  boardJson: any,
  semesters: ReadonlyArray<{ semesterId: string; courseIds: readonly string[] }>,
): RecomputedRequirements | null {
  const meta = boardJson?.metadata;
  const block = meta?.program_requirements_categories;
  // Only boards that ship a base snapshot show a badge at all; without one there is nothing to refresh.
  if (!meta?.program_requirements_validation || !block) return null;
  const totalHours = block.total_required_hours;
  const coreTotalMin = block.core_courses_total_min;
  if (typeof totalHours !== 'number' || typeof coreTotalMin !== 'number') return null;
  if (!Array.isArray(block.mandatory_course_ids) || !Array.isArray(block.categories)) return null;
  const categories = block.categories as CategoryBlock[];
  if (categories.some((c) => typeof c.is_core !== 'boolean' || !Array.isArray(c.course_ids))) return null;

  // Weekly hours per course: what is on the base board first, then the elective universe.
  const hoursById = new Map<string, number | null>();
  const remember = (course: any) => {
    if (!course?.course_id) return;
    const id = normalizeCourseIdLikePython(String(course.course_id));
    if (hoursById.has(id) && hoursById.get(id) !== null) return;
    hoursById.set(id, typeof course.weekly_hours === 'number' ? course.weekly_hours : null);
  };
  for (const semester of boardJson.semesters ?? []) for (const course of semester.courses ?? []) remember(course);
  for (const course of meta.program_repository_courses ?? []) remember(course);

  const plannedIds = new Set<string>();
  let plannedHours = 0;
  let unknownHoursCount = 0;
  for (const semester of semesters) {
    for (const rawId of semester.courseIds) {
      if (!rawId) continue;
      const id = normalizeCourseIdLikePython(rawId);
      plannedIds.add(id);
      const hours = hoursById.get(id);
      if (typeof hours === 'number') plannedHours += hours;
      else unknownHoursCount += 1;
    }
  }

  const completed = new Set<string>((meta.completed_course_ids ?? []).map((c: string) => normalizeCourseIdLikePython(String(c))));
  const allCourseIds = new Set<string>([...completed, ...plannedIds]);

  const mandatoryIds = (block.mandatory_course_ids as string[]).map((c) => normalizeCourseIdLikePython(String(c)));
  const missingMandatory = mandatoryIds.filter((id) => !allCourseIds.has(id));

  const categoryResults: RecomputedRequirements['category_results'] = [];
  const missingRequiredCategories: string[] = [];
  let coreSelected = 0;
  for (const cat of categories) {
    const minCourses = cat.min_courses ?? 1;
    const needsReview = Boolean(cat.needs_review);
    const pool = new Set(cat.course_ids.map((c) => normalizeCourseIdLikePython(String(c))));
    const selected = [...allCourseIds].filter((id) => pool.has(id)).sort();
    const count = selected.length;
    const satisfied = count >= minCourses;
    if (cat.is_core) coreSelected += count;
    if (minCourses > 0 && !needsReview && !satisfied) missingRequiredCategories.push(cat.category_id);
    categoryResults.push({
      category_id: cat.category_id,
      name_he: cat.name_he ?? cat.category_id,
      min_courses: minCourses,
      needs_review: needsReview,
      selected_courses: selected,
      selected_count: count,
      satisfied,
      missing_count: Math.max(0, minCourses - count),
    });
  }

  const coreSatisfied = coreSelected >= coreTotalMin;
  if (!coreSatisfied) missingRequiredCategories.push('core_total');

  const warnings: string[] = [];
  if (unknownHoursCount > 0) {
    warnings.push(`חלק מהשעות אינן ידועות ולכן חישוב המכסה חלקי (${unknownHoursCount} קורסים ללא שעות)`);
  }
  if (missingMandatory.length > 0) warnings.push(`קורסי חובה חסרים: ${missingMandatory.join(', ')}`);
  for (const catId of missingRequiredCategories) {
    if (catId === 'core_total') {
      warnings.push(`נדרשים לפחות ${coreTotalMin} קורסי ליבה; נבחרו ${coreSelected}`);
    } else {
      const cat = categories.find((c) => c.category_id === catId);
      warnings.push(`קטגוריה לא הושלמה: ${cat ? (cat.name_he ?? catId) : catId}`);
    }
  }

  const valid = missingMandatory.length === 0 && missingRequiredCategories.length === 0;
  let explanation: string;
  if (valid) {
    explanation = 'כל דרישות הקטגוריות מסופקות.';
  } else {
    const parts: string[] = [];
    if (missingMandatory.length > 0) parts.push(`${missingMandatory.length} קורסי חובה חסרים`);
    const realMissing = missingRequiredCategories.filter((c) => c !== 'core_total');
    if (realMissing.length > 0) parts.push(`${realMissing.length} קטגוריות לא הושלמו`);
    if (!coreSatisfied) parts.push(`קורסי ליבה: ${coreSelected}/${coreTotalMin}`);
    explanation = `דרישות לא מסופקות: ${parts.join('; ')}`;
  }

  return {
    valid,
    total_required_hours: totalHours,
    planned_hours: round1(plannedHours),
    unknown_hours_courses: unknownHoursCount,
    remaining_hours: round1(Math.max(0, totalHours - plannedHours)),
    core_courses_total_min: coreTotalMin,
    core_courses_selected: coreSelected,
    core_courses_satisfied: coreSatisfied,
    category_results: categoryResults,
    missing_mandatory_courses: missingMandatory,
    missing_required_categories: missingRequiredCategories,
    warnings,
    explanation,
  };
}
