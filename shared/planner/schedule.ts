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

/**
 * Default academic-term mapping for a list of board semester ids, in order:
 * 4 consecutive terms (year, 1|2) starting from the CURRENT calendar term.
 * August–January of year Y is treated as Y/סמסטר א׳; February–July is
 * סמסטר ב׳ of the year that started the previous August. Editable per-column
 * afterward — this is only the starting default.
 */
export function defaultTermMapping(
  semesterIds: readonly string[],
  today: Date,
): Record<string, SemesterTerm> {
  const month = today.getMonth() + 1; // 1-12
  const isAugustOrLater = month >= 8;
  const startYear = isAugustOrLater ? today.getFullYear() : today.getFullYear() - 1;
  const startSemester: 1 | 2 = isAugustOrLater ? 1 : 2;

  const mapping: Record<string, SemesterTerm> = {};
  semesterIds.forEach((id, index) => {
    // Calculate which academic term this index represents
    const totalSemestersFromStart = index;
    const year = startYear + Math.floor((startSemester - 1 + totalSemestersFromStart) / 2);
    const semester: 1 | 2 = ((startSemester - 1 + totalSemestersFromStart) % 2) + 1 as 1 | 2;
    mapping[id] = { year, semester };
  });
  return mapping;
}
