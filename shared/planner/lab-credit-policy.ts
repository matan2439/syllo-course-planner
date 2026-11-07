/** Additional lab workload must not fill the theoretical-course credit gap. */
export interface LabCreditAllocation {
  creditedLabCourseIds: string[];
  nonTheoryLabCourseIds: string[];
  reference: string;
  /** Optional university-reported credit outside the identified course catalog. */
  otherRecognizedDegreeHours?: number;
  otherCreditReference?: string;
}

export function evaluateAdditionalLabCredit(context: {
  labIds: readonly string[]; selectedIds: ReadonlySet<string>;
  courseHours?: Readonly<Record<string, number | null>>;
  requiredDegreeHours?: number; allocation?: LabCreditAllocation;
}): { status: 'pass' | 'fail' | 'needs_review'; explanation: string } {
  const report = context.allocation;
  const review = (explanation: string) => ({ status: 'needs_review' as const, explanation });
  if (!report?.reference.trim()) return review('יש לדווח עם אסמכתה אילו שתי מעבדות מוכרות ואילו מעבדות נוספות אינן מזכות בשעות לקורסים עיוניים.');
  const credited = new Set(report.creditedLabCourseIds), excluded = new Set(report.nonTheoryLabCourseIds);
  if (credited.size !== 2 || credited.size !== report.creditedLabCourseIds.length ||
      excluded.size !== report.nonTheoryLabCourseIds.length || !excluded.size ||
      [...credited].some(id => excluded.has(id) || !context.labIds.includes(id)) ||
      [...excluded].some(id => !context.labIds.includes(id)) ||
      context.labIds.some(id => !credited.has(id) && !excluded.has(id))) {
    return review('שיוך השעות חייב לזהות שתי מעבדות מוכרות ואת כל המעבדות הנוספות, ללא חפיפה או קורסים שלא נבחרו.');
  }
  const target = context.requiredDegreeHours;
  if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0) return review('חסר היקף השעות הרשמי לתואר לצורך בדיקת השעות העיוניות.');
  let hours = 0;
  for (const id of context.selectedIds) {
    if (excluded.has(id)) continue;
    const value = context.courseHours?.[id];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return review(`חסרות שעות רשמיות לקורס ${id}.`);
    hours += value;
  }
  const other = report.otherRecognizedDegreeHours;
  if (other !== undefined) {
    if (!Number.isFinite(other) || other < 0 || other > 400 || !report.otherCreditReference?.trim()) {
      return review('שעות מוכרות נוספות מחייבות סכום תקין ואסמכתה המאשרת שהן מעבר לקורסים המזוהים ושאינן כוללות את המעבדה הנוספת.');
    }
    hours += other;
  }
  return hours >= target
    ? { status: 'pass', explanation: 'תנאי המעבדות מתקיים והשעות מספיקות גם ללא זיכוי עיוני עבור המעבדות הנוספות, לפי הרישום המדווח.' }
    : { status: 'fail', explanation: `ללא הזיכוי העיוני למעבדות הנוספות נצברו ${hours} מתוך ${target} השעות הנדרשות.` };
}
