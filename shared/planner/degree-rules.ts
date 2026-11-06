/** Pure, bounded evaluation of DegreeSpec.course_rules, usable by browser and server.
 * Only structured params are interpreted; notes and enforced_by are not evidence.
 */
export interface DegreeRule {
  readonly rule_id: string;
  readonly kind: string;
  readonly course_ids: readonly string[];
  readonly params?: Readonly<Record<string, unknown>>;
}

export type DegreeRuleStatus = 'pass' | 'fail' | 'needs_review';

export interface DegreeRuleResult {
  readonly rule_id: string;
  readonly status: DegreeRuleStatus;
  readonly explanation: string;
}

export interface DegreeRulePlacement {
  readonly courseId: string;
  /** Positive study-semester ordinal, or year_N_semester_a/b. Never A/B parity. */
  readonly semesterId: string | number;
}

export interface DegreeRuleContext {
  /** Reported external identities may trigger an exclusion, never earn credit. */
  readonly exclusionCourseIds?: Iterable<string>;
  readonly placements?: readonly DegreeRulePlacement[];
  /** Exact spec ids; no fuzzy matching, aliases, or inferred equivalences. */
  readonly completedCourseIds?: Iterable<string>;
  readonly currentCourseIds?: Iterable<string>;
  /** Unique selected courses in the board's declared track pool, excluding labs. */
  readonly trackCourseCount?: number;
}

const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const nonnegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const courseId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const integerList = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length > 0 && value.every(positiveInteger);

function semesterOrdinal(value: string | number): number | undefined {
  if (typeof value === 'number') return positiveInteger(value) ? value : undefined;
  const match = /^year_([1-9]\d*)_semester_([ab])$/.exec(value);
  if (!match) return undefined;
  const ordinal = 2 * Number(match[1]) - (match[2] === 'a' ? 1 : 0);
  return positiveInteger(ordinal) ? ordinal : undefined;
}

/** Maximum bipartite matching: each course and each category may be used once.
 * An augmenting path can move a shared course to another category, avoiding the
 * false negatives of greedy assignment and false positives of category union.
 */
function matchedCategoryCount(courses: readonly string[], categories: readonly Set<string>[]): number {
  const owner = new Map<number, string>();
  function assign(id: string, visited: Set<number>): boolean {
    for (let index = 0; index < categories.length; index++) {
      if (!categories[index].has(id) || visited.has(index)) continue;
      visited.add(index);
      const previous = owner.get(index);
      if (previous === undefined || assign(previous, visited)) {
        owner.set(index, id);
        return true;
      }
    }
    return false;
  }
  for (const id of courses) assign(id, new Set());
  return owner.size;
}

/** Evaluate the current plan plus completed/current courses, not graduation or
 * registration eligibility. Missing required category counts fail even for a
 * partial plan. Optional timing/exclusion rules do not require taking a course.
 * Unknown params prevent pass; a definite supported violation still fails.
 * The third-lab alternative needs separate credit accounting.
 */
export function evaluateDegreeRules(
  rules: readonly DegreeRule[],
  context: DegreeRuleContext = {},
): DegreeRuleResult[] {
  const placements = context.placements ?? [];
  const exclusionIds = new Set(context.exclusionCourseIds ?? []);
  const selected = new Set<string>();
  for (const ids of [context.completedCourseIds ?? [], context.currentCourseIds ?? []]) {
    for (const id of ids) if (courseId(id)) selected.add(id);
  }
  const placementSemesters = new Map<string, Array<number | undefined>>();
  for (const placement of placements) {
    if (!courseId(placement.courseId)) continue;
    selected.add(placement.courseId);
    const semesters = placementSemesters.get(placement.courseId) ?? [];
    semesters.push(semesterOrdinal(placement.semesterId));
    placementSemesters.set(placement.courseId, semesters);
  }

  return rules.map(rule => {
    const result = (status: DegreeRuleStatus, explanation: string): DegreeRuleResult =>
      ({ rule_id: rule.rule_id, status, explanation });
    const review = (reason: string) => result('needs_review', `נדרשת בדיקה ידנית: ${reason}`);
    const params = rule.params ?? {};
    const ids = new Set(rule.course_ids);
    const active = [...ids].filter(id => selected.has(id) || (rule.kind === 'mutually_exclusive' && exclusionIds.has(id)));
    const unknownParams = (supported: readonly string[]) =>
      Object.keys(params).filter(key => !supported.includes(key));
    const finish = (explanation: string, supported: readonly string[]) => {
      const unknown = unknownParams(supported);
      return unknown.length
        ? review(`תנאים נוספים אינם נבדקים (${unknown.join(', ')}). ${explanation}`)
        : result('pass', explanation);
    };

    switch (rule.kind) {
      case 'mutually_exclusive': {
        if (ids.size < 2 || ids.size !== rule.course_ids.length || ![...ids].every(courseId)) {
          return review('רשימת החפיפות חסרה או כוללת הפניה עצמית; לא ניתן לזהות שני קורסים נפרדים.');
        }
        if (active.length > 1) {
          return result('fail', `נבחרו קורסים חופפים שאין ללמוד יחד: ${active.join(', ')}.`);
        }
        return finish('לא נבחרו יחד קורסים חופפים מתוך הכלל.', []);
      }
      case 'distinct_categories': {
        const thirdLabRule = params.same_track_requires_third_lab === true;
        const minimum = params.min_courses;
        const distinct = params.min_distinct_categories;
        const members = params.category_members;
        if (!ids.size || ![...ids].every(courseId) || !nonnegativeInteger(minimum) ||
            !nonnegativeInteger(distinct) || !members || typeof members !== 'object' || Array.isArray(members)) {
          return review('חסרים נתוני ספירה או שיוך תקינים לקטגוריות.');
        }
        const categories: Set<string>[] = [];
        for (const [category, courses] of Object.entries(members)) {
          if (!category.trim() || !Array.isArray(courses) || !courses.every(id => courseId(id) && ids.has(id))) {
            return review('שיוך הקורסים לקטגוריות אינו תקין או חורג מרשימת הקורסים של הכלל.');
          }
          categories.push(new Set(courses));
        }
        if (!categories.length || [...ids].some(id => !categories.some(category => category.has(id)))) {
          return review('שיוך הקורסים לקטגוריות חסר.');
        }
        const matched = matchedCategoryCount(active, categories);
        const explanation = `נבחרו ${active.length} קורסים ייחודיים מתוך ${minimum} נדרשים; ` +
          `ניתן לשייך קורסים נפרדים ל־${matched} קטגוריות מתוך ${distinct} נדרשות.`;
        const supported = ['min_courses', 'min_distinct_categories', 'category_members', 'same_track_requires_third_lab'];
        if (thirdLabRule) {
          if (minimum !== 2 || distinct !== 2 || active.length > 2) {
            return review('יש לאמת את שיוך המעבדה השלישית ואת אופן חישוב השעות שלה.');
          }
          if (params.third_lab_counts_toward_theory_credits === false) supported.push('third_lab_counts_toward_theory_credits');
        } else if (params.same_track_requires_third_lab !== undefined && params.same_track_requires_third_lab !== false) {
          return review('הגדרת המעבדה השלישית אינה תקינה.');
        }
        if (active.length < minimum || matched < distinct) return result('fail', explanation);
        if (params.within_track_courses_min !== undefined || params.labs_excluded_from_track_count !== undefined) {
          if (!positiveInteger(params.within_track_courses_min) || params.labs_excluded_from_track_count !== true ||
              !nonnegativeInteger(context.trackCourseCount)) {
            return review('חסרה ספירה מאומתת של קורסי המסלול ללא מעבדות.');
          }
          if (context.trackCourseCount < params.within_track_courses_min) {
            return result('fail', `נבחרו ${context.trackCourseCount} קורסי מסלול מתוך ${params.within_track_courses_min} נדרשים, ללא מעבדות.`);
          }
          supported.push('within_track_courses_min', 'labs_excluded_from_track_count');
        }
        return finish(explanation, supported);
      }
      case 'year_restriction':
      case 'offering_window': {
        if (!ids.size || ![...ids].every(courseId)) return review('כלל הזמן אינו מגדיר רשימת קורסים תקינה.');
        const yearRule = rule.kind === 'year_restriction';
        const years = params.years;
        const from = params.from_semester;
        const semesters = params.semesters;
        if (yearRule
          ? ((years === undefined && from === undefined) ||
             (years !== undefined && !integerList(years)) || (from !== undefined && !positiveInteger(from)))
          : !integerList(semesters)) {
          return review('מגבלת הזמן חסרה או אינה משתמשת במספרי שנים וסמסטרים תקינים.');
        }
        const cap = !yearRule ? params.max_courses : undefined;
        if (cap !== undefined && !nonnegativeInteger(cap)) return review('מגבלת מספר הקורסים אינה תקינה.');
        if (typeof cap === 'number' && active.length > cap) {
          return result('fail', `נבחרו ${active.length} קורסים מתוך הכלל; מותר לכל היותר ${cap}.`);
        }
        let missingEvidence = false;
        for (const id of active) {
          const evidence = placementSemesters.get(id);
          if (!evidence) { missingEvidence = true; continue; }
          for (const ordinal of evidence) {
            if (ordinal === undefined) { missingEvidence = true; continue; }
            const violates = yearRule
              ? ((Array.isArray(years) && !years.includes(Math.ceil(ordinal / 2))) ||
                 (typeof from === 'number' && ordinal < from))
              : !(semesters as number[]).includes(ordinal);
            if (violates) return result('fail', `הקורס ${id} משובץ בסמסטר ${ordinal}, בניגוד למגבלת הזמן של הכלל.`);
          }
        }
        if (missingEvidence) return review('לחלק מהקורסים אין סמסטר לימודים מזוהה; מצב הושלם או נלמד כעת לבדו אינו מעיד על המועד.');
        return finish(
          active.length ? 'כל השיבוצים שנבדקו עומדים במגבלת הזמן.' : 'לא נבחרו קורסים שעליהם חלה מגבלת הזמן.',
          yearRule ? ['years', 'from_semester'] : ['semesters', 'max_courses'],
        );
      }
      default:
        return review(`סוג הכלל ${rule.kind} אינו נתמך בהערכה האוטומטית.`);
    }
  });
}
