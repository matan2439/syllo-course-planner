/**
 * The visible two-year window: the single source of truth for which four
 * semester slots the weekly schedule shows. A slot's identity is its stable
 * canonical id (`year_N_semester_a|b`); its button text is derived from that id
 * by semesterTitleHe, never stored alongside it.
 */
import { semesterTitleHe } from './board-vm'
import { windowBoardId } from '../../../shared/planner/window_board'

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

/** The student's current year in the degree — a profile fact, not UI state. */
export type DegreeYear = 1 | 2 | 3 | 4
export const DEGREE_YEARS: readonly DegreeYear[] = [1, 2, 3, 4]

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
