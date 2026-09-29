/**
 * Weekly-timetable wire contract, shared between the schedule-groups
 * serverless endpoint (api/ai/schedule-groups.ts) and the web client
 * (web/lib/planner/schedule-client.ts, WeeklyScheduleDrawer). Also holds the
 * one hard product rule: two selected groups may never overlap in time.
 *
 * Source: bid-it's public, unauthenticated endpoints — NOT an official TAU
 * academic authority. Every response carries `source` + `fetchedAt` so the UI
 * can label it accordingly, per the design spec
 * (docs/superpowers/specs/2026-09-10-weekly-timetable-design.md).
 */

export interface TimeSlot {
  day: string; // א..ו
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export interface ScheduleGroup {
  groupId: string; // bid-it gNum, e.g. "01"
  havura: string;
  kind: string; // ראשית / משנית
  teachingMode: string; // ofenHoraa, e.g. "שיעור", "תרגיל"
  lecturer: string | null;
  room: string | null;
  /** A group can meet more than once a week (e.g. Sun + Wed) — one slot per meeting. */
  slots: TimeSlot[];
}

export interface ScheduleCourse {
  courseId: string; // dashed form, e.g. "0542-2400"
  nameHe: string | null;
  /** The academic year bid-it actually returned for this course, or null if not found. */
  cYear: number | null;
  found: boolean;
  /** true when found but at least one group has no usable day/time data. */
  incompleteData: boolean;
  groups: ScheduleGroup[];
}

export interface ScheduleGroupsResponse {
  semester: 1 | 2;
  courses: ScheduleCourse[];
  source: 'bidit';
  fetchedAt: string; // ISO timestamp
}

export interface CourseSearchResult {
  courseId: string; // dashed form
  nameHe: string;
}

export interface CourseSearchResponse {
  results: CourseSearchResult[];
  source: 'bidit';
  fetchedAt: string;
}

export interface SemesterTerm {
  year: number;
  semester: 1 | 2;
}

/** Same day, and the two ranges actually intersect (half-open: touching ends do not overlap). */
export function hasOverlap(a: TimeSlot, b: TimeSlot): boolean {
  if (a.day !== b.day) return false;
  return a.start < b.end && a.end > b.start;
}

/** True if ANY slot of `a` overlaps ANY slot of `b` — the hard product rule. */
export function groupsOverlap(
  a: Pick<ScheduleGroup, 'slots'>,
  b: Pick<ScheduleGroup, 'slots'>,
): boolean {
  return a.slots.some((slotA) => b.slots.some((slotB) => hasOverlap(slotA, slotB)));
}

/** August–January is סמסטר א׳ of the academic year that started that August; February–July is סמסטר ב׳. */
function currentTerm(today: Date): SemesterTerm {
  const month = today.getMonth() + 1; // 1-12
  const inFirstHalf = month >= 8 || month === 1;
  const startYear = month >= 8 ? today.getFullYear() : today.getFullYear() - 1;
  return { year: startYear, semester: inFirstHalf ? 1 : 2 };
}

const SLOT_ID = /^year_(\d+)_semester_([ab])$/;

/** The board semester the student is in now (`year_2_semester_b`), or null when their year is unknown. */
export function currentSemesterId(degreeYear: number | null | undefined, today: Date): string | null {
  if (!degreeYear) return null;
  return `year_${degreeYear}_semester_${currentTerm(today).semester === 1 ? 'a' : 'b'}`;
}

/**
 * Academic term of each board semester id. סמסטר א׳/ב׳ comes from the id itself
 * (`…_semester_a|b`), never from its position. The year is the current academic year
 * shifted by how far the column's degree year is from the student's (`degreeYear`);
 * with the year unknown, the first column is taken as the current degree year.
 * Ids outside the `year_N_semester_a|b` convention fall back to consecutive terms
 * from the current one.
 */
export function defaultTermMapping(
  semesterIds: readonly string[],
  today: Date,
  degreeYear?: number | null,
): Record<string, SemesterTerm> {
  const now = currentTerm(today);
  const firstSlotYear = semesterIds.map((id) => SLOT_ID.exec(id)).find(Boolean)?.[1];
  const anchorYear = degreeYear ?? (firstSlotYear ? Number(firstSlotYear) : 1);

  const mapping: Record<string, SemesterTerm> = {};
  semesterIds.forEach((id, index) => {
    const slot = SLOT_ID.exec(id);
    if (slot) {
      mapping[id] = { year: now.year + Number(slot[1]) - anchorYear, semester: slot[2] === 'a' ? 1 : 2 };
      return;
    }
    const offset = now.semester - 1 + index;
    mapping[id] = { year: now.year + Math.floor(offset / 2), semester: ((offset % 2) + 1) as 1 | 2 };
  });
  return mapping;
}
