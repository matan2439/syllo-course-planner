import type { DegreeRule } from './degree-rules';

export interface CourseRecognitionReport {
  nameHe?: string;
  useForDegreeCredit: boolean;
  scope: 'supplementary' | 'out_of_catalog';
  completed: boolean;
  priorApproval: boolean;
  approvalReference: string;
  syllabusReference: string;
  instructorConsentReference: string;
  officialCourseReference: string;
  recognizedDegreeHours?: number;
  creditAwardReference?: string;
  averageAtApproval?: number;
  exceptionalLimitReference?: string;
}

/** Individual recognition is not a new schedulable catalog or prerequisite equivalence. */
export function evaluateCourseRecognition(rule: DegreeRule, reports: Record<string, CourseRecognitionReport> | undefined,
  catalogHours?: Readonly<Record<string, number | null>>) {
  const result = (status: 'pass' | 'fail' | 'needs_review', explanation: string,
    recognizedCourseIds: string[] = [], additionalDegreeHours = 0, externalCourseCredits: Record<string, number> = {}, approvedCourseIds: string[] = []) =>
    ({ status, explanation, recognizedCourseIds, additionalDegreeHours, externalCourseCredits, approvedCourseIds });
  const active = Object.entries(reports ?? {}).filter(([, report]) => report.useForDegreeCredit);
  if (!active.length) return result('pass', 'לא נעשה שימוש בהכרה אישית בקורסים נוספים. קורסי המסלול הרגילים נבדקים לפי הקטלוג.');
  const params = rule.params ?? {};
  const threshold = params.out_of_catalog_minimum_average_for_consideration;
  const maximum = params.out_of_catalog_normally_max_courses_per_degree;
  if (params.prior_committee_approval_required !== true || params.syllabus_required !== true ||
      params.instructor_consent_required !== true || typeof threshold !== 'number' || !Number.isFinite(threshold) ||
      threshold < 0 || threshold > 100 || typeof maximum !== 'number' || !Number.isSafeInteger(maximum) || maximum < 1 ||
      Object.keys(params).some(key => !['prior_committee_approval_required', 'syllabus_required',
        'instructor_consent_required', 'out_of_catalog_minimum_average_for_consideration',
        'out_of_catalog_normally_max_courses_per_degree', 'requires_approval_after_track_minimum', 'core_rule_id'].includes(key))) {
    return result('needs_review', 'תנאי ההכרה הנוספת אינם מוגדרים במלואם.');
  }
  const external = active.filter(([, report]) => report.scope === 'out_of_catalog');
  const recognized: string[] = [];
  const approved: string[] = [];
  let otherHours = 0;
  const externalCredits: Record<string, number> = {};
  for (const [id, report] of active) {
    const known = !!catalogHours && Object.prototype.hasOwnProperty.call(catalogHours, id);
    if (!known && report.scope !== 'out_of_catalog') return result('needs_review', `הקורס ${id} אינו בקטלוג; יש לבדוק אותו כהכרה מחוץ לקטלוג.`);
    if (!report.priorApproval || !report.approvalReference.trim() || !report.syllabusReference.trim() ||
        !report.instructorConsentReference.trim() || !report.officialCourseReference.trim()) {
      return result('needs_review', `להכרה בקורס ${id} נדרשים אישור מוקדם, סילבוס, הסכמת מרצה ואסמכתאות.`);
    }
    if (report.scope === 'out_of_catalog') {
      if (report.averageAtApproval === undefined || !Number.isFinite(report.averageAtApproval) || report.averageAtApproval > 100) {
        return result('needs_review', 'חסר ממוצע הציונים בעת בקשת ההכרה מחוץ לקטלוג.');
      }
      if (report.averageAtApproval < threshold) return result('fail', `הממוצע המדווח בעת הבקשה נמוך מסף ${threshold} לשקילת ההכרה.`);
      if (external.length > maximum && !report.exceptionalLimitReference?.trim()) return result('needs_review', 'מספר הקורסים חורג מההיקף הרגיל; נדרשת החלטה חריגה המתייחסת לקורסים הנוספים.');
    }
    approved.push(id);
    if (!report.completed) continue; // An enrollment approval is not earned credit.
    if (!report.creditAwardReference?.trim()) return result('needs_review', `הקורס ${id} טרם דווח כהושלם עם זיכוי שעות אישי מהאוניברסיטה.`);
    const hours = report.recognizedDegreeHours;
    if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0 || hours > 30) return result('needs_review', `חסר זיכוי שעות תואר תקין לקורס ${id}.`);
    if (known) {
      if (catalogHours![id] !== hours) return result('needs_review', `הזיכוי המוצהר בקורס ${id} שונה מהקטלוג ומחייב אימות פרטני.`);
      recognized.push(id);
    } else { otherHours += hours; externalCredits[id] = hours; }
  }
  return result('pass', 'תנאי ההכרה תואמים להחלטות שדווחו. רק קורסים שהושלמו עם זיכוי אישי נרשמים כשעות שהוכרו.', recognized, otherHours, externalCredits, approved);
}

export function recognizedAdditionalCourses(rules: readonly DegreeRule[], reports: Record<string, Record<string, CourseRecognitionReport>> | undefined,
  hours: Readonly<Record<string, number | null>> | undefined) {
  const ids = new Set<string>();
  const externalCourseCredits: Record<string, number> = {};
  const conflicts = new Set<string>();
  for (const rule of rules.filter(rule => rule.kind === 'course_recognition')) {
    const evaluated = evaluateCourseRecognition(rule, reports?.[rule.rule_id], hours);
    if (evaluated.status !== 'pass') continue;
    evaluated.recognizedCourseIds.forEach(id => ids.add(id));
    for (const [id, credit] of Object.entries(evaluated.externalCourseCredits)) {
      if (Object.prototype.hasOwnProperty.call(externalCourseCredits, id) && externalCourseCredits[id] !== credit) conflicts.add(id);
      else externalCourseCredits[id] = credit;
    }
  }
  for (const id of conflicts) delete externalCourseCredits[id];
  return { recognizedCourseIds: [...ids], additionalDegreeHours: Object.values(externalCourseCredits).reduce((sum, hours) => sum + hours, 0),
    externalCourseCredits, conflictingCourseIds: [...conflicts] };
}
