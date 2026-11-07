import type {
  DurationExtensionEvidence, GraduateEligibilityEvidence, SemesterDecisionEvidence,
} from './degree-evidence';

export interface ConditionalEvidenceResult {
  status: 'pass' | 'fail' | 'needs_review';
  explanation: string;
}

const result = (status: ConditionalEvidenceResult['status'], explanation: string): ConditionalEvidenceResult =>
  ({ status, explanation });
const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

function extensionDecision(
  decision: SemesterDecisionEvidence | undefined, lastSemester: number, limit?: number,
): ConditionalEvidenceResult {
  if (!decision?.reference.trim() || decision.approved === undefined) {
    return result('needs_review', 'נדרשים דיווח על החלטת האוניברסיטה ואסמכתה להארכה המבוקשת.');
  }
  if (decision.approved === false) return result('fail', 'לפי הדיווח, בקשת ההארכה לא אושרה.');
  if (!positiveInteger(decision.approvedThroughSemester)) {
    return result('needs_review', 'חסר סמסטר הלימודים האחרון שאושר בהחלטה.');
  }
  if (limit !== undefined && decision.approvedThroughSemester > limit) {
    return result('needs_review', 'תקופת האישור המדווחת חורגת ממסלול ההארכה שנבחר.');
  }
  if (lastSemester > decision.approvedThroughSemester) {
    return result('fail', 'התוכנית נמשכת מעבר לסמסטר האחרון שאושר בהחלטה המדווחת.');
  }
  return result('pass', 'התוכנית נמצאת בתקופת ההארכה שאושרה לפי ההחלטה המדווחת והאסמכתה.');
}

/** lastSemester is the latest known study-semester ordinal, including applicable prior study. */
export function evaluateDurationExtension(
  params: Readonly<Record<string, unknown>>, lastSemester: number | undefined,
  evidence?: DurationExtensionEvidence,
): ConditionalEvidenceResult {
  const standard = params.standard_semesters;
  const extensionYears = params.extension_years;
  if (!positiveInteger(standard) || !positiveInteger(extensionYears) ||
      lastSemester === undefined || !Number.isSafeInteger(lastSemester) || lastSemester < 0) {
    return result('needs_review', 'חסרים משך לימודים תקני, גבול הארכה או סמסטר לימודים מזוהה.');
  }
  if (lastSemester <= standard) return result('pass', 'התוכנית נמצאת בתוך משך הלימודים התקני.');
  const ordinaryLimit = standard + 2 * extensionYears;
  if (lastSemester > ordinaryLimit) {
    return extensionDecision(evidence?.exceptional, lastSemester);
  }
  const ordinary = extensionDecision(evidence?.ordinary, lastSemester, ordinaryLimit);
  if (ordinary.status === 'pass') return ordinary;
  const eligible = evidence?.eligibleStudent;
  if (!eligible) return ordinary;
  if (eligible.eligible === undefined || !eligible.reference.trim() ||
      params.eligible_student_extension_semesters !== 2) {
    return result('needs_review', 'נדרשים דיווח מפורש ואסמכתה לזכאות להארכה של שני סמסטרים.');
  }
  if (eligible.eligible === false) {
    return evidence?.ordinary ? ordinary : result('fail', 'לפי הדיווח אין זכאות למסלול ההארכה המיוחד.');
  }
  return extensionDecision(eligible.decision, lastSemester, standard + 2);
}

export interface GraduateCourseEvidenceContext {
  selectedCourseIds: Iterable<string>;
  placements: readonly { courseId: string; semesterId: string | number }[];
  graduateCourseIds?: readonly string[];
  courseStudySemesters?: Readonly<Record<string, number>>;
  average?: number;
  eligibility?: GraduateEligibilityEvidence;
}

function semesterOrdinal(value: string | number): number | undefined {
  if (typeof value === 'number') return positiveInteger(value) ? value : undefined;
  const match = /^year_([1-9]\d*)_semester_([ab])$/.exec(value);
  if (!match) return undefined;
  const ordinal = Number(match[1]) * 2 - (match[2] === 'a' ? 1 : 0);
  return positiveInteger(ordinal) ? ordinal : undefined;
}

/** The cap is checked before any approval. Missing course dates cannot certify the cap. */
export function evaluateGraduateCourseEligibility(
  params: Readonly<Record<string, unknown>>, context: GraduateCourseEvidenceContext,
): ConditionalEvidenceResult {
  if (context.graduateCourseIds === undefined) {
    return result('needs_review', 'חסר דיווח על זהות קורסי התואר השני בתוכנית.');
  }
  const selected = new Set(context.selectedCourseIds);
  for (const placement of context.placements) selected.add(placement.courseId);
  const active = new Set(context.graduateCourseIds.filter(id => selected.has(id)));
  const bySemester = new Map<number, Set<string>>();
  let missingSemester = false;
  for (const id of active) {
    const dates = context.placements.filter(p => p.courseId === id).map(p => p.semesterId);
    const reported = context.courseStudySemesters?.[id];
    if (reported !== undefined) dates.push(reported);
    if (!dates.length) missingSemester = true;
    for (const date of dates) {
      const semester = semesterOrdinal(date);
      if (semester === undefined) { missingSemester = true; continue; }
      const ids = bySemester.get(semester) ?? new Set<string>();
      ids.add(id);
      bySemester.set(semester, ids);
    }
  }
  if ([...bySemester.values()].some(ids => ids.size > 2)) {
    return result('fail', 'אין ללמוד יותר משני קורסי תואר שני בסמסטר; אישור אינו מבטל מגבלה זו.');
  }
  if (params.max_per_semester !== 2 || params.course_level !== 'graduate (תואר שני)') {
    return result('needs_review', 'מגבלת קורסי התואר השני אינה מוגדרת במבנה הנתמך.');
  }
  if (!active.size) return result('pass', 'לפי הדיווח אין קורסי תואר שני שנבחרו לתוכנית.');
  if (missingSemester) return result('needs_review', 'חסר מועד לימודים לקורס תואר שני לצורך בדיקת המכסה.');
  const eligibility = context.eligibility;
  const threshold = eligibility?.committeeMinimumAverage;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 100 ||
      !eligibility?.committeeReference?.trim()) {
    return result('needs_review', 'נדרשים סף הממוצע שקבעה ועדת ההוראה ואסמכתה למקור הסף.');
  }
  if (typeof context.average !== 'number' || !Number.isFinite(context.average) ||
      context.average < 0 || context.average > 100) {
    return result('needs_review', 'חסר ממוצע ציונים תקין לפי גיליון הציונים.');
  }
  if (context.average < threshold) return result('fail', 'הממוצע המדווח נמוך מהסף שקבעה ועדת ההוראה.');
  const approval = eligibility.trackHeadApproval;
  if (!approval?.reference.trim() || approval.approved === undefined) {
    return result('needs_review', 'חסרים דיווח על החלטת ראש המגמה ואסמכתה נפרדת להחלטה.');
  }
  return approval.approved
    ? result('pass', 'הממוצע עומד בסף המדווח והרישום אושר לפי החלטת ראש המגמה המדווחת.')
    : result('fail', 'לפי הדיווח, ראש המגמה לא אישר את הרישום.');
}
