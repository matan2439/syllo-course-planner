import type { DegreeRule } from './degree-rules';

export interface TechnicianExemptionReport {
  credential?: string;
  governmentExamAverage?: number;
  excludesProject?: boolean;
  awards?: Record<string, { approved: boolean; degreeCreditHours?: number; reference: string }>;
}

/** Eligibility never awards credit. Only a cited individual full-credit award is recognized. */
export function evaluateCourseExemption(rule: DegreeRule, report: TechnicianExemptionReport | undefined,
  catalogHours?: Readonly<Record<string, number | null>>) {
  const result = (status: 'pass' | 'fail' | 'needs_review', explanation: string, recognizedCourseIds: string[] = []) =>
    ({ status, explanation, recognizedCourseIds });
  const awards = Object.entries(report?.awards ?? {}).filter(([, award]) => award.approved === true);
  if (!awards.length) return result('pass', 'לא נעשה שימוש בפטור על סמך לימודי הנדסאי. זכאות לבדה אינה מעניקה פטור או שעות.');
  const params = rule.params ?? {};
  const threshold = params.minimum_government_exam_average;
  const byCredential = params.eligible_course_ids_by_credential;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 100 ||
      params.exclude_project_from_average !== true || params.individual_university_award_required !== true ||
      !byCredential || typeof byCredential !== 'object' || Array.isArray(byCredential)) {
    return result('needs_review', 'הגדרת הזכאות לפטור אינה מלאה.');
  }
  const eligible = report?.credential && (byCredential as Record<string, unknown>)[report.credential];
  if (!Array.isArray(eligible) || !eligible.every(id => typeof id === 'string' && rule.course_ids.includes(id))) {
    return result('needs_review', 'חסר סוג תעודת ההנדסאי המתאים לרשימת הפטורים שפורסמה.');
  }
  if (report?.governmentExamAverage === undefined || report.excludesProject === undefined) {
    return result('needs_review', 'נדרש ממוצע בחינת הגמר הממשלתית ואישור שהממוצע אינו כולל את הפרויקט.');
  }
  if (!Number.isFinite(report.governmentExamAverage) || report.governmentExamAverage > 100 || report.governmentExamAverage < threshold || !report.excludesProject) {
    return result('fail', `הפטור המוצהר אינו עומד בסף ממוצע ${threshold} בבחינת הגמר הממשלתית ללא הפרויקט.`);
  }
  for (const [id, award] of awards) {
    if (!eligible.includes(id)) return result('fail', `הקורס ${id} אינו ברשימת הפטורים שפורסמה לסוג התעודה המדווח.`);
    if (!award.reference.trim()) return result('needs_review', `חסרה אסמכתה להענקת הפטור האישי בקורס ${id}.`);
    const hours = catalogHours?.[id];
    if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0 || award.degreeCreditHours !== hours) {
      return result('needs_review', `יש לאמת את זיכוי שעות התואר בפטור ${id}; אין להמיר פטור אוטומטית לשעות הקורס.`);
    }
  }
  const supported = ['minimum_government_exam_average', 'exclude_project_from_average',
    'eligible_course_ids_by_credential', 'credential_labels_he', 'individual_university_award_required'];
  if (Object.keys(params).some(key => !supported.includes(key))) return result('needs_review', 'תנאי פטור נוספים מחייבים בדיקה.');
  return result('pass', 'הפטורים האישיים וזיכוי השעות תואמים לזכאות ולרישום האוניברסיטה שדווחו.', awards.map(([id]) => id));
}

export function recognizedExemptionIds(rules: readonly DegreeRule[], reports: Record<string, TechnicianExemptionReport> | undefined,
  hours: Readonly<Record<string, number | null>> | undefined): string[] {
  return [...new Set(rules.filter(rule => rule.kind === 'course_exemption').flatMap(rule =>
    evaluateCourseExemption(rule, reports?.[rule.rule_id], hours).recognizedCourseIds))];
}
