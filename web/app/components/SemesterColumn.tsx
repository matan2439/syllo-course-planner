import type { SemesterVM } from '../../lib/board'
import CourseCard from './CourseCard'
import { Badge, EmptyState } from './ui'

export default function SemesterColumn({
  semester,
  index,
}: {
  semester: SemesterVM
  index: number
}) {
  return (
    <section
      aria-label={semester.title}
      className={`rise flex min-w-0 flex-col gap-2.5 ${index > 0 ? `rise-${Math.min(index, 3)}` : ''}`}
    >
      <header className="flex items-baseline justify-between gap-2 border-b border-[var(--border)] pb-2">
        <h2 className="text-sm font-bold tracking-tight">{semester.title}</h2>
        <div className="flex shrink-0 items-center gap-1.5">
          {semester.totalWeeklyHours != null && (
            <Badge>{semester.totalWeeklyHours} ש״ש</Badge>
          )}
          {semester.warnings.length > 0 && (
            <Badge variant="warn">{semester.warnings.length} אזהרות</Badge>
          )}
        </div>
      </header>

      {semester.courses.length === 0 ? (
        <EmptyState>אין קורסים משובצים</EmptyState>
      ) : (
        semester.courses.map((c) => <CourseCard key={c.id} course={c} />)
      )}
    </section>
  )
}
