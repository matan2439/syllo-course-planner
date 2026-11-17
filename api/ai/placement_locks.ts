/**
 * Committed placements are locked. Every course on the student's committed board —
 * placed by hand or accepted from a proposal — stays exactly where it is: the planner
 * plans around it and never moves, removes or replaces it. Only the student can unlock
 * a course (an explicit instruction in the conversation, or a manual board edit).
 *
 * When locked placements collide with a rule or with another request, nothing is changed
 * silently: `analyzeLockConflicts` names the conflict and the ways the student can resolve it.
 * Pure: no I/O, no mutation.
 */
import { legalSemestersFor } from './planner_actions';
import type { ConstraintModel } from './planner_types';

export type LockConflictCode =
  /** The student asked to avoid a course that is on their board. */
  | 'locked_course_avoided'
  /** The course cannot be scheduled now (e.g. not offered this year, missing catalog data). */
  | 'locked_course_unavailable'
  /** The course sits in a semester it is not offered in. */
  | 'locked_course_wrong_semester'
  /** The locked courses of one semester already exceed the absolute load cap. */
  | 'locked_semester_over_cap';

export interface LockConflict {
  code: LockConflictCode;
  courseIds: string[];
  semesterId?: string;
  /**
   * True when the placement breaks an academic rule (availability). The course stays where the
   * student put it, but no plan containing it is valid until they decide.
   */
  blocksValidity: boolean;
  /** What collides, in plain Hebrew. */
  messageHe: string;
  /** What the student can do about it. Each one is THEIR decision; none is applied automatically. */
  resolutionsHe: string[];
}

export interface LockAnalysisInput {
  model: ConstraintModel;
  /** Locked course id → the semesters it is placed in. */
  placements: ReadonlyMap<string, readonly string[]>;
  /** Locked courses kept although the student asked to avoid them. */
  avoided: ReadonlySet<string>;
  /** Locked courses kept although the catalog marks them unschedulable, with the catalog's reason. */
  unavailable: ReadonlyMap<string, string | null>;
  semesterLabel?: (semesterId: string) => string;
}

const YEAR_HE = ['', 'א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ז׳', 'ח׳'];
/** `year_3_semester_a` → "שנה ג׳ סמסטר א׳" (ids outside the convention are shown as they are). */
export function semesterLabelHe(semesterId: string): string {
  const match = /^year_(\d+)_semester_([ab])$/.exec(semesterId);
  return match ? `שנה ${YEAR_HE[Number(match[1])] ?? match[1]} סמסטר ${match[2] === 'a' ? 'א׳' : 'ב׳'}` : semesterId;
}

export function analyzeLockConflicts(input: LockAnalysisInput): LockConflict[] {
  const { model } = input;
  const name = (id: string) => model.profiles.get(id)?.name_he ?? id;
  const label = input.semesterLabel ?? semesterLabelHe;
  const conflicts: LockConflict[] = [];

  for (const id of [...input.avoided].sort()) {
    conflicts.push({
      code: 'locked_course_avoided', courseIds: [id], blocksValidity: false,
      messageHe: `ביקשת להימנע מהקורס "${name(id)}", אבל הוא כבר משובץ בלוח שלך. הוא נשאר במקומו עד שתחליטו אחרת.`,
      resolutionsHe: ['להשאיר את הקורס בלוח', 'לאשר במפורש את הסרת הקורס מהלוח'],
    });
  }
  for (const [id, reason] of [...input.unavailable].sort(([a], [b]) => (a < b ? -1 : 1))) {
    conflicts.push({
      code: 'locked_course_unavailable', courseIds: [id], blocksValidity: true,
      messageHe: `הקורס "${name(id)}" משובץ בלוח שלך, אבל לפי הנתונים הרשמיים לא ניתן לשבץ אותו כעת${reason ? ` (${reason})` : ''}. הוא נשאר במקומו, אבל התוכנית אינה תקינה עד שתחליטו מה לעשות בו.`,
      resolutionsHe: ['לאשר במפורש את הסרת הקורס', 'לאשר החלפה בקורס אחר'],
    });
  }

  const hoursBySemester = new Map<string, { hours: number; ids: string[] }>();
  for (const [id, semesters] of [...input.placements].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const profile = model.profiles.get(id);
    if (!profile) continue;
    for (const semesterId of semesters) {
      const entry = hoursBySemester.get(semesterId) ?? { hours: 0, ids: [] };
      entry.hours += profile.hours ?? 0;
      entry.ids.push(id);
      hoursBySemester.set(semesterId, entry);
    }
    if (profile.is_annual || input.unavailable.has(id)) continue;
    const legal = legalSemestersFor(model, id);
    const wrong = semesters.filter((semesterId) => legal.length > 0 && !legal.includes(semesterId));
    if (wrong.length) {
      conflicts.push({
        code: 'locked_course_wrong_semester', courseIds: [id], semesterId: wrong[0], blocksValidity: true,
        messageHe: `הקורס "${name(id)}" משובץ ב־${label(wrong[0])}, אבל ניתן רק ב: ${legal.map(label).join(', ')}. הוא נשאר במקומו, אבל התוכנית אינה תקינה עד שתחליטו.`,
        resolutionsHe: [...legal.map((semesterId) => `לאשר העברה ל־${label(semesterId)}`), 'לאשר במפורש את הסרת הקורס'],
      });
    }
  }

  for (const [semesterId, entry] of [...hoursBySemester].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (entry.hours <= model.hardCap) continue;
    conflicts.push({
      code: 'locked_semester_over_cap', courseIds: entry.ids, semesterId, blocksValidity: false,
      messageHe: `הקורסים שכבר שיבצת ב־${label(semesterId)} מגיעים ל-${entry.hours} ש"ש — מעל התקרה המוחלטת (${model.hardCap}).`,
      resolutionsHe: ['לאשר העברה של אחד הקורסים לסמסטר אחר', 'לאשר הסרה של אחד הקורסים'],
    });
  }
  return conflicts;
}
