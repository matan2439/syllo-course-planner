import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { fromHalfHours, type BoardModel, type GeneratedPlanModel } from '../../../../shared/planner/model'
import { boardModelToVM } from '../../../lib/planner/board-vm'
import type { CourseVM } from '../../../lib/board'
import type { PlannerDragPayload } from '../../../lib/planner/drag-payload'
import { adaptRequirementsFromModel } from '../../../lib/requirements'
import AlternativeBoardSwitcher from './AlternativeBoardSwitcher'
import NativePlannerBoard from './NativePlannerBoard'
import ProgressBadge, { type CategoryProgress } from './ProgressBadge'

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
  activeDrag, rejectedDrop, justPlaced, onDragStateChange, completedCredit, completedCategoryCounts = {},
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
  /** Completed course → credit hours; those not on the shown board count toward progress. */
  completedCredit?: Readonly<Record<string, number>>
  /** Category id → completed courses the student counted without naming them (e.g. שער רוח). */
  completedCategoryCounts?: Readonly<Record<string, number>>
}) {
  // The progress badge lives in the shell's top bar when the page provides the slot; inline otherwise.
  const [progressSlot, setProgressSlot] = useState<HTMLElement | null>(null)
  useEffect(() => { setProgressSlot(document.getElementById('shell-progress-slot')) }, [])
  const shown = previewBoard ?? current
  const onBoard = new Set(shown.semesters.flatMap((semester) => semester.courses.map((course) => course.courseId)))
  const completedHours = Object.entries(completedCredit ?? {})
    .reduce((sum, [id, hours]) => sum + (onBoard.has(id) ? 0 : hours), 0)
  const requirements = adaptRequirementsFromModel(shown)
  // Per category: the courses the server counted on the board, plus completed courses the catalog files
  // under that category, plus unnamed completed ones. Only display sums; the rules stay server-side.
  const hoursOf = (id: string) => {
    const half = shown.courseCatalog[id]?.halfHours
    return completedCredit?.[id] ?? (half == null ? 0 : fromHalfHours(half))
  }
  const completedIds = Object.keys(completedCredit ?? {})
  const categoryProgress: Record<string, CategoryProgress> = Object.fromEntries((requirements?.categories ?? []).map((c) => {
    const ids = new Set([
      ...c.selectedCourseIds,
      ...completedIds.filter((id) => shown.courseCatalog[id]?.programCategoryId === c.id),
    ])
    const hours = [...ids].reduce((sum, id) => sum + hoursOf(id), 0)
    return [c.id, { hours: Math.round(hours * 10) / 10, count: ids.size + (completedCategoryCounts[c.id] ?? 0) }]
  }))
  const badge = <ProgressBadge requirements={requirements} completedHours={completedHours} categoryProgress={categoryProgress} />
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
