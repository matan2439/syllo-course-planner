import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { fromHalfHours, type BoardModel, type GeneratedPlanModel } from '../../../../shared/planner/model'
import { boardModelToVM } from '../../../lib/planner/board-vm'
import type { CourseVM } from '../../../lib/board'
import type { PlannerDragPayload } from '../../../lib/planner/drag-payload'
import { adaptRequirementsFromModel } from '../../../lib/requirements'
import AlternativeBoardSwitcher from './AlternativeBoardSwitcher'
import NativePlannerBoard from './NativePlannerBoard'
import ProgressBadge, { type CategoryProgress } from './ProgressBadge'
import { useLocale } from '../../locale/LocaleProvider'

type Highlight = { semesterId: string; key: number } | null

type DiffMarker = NonNullable<CourseVM['diffMarker']>

function withDiffMarkers(board: ReturnType<typeof boardModelToVM>, markers?: Readonly<Record<string, DiffMarker>>) {
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
 * Changed cards carry a marker while previewing. Existing courses and repository
 * drops still edit the committed board; draft-only courses remain read-only.
 */
export default function CurrentPlanSection({
  current, previewBoard, diffMarkers, alternatives, selectedAlternativeId, onSelectAlternative, stale,
  commitManualRemove, commitManualAdd, commitManualMove, selectBoardCourse, manualEditPhase,
  activeDrag, rejectedDrop, justPlaced, onDragStateChange, completedCredit, completedCategoryCounts = {},
  onAddSemester, removableSemesterIds, onRemoveSemester, companion,
}: {
  current: BoardModel
  /** The proposal (or selected alternative) applied to the current board, or null when none is being previewed. */
  previewBoard: BoardModel | null
  /** `${semesterId}|${courseId}` → how that placement differs from the committed plan (preview only). */
  diffMarkers?: Readonly<Record<string, DiffMarker>>
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
  onAddSemester?: () => void
  removableSemesterIds?: ReadonlySet<string>
  onRemoveSemester?: (semesterId: string) => void
  /** Another window's read-only columns in the same scrolling row ("whole degree" view). */
  companion?: { placement: 'before' | 'after'; node: ReactNode }
}) {
  const { t } = useLocale()
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
  const badge = <span data-highlight-id="progress" className="inline-flex"><ProgressBadge requirements={requirements} completedHours={completedHours} categoryProgress={categoryProgress} /></span>
  return (
    <section aria-label={t('התוכנית הנוכחית', 'Current plan')}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold tracking-tight">{t('התוכנית הנוכחית', 'Current plan')}</h2>
          {progressSlot ? createPortal(badge, progressSlot) : badge}
        </div>
        {previewBoard && <span className="text-xs text-[var(--text-muted)]">{t('תצוגה מקדימה של ההצעה: הקורסים שלכם נשארים במקומם, וההצעה מסומנת עליהם — דבר לא משתנה עד לאישור מפורש', 'Preview: your courses stay where they are and the proposal is marked on top — nothing changes until you approve')}</span>}
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
        onRemoveCourse={commitManualRemove}
        onAddCourse={(courseId, semesterId) => commitManualAdd(semesterId, courseId)}
        onMoveCourse={commitManualMove}
        editableCourseIds={previewBoard ? new Set(current.semesters.flatMap((semester) => semester.courses.map((course) => course.courseId))) : undefined}
        onSelectCourse={selectBoardCourse}
        mutationPending={manualEditPhase === 'saving'}
        activeDrag={activeDrag}
        rejectedSemesterId={rejectedDrop?.semesterId}
        rejectedDropKey={rejectedDrop?.key}
        justPlacedSemesterId={justPlaced?.semesterId}
        justPlacedKey={justPlaced?.key}
        onDragStateChange={onDragStateChange}
        // Columns change only on the committed board, never while previewing a proposal.
        onAddSemester={previewBoard ? undefined : onAddSemester}
        removableSemesterIds={removableSemesterIds}
        onRemoveSemester={previewBoard ? undefined : onRemoveSemester}
        companion={companion}
      />
    </section>

  )
}
