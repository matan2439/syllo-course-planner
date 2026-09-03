import SemesterColumn from './SemesterColumn'
import { EmptyState } from './ui'
import type { BoardVM } from '../../lib/board'
import type { PlannerDragPayload } from '../../lib/planner/drag-payload'

/**
 * Native semester board for the canonical planner. It renders the shared
 * board view model and delegates every manual mutation to the journey's
 * server-authority callbacks. The shared drag intent keeps feedback truthful
 * even when a browser hides DataTransfer contents during dragover.
 */
export default function NativePlannerBoard({ board, onRemoveCourse, onAddCourse, onMoveCourse, mutationPending = false, activeDrag, onDragStateChange }: {
  board: BoardVM
  onRemoveCourse?: (courseId: string) => void
  onAddCourse?: (courseId: string, semesterId: string) => void
  onMoveCourse?: (courseId: string, semesterId: string) => void
  mutationPending?: boolean
  activeDrag?: PlannerDragPayload | null
  onDragStateChange?: (drag: PlannerDragPayload | null) => void
}) {
  if (board.semesters.length === 0) {
    return <EmptyState>נתוני הלוח לתוכנית זו עדיין לא זמינים כאן</EmptyState>
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
    <div
      role="list"
      aria-label="לוח סמסטרים"
      className="grid min-w-full grid-flow-col auto-cols-[minmax(17rem,1fr)]"
    >
      {board.semesters.map((s, i) => (
        <div role="listitem" key={s.id} className="min-w-0">
          <SemesterColumn
            semester={s} index={i} onRemoveCourse={onRemoveCourse} onAddCourse={onAddCourse} onMoveCourse={onMoveCourse}
            moveDestinations={board.semesters
              .filter((destination) => destination.id !== s.id)
              .map((destination) => ({ semesterId: destination.id, label: destination.title }))}
            mutationPending={mutationPending}
            activeDrag={activeDrag}
            onDragStateChange={onDragStateChange}
          />
        </div>
      ))}
    </div>
    </div>
  )
}
