/**
 * The visible two-year window: the single source of truth for which four
 * semester slots the weekly schedule shows. A slot's identity is its stable
 * canonical id (`year_N_semester_a|b`); its button text is derived from that id
 * by semesterTitleHe, never stored alongside it.
 */
import { semesterTitleHe } from './board-vm'

export type SemesterWindow = 'early' | 'late'

/** Years 3–4 — the planner's original four tabs. */
export const DEFAULT_SEMESTER_WINDOW: SemesterWindow = 'late'

const FIRST_YEAR: Record<SemesterWindow, number> = { early: 1, late: 3 }

export function semesterWindowSlots(window: SemesterWindow = DEFAULT_SEMESTER_WINDOW): { id: string; label: string }[] {
  const first = FIRST_YEAR[window]
  return [first, first + 1].flatMap((year) =>
    (['a', 'b'] as const).map((half) => {
      const id = `year_${year}_semester_${half}`
      return { id, label: semesterTitleHe(id) }
    }),
  )
}
