import { Badge, EmptyState } from '../../../components/ui'
import type { DraftSemesterVM } from '../../../lib/planner/draft-vm'
import DraftCourse from './DraftCourse'

export default function DraftSemester({ semester }: { semester: DraftSemesterVM }) {
  return (
    <section aria-label={semester.title} className="flex min-w-0 flex-col gap-2.5">
      <header className="flex items-baseline justify-between gap-2 border-b border-[var(--border)] pb-2">
        <h3 className="text-sm font-bold tracking-tight">{semester.title}</h3>
        {semester.totalComplete
          ? <Badge>{semester.totalWeeklyHours} ש״ש</Badge>
          : <Badge variant="warn">סכום חלקי</Badge>}
      </header>
      {semester.courses.length === 0
        ? <EmptyState>אין קורסים בטיוטה</EmptyState>
        : semester.courses.map((c) => <DraftCourse key={c.id} course={c} />)}
    </section>
  )
}
