'use client'

import type { SemesterVM } from '../../lib/board'
import { useState } from 'react'
import CourseCard from './CourseCard'
import { Badge, EmptyState } from './ui'
import { readPlannerDrag } from '../../lib/planner/drag-payload'

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
  const [dragActive, setDragActive] = useState(false)
  const acceptsPayload = (payload: ReturnType<typeof readPlannerDrag>): payload is NonNullable<ReturnType<typeof readPlannerDrag>> => {
    if (!payload) return false
    if (payload.kind === 'repository' && !onAddCourse) return false
    if (payload.kind === 'board' && !onMoveCourse) return false
    return payload.allowedSemesterIds === undefined || payload.allowedSemesterIds.includes(semester.id)
  }

  return (
    <section
      aria-label={semester.title}
      onDragOver={(event) => {
        if (mutationPending) { setDragActive(false); return }
        const payload = readPlannerDrag(event.dataTransfer)
        if (!acceptsPayload(payload)) { setDragActive(false); return }
        event.preventDefault()
        event.dataTransfer.dropEffect = payload.kind === 'repository' ? 'copy' : 'move'
        setDragActive(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false)
      }}
      onDrop={(event) => {
        setDragActive(false)
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
      className={`rise flex min-h-[28rem] min-w-0 flex-col gap-2.5 border-l border-[var(--border)] p-3 last:border-l-0 ${index > 0 ? `rise-${Math.min(index, 3)}` : ''} ${dragActive ? 'planner-drop-target-active' : ''}`}
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
