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
  core_courses_total_min: number | null;
  core_courses_selected: number | null;
  core_courses_satisfied: boolean | null;
  group_results?: Array<{ group: string; min_courses: number; selected_courses: string[]; selected_count: number; satisfied: boolean; missing_count: number }>;
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
  group?: string;
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

/**
 * plan_context.completed_category_counts — courses the student completed in a category without
 * naming them (e.g. how many שער רוח courses) — keeping only positive whole counts.
 */
export function completedCategoryCountsFromContext(planContext: unknown): Record<string, number> | undefined {
  const raw = (planContext as { completed_category_counts?: unknown } | null | undefined)?.completed_category_counts;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const counts = Object.fromEntries(
    Object.entries(raw).filter(([, n]) => Number.isInteger(n) && (n as number) > 0),
  ) as Record<string, number>;
  return Object.keys(counts).length ? counts : undefined;
}

/** Course identities, not anonymous category totals, can satisfy group unions. */
export function identifiedCourseIdsFromContext(planContext: unknown): string[] {
  const status = (planContext as { personal_status?: Record<string, unknown> } | null)?.personal_status;
  return [...new Set(['completed', 'currently_taking'].flatMap(key => {
    const entries = status?.[key];
    if (!Array.isArray(entries)) return [];
    return entries.flatMap(entry => typeof entry?.course_id === 'string' ? [normalizeCourseIdLikePython(entry.course_id)] : []);
  }))];
}

export function recomputeRequirements(
  boardJson: any,
  semesters: ReadonlyArray<{ semesterId: string; courseIds: readonly string[] }>,
  /** Unnamed completed courses per category (see completedCategoryCountsFromContext). Counted, never listed. */
  unidentifiedCompletedByCategory: Readonly<Record<string, number>> = {},
  identifiedProgress: readonly string[] = [],
): RecomputedRequirements | null {
  const meta = boardJson?.metadata;
  const block = meta?.program_requirements_categories;
  // Only boards that ship a base snapshot show a badge at all; without one there is nothing to refresh.
  if (!meta?.program_requirements_validation || !block) return null;
  const totalHours = block.total_required_hours;
  const coreTotalMin = block.core_courses_total_min;
  const groupMinimums = block.group_minimums as Record<string, number> | undefined;
  if (typeof totalHours !== 'number') return null;
  if (typeof coreTotalMin !== 'number' && !(coreTotalMin == null && groupMinimums && Object.keys(groupMinimums).length)) return null;
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
    const count = selected.length + (unidentifiedCompletedByCategory[cat.category_id] ?? 0);
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

  // Unnamed completed courses (e.g. "I finished 2 שער רוח courses") count toward the degree total,
  // not only their category: TAU engineering's 6 ש"ס humanities requirement is part of the total
  // credits (docs/requirements/shaar-ruach-credits.md). Their weight is the category's uniform
  // per-course hours (every שער רוח course is 2); a mixed-hours pool can't be credited blindly.
  for (const cat of categories) {
    const count = unidentifiedCompletedByCategory[cat.category_id] ?? 0;
    if (count <= 0) continue;
    const known = new Set(cat.course_ids.map((c) => hoursById.get(normalizeCourseIdLikePython(String(c))))
      .filter((h): h is number => typeof h === 'number'));
    if (known.size === 1) plannedHours += count * [...known][0];
    else unknownHoursCount += count;
  }

  const coreSatisfied = coreTotalMin == null ? null : coreSelected >= coreTotalMin;
  if (coreSatisfied === false) missingRequiredCategories.push('core_total');

  const groupResults = Object.entries(groupMinimums ?? {}).map(([group, minimum]) => {
    const pool = new Set(categories.filter(cat => cat.group === group)
      .flatMap(cat => cat.course_ids.map(normalizeCourseIdLikePython)));
    const progress = identifiedProgress.map(normalizeCourseIdLikePython).filter(id => hoursById.has(id));
    const selected = [...new Set([...allCourseIds, ...progress])].filter(id => pool.has(id)).sort();
    const satisfied = selected.length >= minimum;
    if (!satisfied) missingRequiredCategories.push(`group:${group}`);
    return { group, min_courses: minimum, selected_courses: selected, selected_count: selected.length,
      satisfied, missing_count: Math.max(0, minimum - selected.length) };
  });

  const warnings: string[] = [];
  if (unknownHoursCount > 0) {
    warnings.push(`חלק מהשעות אינן ידועות ולכן חישוב המכסה חלקי (${unknownHoursCount} קורסים ללא שעות)`);
  }
  if (missingMandatory.length > 0) warnings.push(`קורסי חובה חסרים: ${missingMandatory.join(', ')}`);
  for (const catId of missingRequiredCategories) {
    if (catId === 'core_total') {
      warnings.push(`נדרשים לפחות ${coreTotalMin} קורסי ליבה; נבחרו ${coreSelected}`);
    } else if (catId.startsWith('group:')) {
      const group = groupResults.find(g => `group:${g.group}` === catId)!;
      warnings.push(`קבוצת ${group.group}: ${group.selected_count}/${group.min_courses}`);
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
    if (coreSatisfied === false) parts.push(`קורסי ליבה: ${coreSelected}/${coreTotalMin}`);
    explanation = `דרישות לא מסופקות: ${parts.join('; ')}`;
  }

  return {
    valid,
    total_required_hours: totalHours,
    planned_hours: round1(plannedHours),
    unknown_hours_courses: unknownHoursCount,
    remaining_hours: round1(Math.max(0, totalHours - plannedHours)),
    core_courses_total_min: coreTotalMin ?? null,
    core_courses_selected: coreTotalMin == null ? null : coreSelected,
    core_courses_satisfied: coreSatisfied,
    ...(groupResults.length ? { group_results: groupResults } : {}),
    category_results: categoryResults,
    missing_mandatory_courses: missingMandatory,
    missing_required_categories: missingRequiredCategories,
    warnings,
    explanation,
  };
}
