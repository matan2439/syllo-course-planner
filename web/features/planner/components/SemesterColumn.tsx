'use client'

import type { CourseVM, SemesterVM } from '../../../lib/board'
import { useEffect, useState, type DragEvent } from 'react'
import CourseCard from './CourseCard'
import { EmptyState } from '../../../components/ui'
import { hasPlannerDragType, REPOSITORY_COURSE_MIME, readPlannerDrag, type PlannerDragPayload } from '../../../lib/planner/drag-payload'

export default function SemesterColumn({
  semester,
  index,
  onRemoveCourse,
  onAddCourse,
  onMoveCourse,
  onSelectCourse,
  moveDestinations,
  mutationPending,
  activeDrag,
  rejected = false,
  rejectedKey,
  justPlaced = false,
  justPlacedKey,
  onDragStateChange,
}: {
  semester: SemesterVM
  index: number
  onRemoveCourse?: (courseId: string) => void
  onAddCourse?: (courseId: string, semesterId: string) => void
  onMoveCourse?: (courseId: string, semesterId: string) => void
  /** Opens the read-only details panel (with the per-course AI chat) for a board course. */
  onSelectCourse?: (course: CourseVM) => void
  moveDestinations?: Array<{ semesterId: string; label: string }>
  mutationPending?: boolean
  activeDrag?: PlannerDragPayload | null
  rejected?: boolean
  rejectedKey?: string | number | null
  /** True immediately after a manual add/move successfully lands in this semester. */
  justPlaced?: boolean
  /** Changes on every successful placement so the confirmation animation restarts. */
  justPlacedKey?: string | number | null
  onDragStateChange?: (drag: PlannerDragPayload | null) => void
}) {
  const [dragState, setDragState] = useState<'allowed' | 'invalid' | 'unknown' | null>(null)
  const acceptsPayload = (payload: ReturnType<typeof readPlannerDrag>): payload is NonNullable<ReturnType<typeof readPlannerDrag>> => {
    if (!payload) return false
    if (payload.kind === 'repository' && !onAddCourse) return false
    if (payload.kind === 'board' && !onMoveCourse) return false
    // An absent offering list is an unknown academic fact. A drop target must
    // never turn that absence into permission for every semester.
    return payload.allowedSemesterIds !== undefined && payload.allowedSemesterIds.includes(semester.id)
  }

  useEffect(() => {
    // A source can end a drag outside this column, so no dragleave/drop event
    // is guaranteed to reach the hovered target. The shared intent is the
    // lifecycle boundary that must clear any local visual feedback.
    if (!activeDrag) setDragState(null)
  }, [activeDrag])

  const updateDragState = (event: DragEvent<HTMLElement>) => {
    if (mutationPending) { setDragState(null); return false }
    const payload = readPlannerDrag(event.dataTransfer) ?? activeDrag ?? null
    if (!payload && hasPlannerDragType(event.dataTransfer)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = event.dataTransfer.types.includes(REPOSITORY_COURSE_MIME) ? 'copy' : 'move'
      setDragState('unknown')
      return true
    }
    if (!acceptsPayload(payload)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'none'
      setDragState('invalid')
      return true
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = payload.kind === 'repository' ? 'copy' : 'move'
    setDragState('allowed')
    return true
  }

  // The browser may not dispatch dragover until the pointer enters a target.
  // The shared intent is authoritative enough to preview every target as soon
  // as a drag starts, so the user can see legal and illegal destinations at a
  // glance instead of discovering them one column at a time.
  const previewDragState = mutationPending || !activeDrag
    ? null
    : acceptsPayload(activeDrag) ? 'allowed' : 'invalid'
  const visibleDragState = previewDragState ?? dragState
  const feedbackState = rejected ? 'invalid' : visibleDragState
  const feedbackKey = rejected ? `rejected-${rejectedKey ?? 'latest'}` : feedbackState

  // Annual courses render once, spanning both semester columns of their year
  // (rendered by NativePlannerBoard, between the shared header row and the
  // per-semester course lists) — never as a second, independent card here.
  const bodyCourses = semester.courses.filter((c) => !c.isAnnual)

  return (
    <section
      aria-label={semester.title}
      data-drop-state={rejected ? 'rejected' : visibleDragState ?? undefined}
      data-just-placed={justPlaced ? 'true' : undefined}
      onDragEnter={updateDragState}
      onDragOver={updateDragState}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragState(null)
      }}
      onDrop={(event) => {
        setDragState(null)
        onDragStateChange?.(null)
        if (mutationPending) return
        const payload = readPlannerDrag(event.dataTransfer) ?? activeDrag ?? null
        if (!acceptsPayload(payload)) return
        if (payload.kind === 'repository' && onAddCourse) {
          event.preventDefault()
          onAddCourse(payload.courseId, semester.id)
        } else if (payload.kind === 'board' && onMoveCourse) {
          event.preventDefault()
          onMoveCourse(payload.courseId, semester.id)
        }
      }}
      className={`rise relative flex min-h-[28rem] min-w-0 flex-col gap-2.5 p-3 ${index > 0 ? `rise-${Math.min(index, 3)}` : ''} ${visibleDragState === 'allowed' ? 'planner-drop-target-active' : ''} ${visibleDragState === 'invalid' ? 'planner-drop-target-invalid' : ''} ${visibleDragState === 'unknown' ? 'planner-drop-target-pending' : ''} ${rejected ? 'planner-drop-target-rejected' : ''}`}
    >
      {/* Keyed on justPlacedKey (not the whole column) so the pulse replays on
          each new placement without unmounting SemesterColumn/CourseCard —
          a full-column remount here would also restart the entrance `.rise`
          animation and could interrupt an in-progress drag in this column. */}
      {justPlaced && (
        <div key={justPlacedKey} aria-hidden="true" className="pointer-events-none absolute inset-0 planner-drop-target-placed" />
      )}

      {feedbackState && (
        <p
          key={feedbackKey}
          role="status"
          aria-live={rejected ? 'assertive' : 'polite'}
          data-feedback-state={feedbackState}
          className={`planner-drop-feedback planner-drop-feedback-${feedbackState}`}
        >
          <span aria-hidden="true" className="planner-drop-feedback-icon">
            {feedbackState === 'allowed' && '✓'}
            {feedbackState === 'invalid' && '×'}
            {feedbackState === 'unknown' && '…'}
          </span>
          {' '}
          <span>
            {feedbackState === 'allowed' && 'ניתן לשחרר כאן'}
            {feedbackState === 'invalid' && 'לא ניתן לשחרר כאן'}
            {feedbackState === 'unknown' && 'בודקים אם ניתן לשחרר כאן…'}
          </span>
        </p>
      )}

      {/* semester.courses (not bodyCourses) so an annual-only semester — shown
          via the spanning card above, not here — never falsely reports empty. */}
      {semester.courses.length === 0 ? (
        <EmptyState>אין קורסים משובצים</EmptyState>
      ) : (
        bodyCourses.map((c) => <CourseCard
          key={c.id} course={c} onRemove={onRemoveCourse} onMove={onMoveCourse} onSelect={onSelectCourse}
          moveDestinations={moveDestinations} mutationPending={mutationPending}
          onDragStateChange={onDragStateChange}
        />)
      )}
    </section>
  )
}
