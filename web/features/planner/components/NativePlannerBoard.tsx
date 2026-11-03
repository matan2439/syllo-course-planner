import type { ReactNode } from 'react'
import SemesterColumn from './SemesterColumn'
import SemesterColumnHeader from './SemesterColumnHeader'
import AnnualCourseBand from './AnnualCourseBand'
import CategoryLegend from './CategoryLegend'
import { EmptyState } from '../../../components/ui'
import type { BoardVM, CourseVM } from '../../../lib/board'
import type { PlannerDragPayload } from '../../../lib/planner/drag-payload'
import { annualBandsOf } from '../../../lib/planner/annual-bands'
import { useLocale } from '../../locale/LocaleProvider'
import { semesterLabel } from '../../locale/semester-label'

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
export default function NativePlannerBoard({ board, onRemoveCourse, onAddCourse, onMoveCourse, onSelectCourse, mutationPending = false, activeDrag, rejectedSemesterId, rejectedDropKey, justPlacedSemesterId, justPlacedKey, onDragStateChange, readOnly = false, editableCourseIds, onAddSemester, removableSemesterIds, onRemoveSemester, chrome = true, companion }: {
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
  /** During an AI preview, only courses already committed can be moved/removed. */
  editableCourseIds?: ReadonlySet<string>
  /** Adds the next semester after the last column (degrees that run long). */
  onAddSemester?: () => void
  /** Empty semesters the student added; only these offer removal. */
  removableSemesterIds?: ReadonlySet<string>
  onRemoveSemester?: (semesterId: string) => void
  /** false: only the year-pair columns, for embedding in another board's row (a read-only companion). */
  chrome?: boolean
  /** Another window's columns shown in the same scrolling row, before or after this board's own. */
  companion?: { placement: 'before' | 'after'; node: ReactNode }
}) {
  const { t, locale } = useLocale()
  if (board.semesters.length === 0) {
    return <EmptyState>{t('נתוני הלוח לתוכנית זו עדיין לא זמינים כאן', 'Board data for this program is not available yet')}</EmptyState>
  }
  const bandByStartIndex = new Map(annualBandsOf(board).map((band) => [band.startIndex, band]))
  const pairs: Array<{ start: number; semesters: typeof board.semesters }> = []
  for (let i = 0; i < board.semesters.length; i += 2) {
    pairs.push({ start: i, semesters: board.semesters.slice(i, i + 2) })
  }

  const columns = <>
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
                  <SemesterColumnHeader
                    semester={s}
                    onRemove={!readOnly && onRemoveSemester && removableSemesterIds?.has(s.id) && !mutationPending
                      ? () => onRemoveSemester(s.id) : undefined}
                  />
                </div>
              )
            })}
            {band && (
              <AnnualCourseBand
                course={band.course}
                onRemove={readOnly || (editableCourseIds && !editableCourseIds.has(band.course.id)) ? undefined : onRemoveCourse}
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
                  editableCourseIds={editableCourseIds}
                  moveDestinations={board.semesters
                    .filter((destination) => destination.id !== s.id)
                    .map((destination) => ({ semesterId: destination.id, label: semesterLabel(destination.id, destination.title, locale) }))}
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
  </>
  if (!chrome) return columns

  return (
    <div className="flex flex-col gap-2">
    <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
    <div
      role="list"
      aria-label={t('לוח סמסטרים', 'Semester board')}
      className="flex min-w-full items-start"
    >
      {companion?.placement === 'before' && companion.node}
      {columns}
      {!readOnly && onAddSemester && (
        <div className="flex shrink-0 items-start border-s border-[var(--border)] p-2">
          <button
            type="button"
            onClick={onAddSemester}
            disabled={mutationPending}
            aria-label={t('הוספת סמסטר', 'Add semester')}
            title={t('הוספת סמסטר אחרי האחרון — למי שמאריך את התואר', 'Add a semester after the last one — for longer degrees')}
            className="grid h-9 w-9 place-items-center rounded-lg border-2 border-dashed border-[var(--border)] text-lg font-bold text-[var(--text-muted)] hover:border-[var(--purple)] hover:text-[var(--text)] disabled:opacity-50"
          >
            +
          </button>
        </div>
      )}
      {companion?.placement === 'after' && companion.node}
    </div>
    </div>
    <CategoryLegend />
    </div>
  )
}
