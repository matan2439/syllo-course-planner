import type { BoardModel, GeneratedPlanModel } from '../../../../shared/planner/model'
import { boardModelToVM } from '../../../lib/planner/board-vm'
import type { CourseVM } from '../../../lib/board'
import type { PlannerDragPayload } from '../../../lib/planner/drag-payload'
import { adaptRequirementsFromModel } from '../../../lib/requirements'
import AlternativeBoardSwitcher from './AlternativeBoardSwitcher'
import NativePlannerBoard from './NativePlannerBoard'
import ProgressBadge from './ProgressBadge'

type Highlight = { semesterId: string; key: number } | null

/**
 * The board with its progress badge and, when a proposal offers several plans, the switcher.
 * While an alternative is being previewed the board is read-only and nothing is saved.
 */
export default function CurrentPlanSection({
  current, alternativeBoard, alternatives, selectedAlternativeId, onSelectAlternative, stale,
  commitManualRemove, commitManualAdd, commitManualMove, selectBoardCourse, manualEditPhase,
  activeDrag, rejectedDrop, justPlaced, onDragStateChange,
}: {
  current: BoardModel
  /** The selected alternative applied to the current board, or null when none is being previewed. */
  alternativeBoard: BoardModel | null
  alternatives: GeneratedPlanModel['alternatives']
  selectedAlternativeId: string | null
  onSelectAlternative: (candidateId: string) => void
  stale: boolean
  commitManualRemove: (courseId: string) => void
  commitManualAdd: (semesterId: string, courseId?: string) => void
  commitManualMove: (courseId: string, semesterId: string) => void
  selectBoardCourse: (course: CourseVM) => void
  manualEditPhase: 'idle' | 'saving'
  activeDrag?: PlannerDragPayload | null
  rejectedDrop: Highlight
  justPlaced: Highlight
  onDragStateChange?: (drag: PlannerDragPayload | null) => void
}) {
  return (
    <section aria-label="התוכנית הנוכחית">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold tracking-tight">התוכנית הנוכחית</h2>
          <ProgressBadge requirements={adaptRequirementsFromModel(current)} />
        </div>
        {alternativeBoard && <span className="text-xs text-[var(--text-muted)]">לא נשמר עד לאישור מפורש</span>}
      </div>
      {(alternatives?.length ?? 0) >= 2 && (
        <AlternativeBoardSwitcher
          alternatives={alternatives!}
          selectedId={selectedAlternativeId ?? ''}
          onSelect={onSelectAlternative}
          courseNameById={Object.fromEntries(
            Object.entries(current.courseCatalog).map(([id, course]) => [id, course.nameHe || null]),
          )}
          disabled={stale}
        />
      )}
      <NativePlannerBoard
        board={boardModelToVM(alternativeBoard ?? current)}
        onRemoveCourse={alternativeBoard ? undefined : commitManualRemove}
        onAddCourse={alternativeBoard ? undefined : (courseId, semesterId) => commitManualAdd(semesterId, courseId)}
        onMoveCourse={alternativeBoard ? undefined : commitManualMove}
        onSelectCourse={selectBoardCourse}
        mutationPending={alternativeBoard || manualEditPhase === 'saving' ? true : false}
        activeDrag={alternativeBoard ? null : activeDrag}
        rejectedSemesterId={alternativeBoard ? null : rejectedDrop?.semesterId}
        rejectedDropKey={alternativeBoard ? null : rejectedDrop?.key}
        justPlacedSemesterId={alternativeBoard ? null : justPlaced?.semesterId}
        justPlacedKey={alternativeBoard ? null : justPlaced?.key}
        onDragStateChange={alternativeBoard ? undefined : onDragStateChange}
        readOnly={Boolean(alternativeBoard)}
      />
    </section>

  )
}
