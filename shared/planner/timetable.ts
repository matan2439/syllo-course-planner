/**
 * Weekly-timetable solver for one semester, shared by the co-pilot's
 * check_timetable tool and the weekly schedule panel: pick one group per
 * required choice (lecture, recitation, lab… — primary and secondary are
 * separate choices) for every course, with no time overlap and nothing on the
 * free days, and among those the most convenient week for the bidding system.
 * Pure and deterministic; the data (bid-it, unofficial) is fetched by the caller.
 */
import { hasOverlap, type ScheduleCourse, type ScheduleGroup, type TimeSlot } from './schedule'

export const WEEK_DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'] as const
export type WeekDay = (typeof WEEK_DAYS)[number]

/** A lecture and its tutorial are separate choices; parallel groups of the same kind/mode are alternatives. */
export function choiceKey(group: Pick<ScheduleGroup, 'kind' | 'teachingMode'>): string {
  return `${group.kind}\u0000${group.teachingMode}`
}

export function groupsByChoice(groups: readonly ScheduleGroup[]): ScheduleGroup[][] {
  const byChoice = new Map<string, ScheduleGroup[]>()
  for (const group of groups) {
    const key = choiceKey(group)
    byChoice.set(key, [...(byChoice.get(key) ?? []), group])
  }
  return [...byChoice.values()]
}

/** The group number a student types into the bidding system. */
export function groupLabel(group: Pick<ScheduleGroup, 'havura' | 'groupId'>): string {
  return group.havura || group.groupId
}

/** One choice to make: which group of this kind + mode to take for `courseId`. */
interface Slot { courseId: string; kind: string; mode: string; options: ScheduleGroup[] }

export interface TimetableSelection {
  courseId: string; kind: string; mode: string; groupId: string; groupLabel: string; slots: TimeSlot[]
}

export interface TimetableResult {
  /** null when the search budget ran out before any answer. */
  feasible: boolean | null
  selection: TimetableSelection[]
  daysUsed: WeekDay[]
  /** Courses bid-it has no usable groups for — not checked. */
  unknownCourseIds: string[]
  /** When infeasible: course pairs that cannot be scheduled together (ignoring free days). */
  conflictingCoursePairs: Array<[string, string]>
  /** When infeasible: courses that cannot avoid the free days on their own. */
  coursesBlockingFreeDays: string[]
  /**
   * Groups the student chose themselves that sit on a free day or inside a busy time. A chosen
   * group is never replaced silently: it is kept, and the collision is reported here.
   */
  lockedConflicts: Array<{ courseId: string; groupId: string; reason: 'free_day' | 'busy_time' }>
  /** When infeasible: pairs of the student's own chosen groups that overlap each other. */
  lockedClashes: Array<[string, string]>
}

/** Choices the student already made: `${courseId}\0${choiceKey}` → groupId. Fixed while the group still exists. */
export type LockedChoices = Readonly<Record<string, string>>
export const lockKey = (courseId: string, group: Pick<ScheduleGroup, 'kind' | 'teachingMode'>) =>
  `${courseId}\u0000${choiceKey(group)}`

// ponytail: exhaustive backtracking within a node budget (a semester is ~6 courses × ~3 choices);
// add real branch-and-bound only if a semester ever hits the budget.
const MAX_NODES = 50_000
const EARLY_START = 10 * 60
const LATE_END = 18 * 60

const minutes = (time: string) => {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + (m || 0)
}

function clashes(a: ScheduleGroup, b: ScheduleGroup): boolean {
  return a.slots.some((x) => b.slots.some((y) => hasOverlap(x, y)))
}

/**
 * A course's required choices. Only groups with meeting times are options; `null` when some
 * required choice has no timed group at all, so the course cannot be checked.
 */
function choicesOf(course: ScheduleCourse): Slot[] | null {
  const slots: Slot[] = []
  for (const groups of groupsByChoice(course.groups)) {
    const timed = groups.filter((group) => group.slots.length > 0)
    if (!timed.length) return null
    slots.push({ courseId: course.courseId, kind: groups[0].kind, mode: groups[0].teachingMode, options: timed })
  }
  return slots.length ? slots : null
}

function slotsFor(
  courses: readonly ScheduleCourse[], avoidDays: ReadonlySet<string>, locked: LockedChoices = {}, busyTimes: readonly TimeSlot[] = [],
  lockedConflicts?: TimetableResult['lockedConflicts'],
): Slot[] {
  const out: Slot[] = []
  for (const course of courses) {
    for (const slot of choicesOf(course) ?? []) {
      const onFreeDay = (group: ScheduleGroup) => group.slots.some((meeting) => avoidDays.has(meeting.day))
      const inBusyTime = (group: ScheduleGroup) => group.slots.some((meeting) => busyTimes.some((busy) => hasOverlap(meeting, busy)))
      const lockedId = locked[lockKey(slot.courseId, { kind: slot.kind, teachingMode: slot.mode })]
      // The student's own choice is a hard constraint: it stays even on a free day or in a busy
      // time, and the collision is reported instead of the group being swapped behind their back.
      const pinned = slot.options.find((group) => group.groupId === lockedId)
      if (pinned) {
        if (onFreeDay(pinned)) lockedConflicts?.push({ courseId: slot.courseId, groupId: pinned.groupId, reason: 'free_day' })
        else if (inBusyTime(pinned)) lockedConflicts?.push({ courseId: slot.courseId, groupId: pinned.groupId, reason: 'busy_time' })
        out.push({ ...slot, options: [pinned] })
        continue
      }
      out.push({ ...slot, options: slot.options.filter((group) => !onFreeDay(group) && !inBusyTime(group)) })
    }
  }
  // Most constrained first keeps the search small.
  return out.sort((a, b) => a.options.length - b.options.length)
}

/**
 * How inconvenient a week is, compared in order: campus days, idle minutes between
 * meetings on the same day, meetings starting before 10:00 or ending after 18:00.
 */
export function weekCost(groups: readonly Pick<ScheduleGroup, 'slots'>[]): [number, number, number] {
  const byDay = new Map<string, Array<[number, number]>>()
  let offHours = 0
  for (const slot of groups.flatMap((group) => group.slots)) {
    const range: [number, number] = [minutes(slot.start), minutes(slot.end)]
    byDay.set(slot.day, [...(byDay.get(slot.day) ?? []), range])
    if (range[0] < EARLY_START || range[1] > LATE_END) offHours++
  }
  let gaps = 0
  for (const ranges of byDay.values()) {
    ranges.sort((a, b) => a[0] - b[0])
    let end = ranges[0][1]
    for (const [start, finish] of ranges.slice(1)) {
      gaps += Math.max(0, start - end)
      end = Math.max(end, finish)
    }
  }
  return [byDay.size, gaps, offHours]
}

const better = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
  return false
}

/** The most convenient clash-free choice per slot; null if none; 'budget' if cut off before any. */
function solve(slots: Slot[]): ScheduleGroup[] | null | 'budget' {
  const chosen: ScheduleGroup[] = []
  let best: { groups: ScheduleGroup[]; cost: number[] } | null = null
  let nodes = 0
  let cutOff = false
  const daysOf = () => new Set(chosen.flatMap((group) => group.slots.map((slot) => slot.day))).size
  const step = (index: number): void => {
    if (index === slots.length) {
      const cost = weekCost(chosen)
      if (!best || better(cost, best.cost)) best = { groups: [...chosen], cost }
      return
    }
    for (const option of slots[index].options) {
      if (++nodes > MAX_NODES) { cutOff = true; return }
      if (chosen.some((picked) => clashes(picked, option))) continue
      chosen.push(option)
      // Days only grow as more groups are added: a partial week already past the best cannot win.
      if (!best || daysOf() <= (best as { cost: number[] }).cost[0]) step(index + 1)
      chosen.pop()
      if (cutOff) return
    }
  }
  step(0)
  if (best) return (best as { groups: ScheduleGroup[] }).groups
  return cutOff ? 'budget' : null
}

export function checkTimetable(
  courses: readonly ScheduleCourse[],
  avoidDays: readonly string[] = [],
  locked: LockedChoices = {},
  busyTimes: readonly TimeSlot[] = [],
): TimetableResult {
  const usable = courses.filter((course) => course.found && choicesOf(course) !== null)
  const unknownCourseIds = courses.filter((course) => !usable.includes(course)).map((course) => course.courseId)
  const avoid = new Set(avoidDays)
  const lockedConflicts: TimetableResult['lockedConflicts'] = []
  const slots = slotsFor(usable, avoid, locked, busyTimes, lockedConflicts)
  const solution = solve(slots)
  const base = { unknownCourseIds, conflictingCoursePairs: [] as Array<[string, string]>, coursesBlockingFreeDays: [] as string[],
    lockedConflicts, lockedClashes: [] as Array<[string, string]> }

  if (solution === 'budget') return { feasible: null, selection: [], daysUsed: [], ...base }
  if (solution) {
    const selection = slots.map((slot, index) => ({
      courseId: slot.courseId,
      kind: slot.kind,
      mode: slot.mode,
      groupId: solution[index].groupId,
      groupLabel: groupLabel(solution[index]),
      slots: solution[index].slots,
    }))
    const used = new Set(selection.flatMap((item) => item.slots.map((slot) => slot.day)))
    return { feasible: true, selection, daysUsed: WEEK_DAYS.filter((day) => used.has(day)), ...base }
  }

  // Explain the failure: which courses can't dodge the free days or busy times, which pairs clash
  // (with the student's chosen groups kept), and which chosen groups overlap each other.
  const coursesBlockingFreeDays = usable
    .filter((course) => slotsFor([course], avoid, locked, busyTimes).some((slot) => slot.options.length === 0))
    .map((course) => course.courseId)
  const conflictingCoursePairs: Array<[string, string]> = []
  const lockedClashes: Array<[string, string]> = []
  const lockedGroupsOf = (course: ScheduleCourse) => course.groups.filter((group) =>
    group.slots.length > 0 && locked[lockKey(course.courseId, group)] === group.groupId)
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      if (lockedGroupsOf(usable[i]).some((a) => lockedGroupsOf(usable[j]).some((b) => clashes(a, b)))) {
        lockedClashes.push([usable[i].courseId, usable[j].courseId])
      } else if (solve(slotsFor([usable[i], usable[j]], new Set(), locked)) === null) {
        conflictingCoursePairs.push([usable[i].courseId, usable[j].courseId])
      }
    }
  }
  return { feasible: false, selection: [], daysUsed: [], unknownCourseIds, conflictingCoursePairs, coursesBlockingFreeDays, lockedConflicts, lockedClashes }
}
