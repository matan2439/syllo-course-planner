/**
 * Weekly-timetable feasibility for one semester of the draft: can the student
 * pick one group per teaching mode (lecture, recitation, lab…) for every course
 * with no time overlap and nothing on their free days? Pure and deterministic;
 * the data (bid-it, unofficial) is fetched by the caller.
 */
import { hasOverlap, type ScheduleCourse, type ScheduleGroup, type TimeSlot } from '../../../shared/planner/schedule';

export const WEEK_DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

/** One choice to make: which group of this kind + mode to take for `courseId`. */
interface Slot { courseId: string; kind: string; mode: string; options: ScheduleGroup[] }

export interface TimetableSelection { courseId: string; kind: string; mode: string; groupId: string; slots: TimeSlot[] }

export interface TimetableResult {
  /** null when the search budget ran out before an answer. */
  feasible: boolean | null;
  selection: TimetableSelection[];
  daysUsed: WeekDay[];
  /** Courses bid-it has no usable groups for — not checked. */
  unknownCourseIds: string[];
  /** When infeasible: course pairs that cannot be scheduled together (ignoring free days). */
  conflictingCoursePairs: Array<[string, string]>;
  /** When infeasible: courses that cannot avoid the free days on their own. */
  coursesBlockingFreeDays: string[];
}

const MAX_NODES = 50_000; // ponytail: plain backtracking; a semester is ~6 courses × ~3 modes

function clashes(a: ScheduleGroup, b: ScheduleGroup): boolean {
  return a.slots.some((x) => b.slots.some((y) => hasOverlap(x, y)));
}

/**
 * A course's required choices: a primary and a secondary group of the same mode
 * are separate choices (same key as the timetable drawer's choiceKey). Only
 * groups with meeting times are options; `null` when some required choice has
 * no timed group at all, so the course cannot be checked.
 */
function choicesOf(course: ScheduleCourse): Slot[] | null {
  const byChoice = new Map<string, ScheduleGroup[]>();
  for (const group of course.groups) {
    const key = `${group.kind}\u0000${group.teachingMode}`;
    byChoice.set(key, [...(byChoice.get(key) ?? []), group]);
  }
  const slots: Slot[] = [];
  for (const groups of byChoice.values()) {
    const timed = groups.filter((group) => group.slots.length > 0);
    if (!timed.length) return null;
    slots.push({ courseId: course.courseId, kind: groups[0].kind, mode: groups[0].teachingMode, options: timed });
  }
  return slots.length ? slots : null;
}

function slotsFor(courses: readonly ScheduleCourse[], avoidDays: ReadonlySet<string>): Slot[] {
  const out: Slot[] = [];
  for (const course of courses) {
    for (const slot of choicesOf(course) ?? []) {
      out.push({ ...slot, options: slot.options.filter((group) => !group.slots.some((meeting) => avoidDays.has(meeting.day))) });
    }
  }
  // Most constrained first keeps the search small.
  return out.sort((a, b) => a.options.length - b.options.length);
}

/** Backtracking: returns a clash-free choice per slot, null if none, 'budget' if cut off. */
function solve(slots: Slot[]): ScheduleGroup[] | null | 'budget' {
  const chosen: ScheduleGroup[] = [];
  let nodes = 0;
  const step = (index: number): boolean | 'budget' => {
    if (index === slots.length) return true;
    for (const option of slots[index].options) {
      if (++nodes > MAX_NODES) return 'budget';
      if (chosen.some((picked) => clashes(picked, option))) continue;
      chosen.push(option);
      const found = step(index + 1);
      if (found) return found;
      chosen.pop();
    }
    return false;
  };
  const found = step(0);
  if (found === 'budget') return 'budget';
  return found ? chosen : null;
}

export function checkTimetable(courses: readonly ScheduleCourse[], avoidDays: readonly string[] = []): TimetableResult {
  const usable = courses.filter((course) => course.found && choicesOf(course) !== null);
  const unknownCourseIds = courses.filter((course) => !usable.includes(course)).map((course) => course.courseId);
  const avoid = new Set(avoidDays);
  const slots = slotsFor(usable, avoid);
  const solution = solve(slots);
  const base = { unknownCourseIds, conflictingCoursePairs: [] as Array<[string, string]>, coursesBlockingFreeDays: [] as string[] };

  if (solution === 'budget') return { feasible: null, selection: [], daysUsed: [], ...base };
  if (solution) {
    const selection = slots.map((slot, index) => ({
      courseId: slot.courseId, kind: slot.kind, mode: slot.mode, groupId: solution[index].groupId, slots: solution[index].slots,
    }));
    const used = new Set(selection.flatMap((item) => item.slots.map((slot) => slot.day)));
    return { feasible: true, selection, daysUsed: WEEK_DAYS.filter((day) => used.has(day)), ...base };
  }

  // Explain the failure: which courses can't dodge the free days, which pairs clash.
  const coursesBlockingFreeDays = usable
    .filter((course) => slotsFor([course], avoid).some((slot) => slot.options.length === 0))
    .map((course) => course.courseId);
  const conflictingCoursePairs: Array<[string, string]> = [];
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      if (solve(slotsFor([usable[i], usable[j]], new Set())) === null) {
        conflictingCoursePairs.push([usable[i].courseId, usable[j].courseId]);
      }
    }
  }
  return { feasible: false, selection: [], daysUsed: [], unknownCourseIds, conflictingCoursePairs, coursesBlockingFreeDays };
}
