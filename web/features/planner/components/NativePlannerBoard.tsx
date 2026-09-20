import SemesterColumn from './SemesterColumn'
import SemesterColumnHeader from './SemesterColumnHeader'
import AnnualCourseBand from './AnnualCourseBand'
import CategoryLegend from './CategoryLegend'
import { EmptyState } from '../../../components/ui'
import type { BoardVM, CourseVM } from '../../../lib/board'
import type { PlannerDragPayload } from '../../../lib/planner/drag-payload'
import { annualBandsOf } from '../../../lib/planner/annual-bands'

/**
 * Native semester board for the canonical planner. It renders the shared
 * board view model and delegates every manual mutation to the journey's
 * server-authority callbacks. The shared drag intent keeps feedback truthful
 * even when a browser hides DataTransfer contents during dragover.
 *
 * Semesters are grouped into year-pairs (a/b), each its own small CSS grid:
 * both headers in row 1, an annual course's spanning card (if that year has
 * one) in row 2, then each semester's own remaining courses in row 3 — so an
 * annual course sits right under the headers, in the same course-list area
 * as everything else, instead of a separately-styled block elsewhere on the
 * page. A year-pair with no annual course simply has no row 2.
 */
export default function NativePlannerBoard({ board, onRemoveCourse, onAddCourse, onMoveCourse, onSelectCourse, mutationPending = false, activeDrag, rejectedSemesterId, rejectedDropKey, justPlacedSemesterId, justPlacedKey, onDragStateChange, readOnly = false }: {
  board: BoardVM
  onRemoveCourse?: (courseId: string) => void
  onAddCourse?: (courseId: string, semesterId: string) => void
  onMoveCourse?: (courseId: string, semesterId: string) => void
  /** Opens the read-only details panel (with the per-course AI chat) for a board course. Allowed even in readOnly mode — viewing details is not a mutation. */
  onSelectCourse?: (course: CourseVM) => void
  mutationPending?: boolean
  activeDrag?: PlannerDragPayload | null
  /** The last target refused by server-side academic validation. */
  rejectedSemesterId?: string | null
  /** Changes on every refusal so the target feedback animation restarts. */
  rejectedDropKey?: string | number | null
  /** The semester a manual add/move most recently landed in successfully. */
  justPlacedSemesterId?: string | null
  /** Changes on every successful placement so the confirmation animation restarts. */
  justPlacedKey?: string | number | null
  onDragStateChange?: (drag: PlannerDragPayload | null) => void
  readOnly?: boolean
}) {
  if (board.semesters.length === 0) {
    return <EmptyState>נתוני הלוח לתוכנית זו עדיין לא זמינים כאן</EmptyState>
  }
  const bandByStartIndex = new Map(annualBandsOf(board).map((band) => [band.startIndex, band]))
  const pairs: Array<{ start: number; semesters: typeof board.semesters }> = []
  for (let i = 0; i < board.semesters.length; i += 2) {
    pairs.push({ start: i, semesters: board.semesters.slice(i, i + 2) })
  }

  return (
    <div className="flex flex-col gap-2">
    <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
    <div
      role="list"
      aria-label="לוח סמסטרים"
      className="flex min-w-full items-start"
    >
      {pairs.map((pair) => {
        const band = bandByStartIndex.get(pair.start)
        return (
          <div
            key={pair.start}
            className="grid shrink-0 flex-1"
            style={{
              gridTemplateColumns: `repeat(${pair.semesters.length}, minmax(17rem, 1fr))`,
              // A flex item is allowed to shrink below its grid tracks unless
              // it owns an explicit minimum. Keep each year-pair as wide as
              // its two semester columns; the outer shell then scrolls on
              // narrow screens instead of allowing paired grids to overlap.
              minWidth: `${17 * pair.semesters.length}rem`,
            }}
          >
            {pair.semesters.map((s, j) => {
              const isLastOverall = pair.start + j === board.semesters.length - 1
              return (
                <div key={`${s.id}-header`} style={{ gridColumn: j + 1, gridRow: 1 }} className={`min-w-0 border-l border-[var(--border)] ${isLastOverall ? 'border-l-0' : ''}`}>
                  <SemesterColumnHeader semester={s} />
                </div>
              )
            })}
            {band && (
              <AnnualCourseBand
                course={band.course}
                onRemove={readOnly ? undefined : onRemoveCourse}
                onSelect={onSelectCourse}
              />
            )}
            {pair.semesters.map((s, j) => {
              const isLastOverall = pair.start + j === board.semesters.length - 1
              return (
              <div
                role="listitem"
                key={s.id}
                className={`min-w-0 border-l border-[var(--border)] ${isLastOverall ? 'border-l-0' : ''}`}
                style={{ gridColumn: j + 1, gridRow: band ? 3 : 2 }}
              >
                <SemesterColumn
                  semester={s} index={pair.start + j} onRemoveCourse={readOnly ? undefined : onRemoveCourse} onAddCourse={readOnly ? undefined : onAddCourse} onMoveCourse={readOnly ? undefined : onMoveCourse}
                  onSelectCourse={onSelectCourse}
                  moveDestinations={board.semesters
                    .filter((destination) => destination.id !== s.id)
                    .map((destination) => ({ semesterId: destination.id, label: destination.title }))}
                  mutationPending={readOnly || mutationPending}
                  activeDrag={readOnly ? null : activeDrag}
                  rejected={rejectedSemesterId === s.id}
                  rejectedKey={rejectedDropKey}
                  justPlaced={justPlacedSemesterId === s.id}
                  justPlacedKey={justPlacedKey}
                  onDragStateChange={readOnly ? undefined : onDragStateChange}
                />
              </div>
              )
            })}
          </div>
        )
      })}
    </div>
    </div>
    <CategoryLegend />
    </div>
  )
}
