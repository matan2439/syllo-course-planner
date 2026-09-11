import SemesterColumn from './SemesterColumn'
import CategoryLegend from './CategoryLegend'
import { EmptyState } from './ui'
import type { BoardVM, CourseVM } from '../../lib/board'
import type { PlannerDragPayload } from '../../lib/planner/drag-payload'

/**
 * Native semester board for the canonical planner. It renders the shared
 * board view model and delegates every manual mutation to the journey's
 * server-authority callbacks. The shared drag intent keeps feedback truthful
 * even when a browser hides DataTransfer contents during dragover.
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
  return (
    <div className="flex flex-col gap-2">
    <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
    <div
      role="list"
      aria-label="לוח סמסטרים"
      className="grid min-w-full grid-flow-col auto-cols-[minmax(17rem,1fr)]"
    >
      {board.semesters.map((s, i) => (
        <div role="listitem" key={s.id} className="min-w-0">
          <SemesterColumn
            semester={s} index={i} onRemoveCourse={readOnly ? undefined : onRemoveCourse} onAddCourse={readOnly ? undefined : onAddCourse} onMoveCourse={readOnly ? undefined : onMoveCourse}
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
      ))}
    </div>
    </div>
    <CategoryLegend />
    </div>
  )
}
