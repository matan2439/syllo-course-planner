import type { SemesterVM } from '../../lib/board'
import CourseCard from './CourseCard'
import { Badge, EmptyState } from './ui'

export default function SemesterColumn({
  semester,
  index,
  onRemoveCourse,
  onMoveCourse,
  moveDestinations,
  mutationPending,
}: {
  semester: SemesterVM
  index: number
  onRemoveCourse?: (courseId: string) => void
  onMoveCourse?: (courseId: string, semesterId: string) => void
  moveDestinations?: Array<{ semesterId: string; label: string }>
  mutationPending?: boolean
}) {
  return (
    <section
      aria-label={semester.title}
      onDragOver={(event) => {
        if (!onMoveCourse || mutationPending) return
        const allowedRaw = event.dataTransfer.getData('application/x-syllo-allowed-semester-ids')
        if (allowedRaw) {
          try {
            const allowed = JSON.parse(allowedRaw) as unknown
            if (!Array.isArray(allowed) || !allowed.includes(semester.id)) return
          } catch { return }
        }
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(event) => {
        if (!onMoveCourse || mutationPending) return
        event.preventDefault()
        const allowedRaw = event.dataTransfer.getData('application/x-syllo-allowed-semester-ids')
        if (allowedRaw) {
          try {
            const allowed = JSON.parse(allowedRaw) as unknown
            if (!Array.isArray(allowed) || !allowed.includes(semester.id)) return
          } catch { return }
        }
        const courseId = event.dataTransfer.getData('application/x-syllo-course-id')
        if (courseId) onMoveCourse(courseId, semester.id)
      }}
      className={`rise flex min-w-0 flex-col gap-2.5 ${index > 0 ? `rise-${Math.min(index, 3)}` : ''}`}
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
