'use client'

import type { SemesterVM } from '../../lib/board'
import { useState, type DragEvent } from 'react'
import CourseCard from './CourseCard'
import { Badge, EmptyState } from './ui'
import { hasPlannerDragType, REPOSITORY_COURSE_MIME, readPlannerDrag } from '../../lib/planner/drag-payload'

export default function SemesterColumn({
  semester,
  index,
  onRemoveCourse,
  onAddCourse,
  onMoveCourse,
  moveDestinations,
  mutationPending,
}: {
  semester: SemesterVM
  index: number
  onRemoveCourse?: (courseId: string) => void
  onAddCourse?: (courseId: string, semesterId: string) => void
  onMoveCourse?: (courseId: string, semesterId: string) => void
  moveDestinations?: Array<{ semesterId: string; label: string }>
  mutationPending?: boolean
}) {
  const [dragState, setDragState] = useState<'allowed' | 'invalid' | 'unknown' | null>(null)
  const acceptsPayload = (payload: ReturnType<typeof readPlannerDrag>): payload is NonNullable<ReturnType<typeof readPlannerDrag>> => {
    if (!payload) return false
    if (payload.kind === 'repository' && !onAddCourse) return false
    if (payload.kind === 'board' && !onMoveCourse) return false
    return payload.allowedSemesterIds === undefined || payload.allowedSemesterIds.includes(semester.id)
  }

  const updateDragState = (event: DragEvent<HTMLElement>) => {
    if (mutationPending) { setDragState(null); return false }
    const payload = readPlannerDrag(event.dataTransfer)
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

  return (
    <section
      aria-label={semester.title}
      onDragEnter={updateDragState}
      onDragOver={updateDragState}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragState(null)
      }}
      onDrop={(event) => {
        setDragState(null)
        if (mutationPending) return
        const payload = readPlannerDrag(event.dataTransfer)
        if (!acceptsPayload(payload)) return
        if (payload.kind === 'repository' && onAddCourse) {
          event.preventDefault()
          onAddCourse(payload.courseId, semester.id)
        } else if (payload.kind === 'board' && onMoveCourse) {
          event.preventDefault()
          onMoveCourse(payload.courseId, semester.id)
        }
      }}
      className={`rise flex min-h-[28rem] min-w-0 flex-col gap-2.5 border-l border-[var(--border)] p-3 last:border-l-0 ${index > 0 ? `rise-${Math.min(index, 3)}` : ''} ${dragState === 'allowed' ? 'planner-drop-target-active' : ''} ${dragState === 'invalid' ? 'planner-drop-target-invalid' : ''} ${dragState === 'unknown' ? 'planner-drop-target-pending' : ''}`}
    >
      <header className="flex items-baseline justify-between gap-2 border-b border-[var(--border)] pb-2">
        <h2 className="text-sm font-bold tracking-tight">{semester.title}</h2>
        <div className="flex shrink-0 items-center gap-1.5">
          {semester.courses.length > 0 && (
            <span className="text-[11px] text-[var(--text-muted)]">
              {semester.courses.length} קורסים
            </span>
          )}
          {semester.totalWeeklyHours != null && (
            <Badge>{semester.totalWeeklyHours} ש״ש</Badge>
          )}
          {semester.warnings.length > 0 && (
            <span title={semester.warnings.join(' · ')} className="cursor-help">
              <Badge variant="warn">{semester.warnings.length} אזהרות</Badge>
            </span>
          )}
        </div>
      </header>

      {dragState && (
        <p role="status" aria-live="polite" className={`planner-drop-feedback planner-drop-feedback-${dragState}`}>
          {dragState === 'allowed' && 'ניתן לשחרר כאן'}
          {dragState === 'invalid' && 'לא ניתן לשחרר כאן'}
          {dragState === 'unknown' && 'בודקים אם ניתן לשחרר כאן…'}
        </p>
      )}

      {semester.courses.length === 0 ? (
        <EmptyState>אין קורסים משובצים</EmptyState>
      ) : (
        semester.courses.map((c) => <CourseCard
          key={c.id} course={c} onRemove={onRemoveCourse} onMove={onMoveCourse}
          moveDestinations={moveDestinations} mutationPending={mutationPending}
        />)
      )}
    </section>
  )
}
