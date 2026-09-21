import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BoardModel, GeneratedPlanModel } from '../../../../shared/planner/model'
import { boardModelToVM } from '../../../lib/planner/board-vm'
import type { CourseVM } from '../../../lib/board'
import type { PlannerDragPayload } from '../../../lib/planner/drag-payload'
import { adaptRequirementsFromModel } from '../../../lib/requirements'
import AlternativeBoardSwitcher from './AlternativeBoardSwitcher'
import NativePlannerBoard from './NativePlannerBoard'
import ProgressBadge from './ProgressBadge'

type Highlight = { semesterId: string; key: number } | null

function withDiffMarkers(board: ReturnType<typeof boardModelToVM>, markers?: Readonly<Record<string, 'new' | 'moved'>>) {
  if (!markers) return board
  return {
    ...board,
    semesters: board.semesters.map((semester) => ({
      ...semester,
      courses: semester.courses.map((course) => {
        const diffMarker = markers[`${semester.id}|${course.id}`]
        return diffMarker ? { ...course, diffMarker } : course
      }),
    })),
  }
}

/**
 * The board with its progress badge and, when a proposal offers several plans, the switcher.
 * While a proposal or one of its alternatives is previewed the board is read-only, changed cards carry a
 * marker, and nothing is saved.
 */
export default function CurrentPlanSection({
  current, previewBoard, diffMarkers, alternatives, selectedAlternativeId, onSelectAlternative, stale,
  commitManualRemove, commitManualAdd, commitManualMove, selectBoardCourse, manualEditPhase,
  activeDrag, rejectedDrop, justPlaced, onDragStateChange,
}: {
  current: BoardModel
  /** The proposal (or selected alternative) applied to the current board, or null when none is being previewed. */
  previewBoard: BoardModel | null
  /** `${semesterId}|${courseId}` → how that placement differs from the committed plan (preview only). */
  diffMarkers?: Readonly<Record<string, 'new' | 'moved'>>
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
  // The progress badge lives in the shell's top bar when the page provides the slot; inline otherwise.
  const [progressSlot, setProgressSlot] = useState<HTMLElement | null>(null)
  useEffect(() => { setProgressSlot(document.getElementById('shell-progress-slot')) }, [])
  const badge = <ProgressBadge requirements={adaptRequirementsFromModel(previewBoard ?? current)} />
  return (
    <section aria-label="התוכנית הנוכחית">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold tracking-tight">התוכנית הנוכחית</h2>
          {progressSlot ? createPortal(badge, progressSlot) : badge}
        </div>
        {previewBoard && <span className="text-xs text-[var(--text-muted)]">תצוגה מקדימה של ההצעה — לא נשמר עד לאישור מפורש</span>}
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
        board={withDiffMarkers(boardModelToVM(previewBoard ?? current), previewBoard ? diffMarkers : undefined)}
        onRemoveCourse={previewBoard ? undefined : commitManualRemove}
        onAddCourse={previewBoard ? undefined : (courseId, semesterId) => commitManualAdd(semesterId, courseId)}
        onMoveCourse={previewBoard ? undefined : commitManualMove}
        onSelectCourse={selectBoardCourse}
        mutationPending={previewBoard || manualEditPhase === 'saving' ? true : false}
        activeDrag={previewBoard ? null : activeDrag}
        rejectedSemesterId={previewBoard ? null : rejectedDrop?.semesterId}
        rejectedDropKey={previewBoard ? null : rejectedDrop?.key}
        justPlacedSemesterId={previewBoard ? null : justPlaced?.semesterId}
        justPlacedKey={previewBoard ? null : justPlaced?.key}
        onDragStateChange={previewBoard ? undefined : onDragStateChange}
        readOnly={Boolean(previewBoard)}
      />
    </section>

  )
}
