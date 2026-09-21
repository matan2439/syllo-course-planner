import type { CourseVM } from '../../../lib/board'
import { useState } from 'react'
import { Badge, Card } from '../../../components/ui'
import { writeBoardDrag, type PlannerDragPayload } from '../../../lib/planner/drag-payload'
import { categoryAccentClass } from '../../courses/components/course-category'
import { MARKER_LABEL } from '../constants'

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

export default function CourseCard({ course, onRemove, onMove, onSelect, moveDestinations, mutationPending = false, onDragStateChange }: {
  course: CourseVM
  onRemove?: (courseId: string) => void
  onMove?: (courseId: string, semesterId: string) => void
  /** Opens the read-only details panel (with the per-course AI chat) for this course. */
  onSelect?: (course: CourseVM) => void
  moveDestinations?: Array<{ semesterId: string; label: string }>
  mutationPending?: boolean
  onDragStateChange?: (drag: PlannerDragPayload | null) => void
}) {
  const [dragging, setDragging] = useState(false)
  // Missing offering data is an unknown academic fact, not permission to move
  // everywhere. Keep the card keyboard-readable, but fail closed until the
  // authoritative catalog names at least one destination. An annual course
  // spans both halves of its year as one atomic placement — it lists both as
  // "offered" (so each half's card is individually legal), but it must never
  // be independently moved or split, so it never advertises a destination.
  const offeredSemesters = course.offeredSemesters
  const availableMoveDestinations = course.isAnnual || offeredSemesters === undefined
    ? []
    : moveDestinations?.filter((destination) => offeredSemesters.includes(destination.semesterId))
  const movable = Boolean(onMove) &&
    Boolean(availableMoveDestinations?.length) && !mutationPending
  const allowedSemesterIds = availableMoveDestinations?.map(({ semesterId }) => semesterId) ?? []

  const announceDragPreview = () => {
    onDragStateChange?.({ kind: 'board', courseId: course.id, allowedSemesterIds })
  }

  return (
    <div
      draggable={movable}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={onSelect ? `פרטים על ${course.name}` : undefined}
      className={[movable ? 'planner-drag-source' : '', onSelect ? 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)] rounded-xl' : ''].filter(Boolean).join(' ') || undefined}
      data-dragging={dragging ? 'true' : undefined}
      data-category={course.categoryId ?? undefined}
      onClick={(event) => {
        if (!onSelect) return
        if ((event.target as HTMLElement | null)?.closest('button,summary,a,input,textarea,select,[data-drag-handle]')) return
        onSelect(course)
      }}
      onKeyDown={(event) => {
        if (!onSelect) return
        if (event.target !== event.currentTarget) return
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onSelect(course)
      }}
      onDragStart={(event) => {
        if (!movable) return
        if ((event.target as HTMLElement | null)?.closest('button,summary,a,input,textarea,select')) {
          event.preventDefault()
          return
        }
        setDragging(true)
        event.dataTransfer.effectAllowed = 'move'
        writeBoardDrag(event.dataTransfer, course.id, allowedSemesterIds)
        announceDragPreview()
      }}
      onDragEnd={() => {
        setDragging(false)
        onDragStateChange?.(null)
      }}
    >
    <Card className={`group px-3.5 py-3 transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-y-px hover:border-purple-500/30 hover:shadow-[var(--shadow-premium)] ${onSelect ? 'cursor-pointer' : ''} ${categoryAccentClass(course.categoryId)}`}>
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
        {course.diffMarker && (
          <Badge variant="warn">{MARKER_LABEL[course.diffMarker]}</Badge>
        )}
        {course.isAnnual && (
          <Badge variant="purple">שנתי (א׳+ב׳)</Badge>
        )}
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
      {movable && (
        <div className="mt-2 flex items-center border-t border-[var(--border)] pt-2">
          <span
            data-drag-handle
            draggable={movable}
            title="גררו את הקורס לסמסטר אחר"
            aria-label={`גרור את ${course.name} לסמסטר אחר`}
            className="planner-drag-handle text-[11px] text-[var(--text-muted)]"
          >
            ⠿ גרור להעברה
          </span>
        </div>
      )}
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
      {onMove && availableMoveDestinations && availableMoveDestinations.length > 0 && (
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
