/** Pure, bounded evaluation of DegreeSpec.course_rules, usable by browser and server.
 * Only structured params are interpreted; notes and enforced_by are not evidence.
 */
import type { DegreeEvidence } from './degree-evidence';
import { evaluatePrerequisiteExpression, type PrerequisiteExpression } from './prerequisite-expression';
import { evaluateDurationExtension, evaluateGraduateCourseEligibility } from './degree-conditional-evidence';
import { evaluateAdditionalLabCredit } from './lab-credit-policy';
import { evaluateCourseExemption, recognizedExemptionIds } from './course-exemptions';
import { evaluateCourseRecognition, recognizedAdditionalCourses } from './course-recognition';

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
  /** Identified courses credited to the board's track pool, which excludes labs. */
  readonly trackCourseIds?: Iterable<string>;
  readonly trackCandidateCourseIds?: Iterable<string>;
  readonly evidence?: DegreeEvidence;
  readonly courseHours?: Readonly<Record<string, number | null>>;
  readonly prerequisites?: Readonly<Record<string, readonly string[]>>;
  readonly prerequisiteExpressions?: Readonly<Record<string, PrerequisiteExpression | null>>;
  readonly mandatorySemesters?: Readonly<Record<string, string>>;
  readonly requiredDegreeHours?: number;
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
  const completed = new Set(context.completedCourseIds ?? []);
  const additionalRecognition = recognizedAdditionalCourses(rules, context.evidence?.additionalCourseRecognition, context.courseHours);
  additionalRecognition.recognizedCourseIds.forEach(id => completed.add(id));
  for (const id of recognizedExemptionIds(rules, context.evidence?.technicianExemptions, context.courseHours)) completed.add(id);
  const current = new Set(context.currentCourseIds ?? []);
  const exclusionIds = new Set(context.exclusionCourseIds ?? []);
  const selected = new Set<string>();
  Object.keys(additionalRecognition.externalCourseCredits).forEach(id => selected.add(id));
  for (const ids of [completed, current]) {
    for (const id of ids) if (courseId(id)) selected.add(id);
  }
  const placementSemesters = new Map<string, Array<number | undefined>>();
  for (const [id, semester] of Object.entries(context.evidence?.courseStudySemesters ?? {})) {
    if (selected.has(id)) placementSemesters.set(id, [semesterOrdinal(semester)]);
  }
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
    const checkDecision = (): DegreeRuleResult => {
      const decision = context.evidence?.decisions?.[rule.rule_id];
      if (!decision?.reference.trim()) return review('חסר דיווח על החלטת האוניברסיטה והתנאים המיוחדים לקורס.');
      return decision.approved
        ? result('pass', 'תנאי האישור נבדקו לפי החלטת האוניברסיטה שעליה דיווח הסטודנט.')
        : result('fail', 'לפי הדיווח, האישור הנדרש לא ניתן.');
    };
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
    const approvedCondition = (supported: readonly string[]) => {
      const decision = checkDecision();
      return decision.status === 'pass' ? finish(decision.explanation, supported) : decision;
    };
    const checkEligibility = (): DegreeRuleResult | undefined => {
      if (params.min_average !== undefined) {
        if (typeof params.min_average !== 'number' || !Number.isFinite(params.min_average)) return review('מגבלת הממוצע אינה תקינה.');
        const average = context.evidence?.average;
        if (average === undefined) return review(`נדרש ממוצע ציונים של ${params.min_average} לפחות.`);
        if (average < params.min_average) return result('fail', `הממוצע המדווח ${average} נמוך מ־${params.min_average} הנדרש.`);
      }
      if (params.admission_interview === true || params.requires_supervisor_recommendation === true ||
          params.completed_recommended_plan === true) {
        const decision = checkDecision();
        if (decision.status !== 'pass') return decision;
      }
      return undefined;
    };

    switch (rule.kind) {
      case 'course_recognition': {
        if (additionalRecognition.conflictingCourseIds.length) return review('זיכויי שעות סותרים לאותו קורס מחייבים אימות לפני שימוש בהכרה.');
        const evaluated = evaluateCourseRecognition(rule, context.evidence?.additionalCourseRecognition?.[rule.rule_id], context.courseHours);
        if (evaluated.status !== 'pass') return result(evaluated.status, evaluated.explanation);
        const minimum = params.requires_approval_after_track_minimum;
        if (minimum !== undefined) {
          if (!positiveInteger(minimum) || typeof params.core_rule_id !== 'string') return review('חסרה הגדרת קורסי המסלול הדרושה לבדיקת ההשלמות.');
          const pool = context.trackCandidateCourseIds ?? context.trackCourseIds;
          if (!pool) return review('חסר מאגר קורסי המסלול המוסמך לבדיקת קורסי ההשלמה.');
          const track = [...new Set(pool)].filter(id => selected.has(id));
          if (track.length > minimum) {
            const approved = new Set(evaluated.approvedCourseIds);
            const unapproved = track.filter(id => !approved.has(id));
            if (unapproved.length > minimum) return review(`נדרש אישור מוקדם לקורסי מסלול נוספים מעבר ל־${minimum} קורסי החובה בבחירה.`);
            const coreRule = rules.find(candidate => candidate.rule_id === params.core_rule_id && candidate.kind === 'distinct_categories');
            const members = coreRule?.params?.category_members;
            const coreMin = coreRule?.params?.min_courses, distinctMin = coreRule?.params?.min_distinct_categories;
            if (!members || typeof members !== 'object' || Array.isArray(members) || !positiveInteger(coreMin) || !positiveInteger(distinctMin)) return review('חסרה הגדרת קורסי הליבה בתוך מכסת המסלול.');
            const categories = Object.values(members).map(ids => new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []));
            const coreIds = new Set(coreRule!.course_ids);
            const existingCore = unapproved.filter(id => coreIds.has(id));
            const additions = Math.max(0, coreMin - existingCore.length, distinctMin - matchedCategoryCount(existingCore, categories));
            if (additions > minimum - unapproved.length || track.filter(id => coreIds.has(id)).length < coreMin || matchedCategoryCount(track.filter(id => coreIds.has(id)), categories) < distinctMin) {
              return review('האישורים אינם מאפשרים לשמור במכסת המסלול את כל קורסי הליבה הנדרשים; יש לאמת את קורסי ההשלמה המאושרים.');
            }
          }
        }
        return result('pass', evaluated.explanation);
      }
      case 'course_exemption': {
        const evaluated = evaluateCourseExemption(rule, context.evidence?.technicianExemptions?.[rule.rule_id], context.courseHours);
        return result(evaluated.status, evaluated.explanation);
      }
      case 'optional_pathway': {
        const goal = params.optional_goal;
        const required = params.required_course_ids;
        const alternatives = params.alternative_groups;
        const projectIds = params.project_course_ids;
        const supported = ['optional_goal', 'goal_label_he', 'required_course_ids', 'alternative_groups',
          'project_domain', 'project_domain_label_he', 'project_course_ids', 'licensing_authority'];
        if (typeof goal !== 'string' || !goal.trim()) return review('חסר זיהוי למסלול הבחירה.');
        if (!context.evidence?.optionalGoals?.includes(goal)) return finish('מסלול הבחירה לא נבחר ואינו דרישת חובה לתואר.', supported);
        if (!Array.isArray(required) || !required.length || !required.every(id => courseId(id) && ids.has(id)) ||
            !Array.isArray(alternatives) || !alternatives.every(group => Array.isArray(group) && group.length && group.every(id => courseId(id) && ids.has(id))) ||
            !Array.isArray(projectIds) || !projectIds.length || !projectIds.every(id => courseId(id) && ids.has(id)) ||
            typeof params.project_domain !== 'string' || !params.project_domain.trim()) return review('הגדרת מסלול הבחירה אינה מלאה.');
        const missing = required.filter(id => !selected.has(id));
        const missingAlternatives = alternatives.filter(group => !group.some((id: string) => selected.has(id)));
        if (missing.length || missingAlternatives.length || projectIds.some(id => !selected.has(id))) {
          return result('fail', `טרם הושלמו קורסי מסלול הבחירה: ${missing.join(', ')}${missingAlternatives.length ? '; חסרה בחירה מקבוצת חלופות' : ''}.`);
        }
        for (const id of projectIds) {
          const project = context.evidence?.projectDomains?.[id];
          if (!project?.reference.trim()) return review(`חסר דיווח עם אסמכתה לתחום פרויקט הגמר ${id}.`);
          if (project.domain !== params.project_domain) return result('fail', 'תחום פרויקט הגמר המדווח אינו תואם למסלול הבחירה.');
        }
        return finish('הקורסים ותחום הפרויקט תואמים למסלול הלימודים שנבחר לפי הדיווח. הבדיקה אינה אישור רישוי.', supported);
      }
      case 'mutually_exclusive': {
        if (params.published_self_reference === true && ids.size === 1 &&
            String(params.other_course_as_printed).replace(/\D/g, '') === [...ids][0].replace(/\D/g, '')) {
          return active.length
            ? review('הידיעון מציין חפיפה למספר הקורס עצמו. יש לבקש הבהרה מהאוניברסיטה לפני אישור התוכנית.')
            : result('pass', 'הקורס עם הערת המקור הלא ברורה אינו נכלל בתוכנית.');
        }
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
        const trackMinimum = params.within_track_courses_min;
        const hasTrackRequirement = trackMinimum !== undefined || params.labs_excluded_from_track_count !== undefined;
        const trackIds = context.trackCandidateCourseIds !== undefined ? new Set([...context.trackCandidateCourseIds].filter(id => selected.has(id)))
          : context.trackCourseIds === undefined ? undefined : new Set(context.trackCourseIds);
        const eligibleCore = hasTrackRequirement && trackIds ? active.filter(id => trackIds.has(id)) : active;
        const matched = matchedCategoryCount(eligibleCore, categories);
        const allMatched = eligibleCore.length === active.length ? matched : matchedCategoryCount(active, categories);
        const explanation = `נבחרו ${active.length} קורסים ייחודיים מתוך ${minimum} נדרשים; ` +
          `ניתן לשייך קורסים נפרדים ל־${matched} קטגוריות מתוך ${distinct} נדרשות.`;
        const supported = ['min_courses', 'min_distinct_categories', 'category_members', 'same_track_requires_third_lab'];
        if (thirdLabRule) {
          if (minimum !== 2 || distinct !== 2) return review('הגדרת המעבדה השלישית אינה תקינה.');
          if (active.length > 2 && matched >= 2) {
            if (params.third_lab_counts_toward_theory_credits !== false) return review('חסרה מדיניות זיכוי עיוני למעבדה הנוספת.');
            const evaluated = evaluateAdditionalLabCredit({ labIds: active, selectedIds: selected,
              courseHours: { ...context.courseHours, ...additionalRecognition.externalCourseCredits }, requiredDegreeHours: context.requiredDegreeHours,
              allocation: context.evidence?.labCreditAllocations?.[rule.rule_id] });
            return evaluated.status === 'pass' ? finish(evaluated.explanation,
              [...supported, 'third_lab_counts_toward_theory_credits']) : result(evaluated.status, evaluated.explanation);
          }
          if (params.third_lab_counts_toward_theory_credits === false) supported.push('third_lab_counts_toward_theory_credits');
        } else if (params.same_track_requires_third_lab !== undefined && params.same_track_requires_third_lab !== false) {
          return review('הגדרת המעבדה השלישית אינה תקינה.');
        }
        if (active.length < minimum || allMatched < distinct) return result('fail', explanation);
        if (hasTrackRequirement) {
          if (!positiveInteger(trackMinimum) || params.labs_excluded_from_track_count !== true || !trackIds) {
            return review('חסרה ספירה מאומתת של קורסי המסלול ללא מעבדות.');
          }
          if (eligibleCore.length < minimum || matched < distinct) {
            return review('יש לאמת את הזכאות לקורסי הליבה שמחוץ למאגר קורסי המסלול.');
          }
          if (trackIds.size < trackMinimum) {
            return result('fail', `נבחרו ${trackIds.size} קורסי מסלול מתוך ${trackMinimum} נדרשים, ללא מעבדות.`);
          }
          supported.push('within_track_courses_min', 'labs_excluded_from_track_count');
        }
        return finish(explanation, supported);
      }
      case 'year_restriction':
      case 'offering_window': {
        if (rule.kind === 'year_restriction' && ids.size === 0 && params.require_all_prior_year_courses === true) {
          if (!context.mandatorySemesters) return review('חסרה תוכנית החובה לפי שנות לימוד.');
          for (const placement of placements) {
            const ordinal = semesterOrdinal(placement.semesterId);
            if (ordinal === undefined) return review('חסר סמסטר לימודים מזוהה.');
            const firstSemester = 2 * Math.ceil(ordinal / 2) - 1;
            for (const [requiredId, home] of Object.entries(context.mandatorySemesters)) {
              if (completed.has(requiredId) || (current.has(requiredId) && !placementSemesters.has(requiredId))) continue;
              const expected = semesterOrdinal(home);
              if (expected === undefined) return review('קיימת סתירה או אי־ודאות בשנת הלימודים הרשמית של קורס חובה.');
              if (expected >= firstSemester) continue;
              const actual = placementSemesters.get(requiredId);
              if (!actual?.some(s => s !== undefined && s < firstSemester)) {
                return result('fail', `חסר קורס חובה משנה קודמת לפני ההתקדמות: ${requiredId}.`);
              }
            }
          }
          return finish('קורסי החובה מהשנים הקודמות הושלמו או תוכננו לפני ההתקדמות.', ['rule', 'require_all_prior_year_courses']);
        }
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
        if (active.length === 0) return result('pass', 'לא נבחרו קורסים שעליהם חלה מגבלת הזמן.');
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
        const eligibility = checkEligibility();
        if (eligibility) return eligibility;
        return finish(
          'כל השיבוצים שנבדקו עומדים במגבלת הזמן.',
          yearRule ? ['years', 'from_semester', 'min_average', 'admission_interview', 'requires_supervisor_recommendation', 'registration'] : ['semesters', 'max_courses'],
        );
      }
      case 'cohort_restriction':
        if (ids.size > 0 && [...ids].every(courseId) && active.length === 0) {
          return result('pass', 'לא נבחרו קורסים שעליהם חל תנאי הזכאות.');
        }
        if (params.cohort === 'spring_intake') {
          if (!integerList(params.semesters)) return review('חסרים סמסטרים תקינים לכלל המחזור.');
          if (!context.evidence?.intake) return review('יש לדווח אם התחלת הלימודים במחזור אביב או סתיו.');
          if (context.evidence.intake === 'autumn') return result('pass', 'כלל מחזור האביב אינו חל על מחזור סתיו.');
          for (const id of active) {
            const semesters = placementSemesters.get(id);
            if (!semesters || semesters.some(s => s === undefined)) return review('חסר סמסטר לימודים מזוהה לקורס.');
            if (semesters.some(s => !(params.semesters as number[]).includes(s!))) return result('fail', 'הקורס משובץ מחוץ למועד הנדרש למחזור אביב.');
          }
          return finish('השיבוץ עומד בכלל מחזור האביב.', ['cohort', 'semesters']);
        }
        if (params.min_average !== undefined || params.completed_recommended_plan !== undefined) {
          const eligibility = checkEligibility();
          return eligibility ?? finish('תנאי הזכאות נבדקו לפי הנתונים והאישור המדווחים.', ['min_average', 'completed_recommended_plan', 'program', 'registration']);
        }
        return review('יש לאמת את תנאי הזכאות לקורס מול נתוני הסטודנט.');
      case 'language_requirement': {
        if (params.language !== 'en' || !positiveInteger(params.min_courses)) return review('כלל השפה אינו נתמך במבנה זה.');
        const start = context.evidence?.higherEducationStartYear;
        if (start === undefined) return review('חסרה שנת תחילת לימודים במערכת ההשכלה הגבוהה בישראל.');
        if (!positiveInteger(params.applies_from_year)) return review('יש לאמת את תחולת כלל השפה.');
        if (start < params.applies_from_year) return result('pass', 'תחילת הלימודים המדווחת קודמת לתחולת כלל השפה.');
        const recognized = context.evidence?.recognizedEnglishCourseIds;
        if (recognized === undefined) return review('יש לדווח אילו קורסים הוכרו כלימודים באנגלית במסגרת התואר.');
        const count = new Set(recognized.filter(id => selected.has(id))).size;
        if (count < params.min_courses) return result('fail', `זוהו ${count} קורסים מוכרים באנגלית מתוך ${params.min_courses} נדרשים.`);
        return finish('מספר הקורסים המוכרים באנגלית עומד בדרישה לפי הדיווח.', ['language', 'min_courses', 'applies_to', 'applies_from_year']);
      }
      case 'study_duration': {
        const ordinals = [...placements.map(p => semesterOrdinal(p.semesterId)),
          ...Object.entries(context.evidence?.courseStudySemesters ?? {})
            .filter(([id]) => selected.has(id)).map(([, semester]) => semesterOrdinal(semester))];
        if (ordinals.some(s => s === undefined)) return review('חסר סמסטר לימודים לצורך בדיקת משך התואר.');
        const last = Math.max(0, ...ordinals as number[]);
        if (positiveInteger(params.semesters) && positiveInteger(params.years)) {
          if (params.semesters !== params.years * 2) return review('נתוני משך התואר אינם עקביים.');
          return finish('משך הלימודים התקני נרשם; הארכה נבדקת בכלל נפרד.',
            ['semesters', 'years', 'nine_semester_programs']);
        }
        if (positiveInteger(params.extension_years) && positiveInteger(params.standard_semesters)) {
          const evaluated = evaluateDurationExtension(params, last, context.evidence?.durationExtensions?.[rule.rule_id]);
          return evaluated.status === 'pass'
            ? finish(evaluated.explanation, ['extension_years', 'standard_semesters', 'approval', 'further_extension', 'eligible_student_extension_semesters'])
            : result(evaluated.status, evaluated.explanation);
        }
        return review('חסרה הגדרה מובנית למשך התואר.');
      }
      case 'load_limit': {
        if (typeof params.min_load_fraction_without_approval === 'number') {
          if (!(params.min_load_fraction_without_approval > 0 && params.min_load_fraction_without_approval <= 1)) return review('שיעור עומס הלימודים אינו תקין.');
          for (const semester of new Set(placements.map(p => p.semesterId))) {
            const full = context.evidence?.fullTimeLoadBySemester?.[String(semester)];
            if (!full?.reference.trim()) return review('יש לדווח על עומס לימודים מלא לפי תוכנית האוניברסיטה ואסמכתה לכל סמסטר פעיל.');
            const ids = new Set(placements.filter(p => p.semesterId === semester).map(p => p.courseId));
            let hours = 0;
            for (const id of ids) {
              const value = context.courseHours?.[id];
              if (typeof value !== 'number' || !Number.isFinite(value)) return review('חסרות שעות מוסמכות לחישוב עומס הלימודים.');
              hours += value;
            }
            if (hours < full.hours * params.min_load_fraction_without_approval) return approvedCondition(['default_load', 'min_load_fraction_without_approval', 'approval']);
          }
          return finish('העומס המתוכנן עומד בסף לפי העומס המלא המדווח.',
            ['default_load', 'min_load_fraction_without_approval', 'approval']);
        }
        if (positiveInteger(params.max_per_semester) && params.course_level === 'graduate (תואר שני)') {
          const evaluated = evaluateGraduateCourseEligibility(params, { selectedCourseIds: selected, placements,
            graduateCourseIds: context.evidence?.graduateCourseIds, courseStudySemesters: context.evidence?.courseStudySemesters,
            average: context.evidence?.average, eligibility: context.evidence?.graduateEligibility?.[rule.rule_id] });
          return evaluated.status === 'pass' ? finish(evaluated.explanation, ['course_level', 'max_per_semester', 'requires'])
            : result(evaluated.status, evaluated.explanation);
        }
        return review('חסרה הגדרה מובנית למגבלת העומס.');
      }
      case 'prerequisite_policy': {
        if (!context.prerequisites && !context.prerequisiteExpressions) return review('חסר גרף דרישות הקדם המוסמך.');
        let missing = false;
        for (const placement of placements) {
          const target = semesterOrdinal(placement.semesterId);
          const expression = context.prerequisiteExpressions
            ? context.prerequisiteExpressions[placement.courseId]
            : Object.prototype.hasOwnProperty.call(context.prerequisites, placement.courseId)
              ? { all_of: context.prerequisites![placement.courseId].map(course_id => ({ course_id })) }
              : null;
          const status = evaluatePrerequisiteExpression(expression, id => {
            if (completed.has(id)) return 'satisfied';
            if (current.has(id)) {
              const eligibility = context.evidence?.prerequisiteEligibility?.[id];
              if (!eligibility?.reference.trim()) return 'unknown';
              if (!eligibility.attended || !eligibility.examEligible) return 'unsatisfied';
              if (!placementSemesters.has(id)) return 'satisfied';
            }
            const prior = placementSemesters.get(id);
            if (target === undefined || prior?.some(s => s === undefined)) return 'unknown';
            return prior?.some(s => s !== undefined && s <= target) ? 'satisfied' : 'unsatisfied';
          });
          if (status === 'unknown') return review('דרישות הקדם לקורס חסרות או אינן מפוענחות במלואן.');
          if (status === 'unsatisfied') missing = true;
        }
        if (params.prerequisite_may_be_concurrent === true) {
          return missing ? result('fail', 'קיימת דרישת קדם שלא הושלמה ואינה מתוכננת לפני הקורס או במקביל לו.')
            : finish('דרישות הקדם הושלמו או מתוכננות לפני הקורס או במקביל לו.', ['prerequisite_may_be_concurrent', 'satisfied_by']);
        }
        if (params.conditional_prerequisite_allowed === true) {
          return missing ? review('לרישום מותנה יש לדווח על אישור עבור דרישת הקדם החסרה.')
            : finish('לא נדרש חריג לרישום מותנה לדרישות הקדם שבתוכנית.', ['rule', 'applies_to', 'conditional_prerequisite_allowed']);
        }
        return review('מדיניות דרישות הקדם אינה מוגדרת במבנה נתמך.');
      }
      default:
        return review(`סוג הכלל ${rule.kind} אינו נתמך בהערכה האוטומטית.`);
    }
  });
}
