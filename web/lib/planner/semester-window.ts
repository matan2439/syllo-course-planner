/**
 * The visible two-year window: the single source of truth for which four
 * semester slots the weekly schedule shows. A slot's identity is its stable
 * canonical id (`year_N_semester_a|b`); its button text is derived from that id
 * by semesterTitleHe, never stored alongside it.
 */
import { semesterTitleHe } from './board-vm'
import { MAX_DEGREE_YEAR, windowBoardId } from '../../../shared/planner/window_board'

export type SemesterWindow = 'early' | 'late'

/** Years 3–4 — the planner's original four tabs. */
export const DEFAULT_SEMESTER_WINDOW: SemesterWindow = 'late'

const FIRST_YEAR: Record<SemesterWindow, number> = { early: 1, late: 3 }
export const SEMESTER_WINDOWS = Object.keys(FIRST_YEAR) as SemesterWindow[]

/**
 * The board that plans a window: the program's published board when it starts at the
 * window's first year (its metadata.start_year), otherwise the program's window board.
 */
export function windowBoardIdFor(programId: string, window: SemesterWindow, publishedStartYear: unknown): string {
  return publishedStartYear === FIRST_YEAR[window] ? programId : windowBoardId(programId, FIRST_YEAR[window])
}

export function semesterWindowSlots(window: SemesterWindow = DEFAULT_SEMESTER_WINDOW): { id: string; label: string }[] {
  const first = FIRST_YEAR[window]
  return [first, first + 1].flatMap((year) =>
    (['a', 'b'] as const).map((half) => {
      const id = `year_${year}_semester_${half}`
      return { id, label: semesterTitleHe(id) }
    }),
  )
}

const plansWindow = (slots: readonly { id: string }[], boardSemesterIds: readonly string[]) =>
  boardSemesterIds.some((id) => slots.some((slot) => slot.id === id))

/**
 * The window's tabs fitted to the degree's real length and grown by the semesters the student added
 * (e.g. year_5_semester_a): a 3-year degree's board has no Year 4, so those tabs go, and Year 4 comes
 * back once the student adds it. A board that does not plan the window leaves it as is.
 */
export function scheduleSlotsForBoard(window: SemesterWindow, boardSemesterIds: readonly string[]) {
  const slots = semesterWindowSlots(window)
  if (!plansWindow(slots, boardSemesterIds)) return slots
  return withAddedSemesters(slots.filter((slot) => boardSemesterIds.includes(slot.id)), boardSemesterIds)
}

/**
 * `slots`, then the board's columns past the last one (semesters the student added, e.g.
 * year_5_semester_a) in rank order, flagged `added`. Without such columns this is `slots` itself.
 */
export function withAddedSemesters<T extends { id: string; label: string }>(
  slots: readonly T[], boardSemesterIds: readonly string[],
): Array<T | { id: string; label: string; added: true }> {
  // Only a board that plans these slots (shares a column with them) extends them.
  if (!plansWindow(slots, boardSemesterIds)) return [...slots]
  const last = Math.max(-1, ...slots.map((slot) => semesterRank(slot.id) ?? -1))
  const added = boardSemesterIds
    .filter((id) => (semesterRank(id) ?? -1) > last)
    .sort((a, b) => semesterRank(a)! - semesterRank(b)!)
    .map((id) => ({ id, label: semesterTitleHe(id), added: true as const }))
  return added.length ? [...slots, ...added] : [...slots]
}

const semesterRank = (id: string): number | null => {
  const m = /^year_(\d+)_semester_([ab])$/.exec(id)
  return m ? Number(m[1]) * 2 + (m[2] === 'b' ? 1 : 0) : null
}

/** The semester after the board's latest column, or null once that would pass MAX_DEGREE_YEAR. */
export function nextSemesterId(boardSemesterIds: readonly string[]): string | null {
  const ranks = boardSemesterIds.map(semesterRank).filter((rank): rank is number => rank !== null)
  if (!ranks.length) return null
  const next = Math.max(...ranks) + 1
  return next / 2 >= MAX_DEGREE_YEAR + 1 ? null : `year_${Math.floor(next / 2)}_semester_${next % 2 ? 'b' : 'a'}`
}

/** The student's current year in the degree — a profile fact, not UI state. Degrees may run past year 4. */
export type DegreeYear = 1 | 2 | 3 | 4 | 5 | 6
export const DEGREE_YEARS: readonly DegreeYear[] = [1, 2, 3, 4, 5, 6]
/** Device cache of the profile's current degree year (the account profile is the source when signed in). */
export const CURRENT_DEGREE_YEAR_KEY = 'syllo_current_degree_year'
export const DEGREE_YEAR_LABELS: Record<DegreeYear, string> = {
  1: 'שנה א׳', 2: 'שנה ב׳', 3: 'שנה ג׳', 4: 'שנה ד׳', 5: 'שנה ה׳', 6: 'שנה ו׳',
}

/** Years 1–4 always; a later year only once the board has a semester in it (or it is the chosen year). */
export function degreeYearsForBoard(semesterIds: readonly string[], chosen?: DegreeYear | null): DegreeYear[] {
  const added = new Set(semesterIds.map((id) => Number(/^year_(\d+)_/.exec(id)?.[1])))
  return DEGREE_YEARS.filter((year) => year <= 4 || added.has(year) || year === chosen)
}

/** The one place that maps the student's year to the visible window. Unknown year → the default. */
export function semesterWindowForDegreeYear(year: DegreeYear | null | undefined): SemesterWindow {
  if (!year) return DEFAULT_SEMESTER_WINDOW
  return year <= 2 ? 'early' : 'late'
}

/**
 * The selected semester, guaranteed to be one of `slotIds`. A still-valid selection is kept;
 * otherwise the student's current year in the same half (א/ב), else the first slot of that half.
 * `''` (nothing picked yet) resolves to the current year's semester א.
 */
export function resolveSelectedSemester(
  slotIds: readonly string[], selectedId: string, currentYear?: DegreeYear | null,
): string {
  if (slotIds.includes(selectedId)) return selectedId
  const half = selectedId.endsWith('_b') ? 'b' : 'a'
  const preferred = `year_${currentYear}_semester_${half}`
  if (currentYear && slotIds.includes(preferred)) return preferred
  return slotIds.find((id) => id.endsWith(`_${half}`)) ?? slotIds[0] ?? ''
}
