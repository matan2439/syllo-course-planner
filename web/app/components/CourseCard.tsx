import type { CourseVM } from '../../lib/board'
import { useState } from 'react'
import { Badge, Card } from './ui'
import { writeBoardDrag, type PlannerDragPayload } from '../../lib/planner/drag-payload'

const TYPE_LABELS: Record<string, string> = {
  mandatory: 'חובה',
  elective: 'בחירה',
}

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: 'קל',
  medium: 'בינוני',
  hard: 'קשה',
  very_hard: 'קשה מאוד',
}

export default function CourseCard({ course, onRemove, onMove, moveDestinations, mutationPending = false, onDragStateChange }: {
  course: CourseVM
  onRemove?: (courseId: string) => void
  onMove?: (courseId: string, semesterId: string) => void
  moveDestinations?: Array<{ semesterId: string; label: string }>
  mutationPending?: boolean
  onDragStateChange?: (drag: PlannerDragPayload | null) => void
}) {
  const [dragging, setDragging] = useState(false)
  const availableMoveDestinations = course.offeredSemesters === undefined
    ? moveDestinations
    : moveDestinations?.filter((destination) => course.offeredSemesters?.includes(destination.semesterId))
  const movable = course.type !== 'mandatory' && Boolean(onMove) &&
    Boolean(availableMoveDestinations?.length) && !mutationPending

  return (
    <div
      draggable={movable}
      className={movable ? 'planner-drag-source' : undefined}
      data-dragging={dragging ? 'true' : undefined}
      onDragStart={(event) => {
        if (!movable) return
        if ((event.target as HTMLElement | null)?.closest('button,summary,a,input,textarea,select')) {
          event.preventDefault()
          return
        }
        setDragging(true)
        event.dataTransfer.effectAllowed = 'move'
        writeBoardDrag(event.dataTransfer, course.id, course.offeredSemesters)
        onDragStateChange?.({ kind: 'board', courseId: course.id, allowedSemesterIds: course.offeredSemesters })
      }}
      onDragEnd={() => {
        setDragging(false)
        onDragStateChange?.(null)
      }}
    >
    <Card className="group px-3.5 py-3 transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-y-px hover:border-purple-500/30 hover:shadow-[var(--shadow-premium)]">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-snug">{course.name}</h3>
        {course.hasWarnings && (
          <span
            aria-label="קיימת אזהרה לקורס זה"
            title="קיימת אזהרה לקורס זה"
            className="mt-0.5 size-2 shrink-0 rounded-full bg-amber-400"
          />
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant={course.type === 'mandatory' ? 'purple' : 'neutral'}>
          {TYPE_LABELS[course.type] ?? course.type}
        </Badge>
        {course.weeklyHours != null && (
          <Badge>{course.weeklyHours} ש״ש</Badge>
        )}
        {course.difficulty && (
          <Badge variant="warn">
            {DIFFICULTY_LABELS[course.difficulty] ?? course.difficulty}
          </Badge>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
        <span dir="ltr" className="font-mono tracking-tight">
          {course.id}
        </span>
        {course.syllabusUrl && (
          <a
            href={course.syllabusUrl}
            target="_blank"
            rel="noreferrer"
            className="opacity-70 transition-[opacity,color] duration-150 hover:text-[var(--purple)] hover:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]"
          >
            סילבוס ↗
          </a>
        )}
      </div>
      {onRemove && course.type !== 'mandatory' && (
        <button
          type="button"
          disabled={mutationPending}
          aria-label={`הסר ${course.name} מהלוח`}
          onClick={() => onRemove(course.id)}
          className="mt-2 rounded-full border border-[var(--border)] px-3 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)] disabled:opacity-50"
        >
          הסר מהלוח
        </button>
      )}
      {course.type !== 'mandatory' && onMove && availableMoveDestinations && availableMoveDestinations.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]">
            אפשרויות העברה עבור {course.name}
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {availableMoveDestinations.map((destination) => (
              <button
                key={destination.semesterId}
                type="button"
                disabled={mutationPending}
                aria-label={`העבר ${course.name} אל ${destination.label}`}
                onClick={() => onMove(course.id, destination.semesterId)}
                className="rounded-full border border-[var(--border)] px-2.5 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)] disabled:opacity-50"
              >
                {destination.label}
              </button>
            ))}
          </div>
        </details>
      )}
    </Card>
    </div>
  )
}
