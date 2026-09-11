import type { CourseVM } from '../../lib/board'
import { Badge, Card } from './ui'

/** A year-long course rendered once, spanning both semester columns of its year. Never draggable — moving or splitting it would break the atomic placement. */
export default function AnnualCourseBand({ course, startIndex }: { course: CourseVM; startIndex: number }) {
  return (
    <div
      style={{ gridColumn: `${startIndex + 1} / span 2`, gridRow: 1 }}
      className="min-w-0"
    >
      <Card className="flex items-center justify-between gap-3 border-e-4 border-[var(--purple)] px-3.5 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold leading-snug">{course.name}</h3>
          <span dir="ltr" className="text-[11px] font-mono tracking-tight text-[var(--text-muted)]">{course.id}</span>
        </div>
        <Badge variant="purple">שנתי (א׳+ב׳)</Badge>
      </Card>
    </div>
  )
}
