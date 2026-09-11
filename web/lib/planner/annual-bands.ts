import type { BoardVM, CourseVM } from '../board'

export type AnnualBand = { course: CourseVM; startIndex: number }

/**
 * A year-long course appears once in each of its year's two semester
 * columns (isAnnual: true on both). De-duplicate it into ONE band per
 * year-pair, positioned at the pair's first (even) index — so it can be
 * rendered once, spanning both columns, instead of as two independent cards.
 * Assumes the canonical 4-semester a/b/a/b ordering (SEMESTER_ORDER).
 */
export function annualBandsOf(board: BoardVM): AnnualBand[] {
  const bands: AnnualBand[] = []
  for (let i = 0; i + 1 < board.semesters.length; i += 2) {
    const seen = new Set<string>()
    for (const semester of [board.semesters[i], board.semesters[i + 1]]) {
      for (const course of semester.courses) {
        if (!course.isAnnual || seen.has(course.id)) continue
        seen.add(course.id)
        bands.push({ course, startIndex: i })
      }
    }
  }
  return bands
}
