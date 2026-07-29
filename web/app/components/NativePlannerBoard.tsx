import SemesterColumn from './SemesterColumn'
import { EmptyState } from './ui'
import type { BoardVM } from '../../lib/board'

/**
 * Read-only native semester board (Slice 1). Purely presentational: it accepts a
 * BoardVM (produced from the canonical shared/planner path via boardModelToVM)
 * and reuses the existing read-only SemesterColumn/CourseCard. No data fetching,
 * no mutation, no draft/apply — those arrive in later slices. Not wired to any
 * route or navigation yet.
 */
export default function NativePlannerBoard({ board }: { board: BoardVM }) {
  if (board.semesters.length === 0) {
    return <EmptyState>נתוני הלוח לתוכנית זו עדיין לא זמינים כאן</EmptyState>
  }
  return (
    <div
      role="list"
      aria-label="לוח סמסטרים"
      className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4"
    >
      {board.semesters.map((s, i) => (
        <div role="listitem" key={s.id} className="min-w-0">
          <SemesterColumn semester={s} index={i} />
        </div>
      ))}
    </div>
  )
}
