import { Badge, Card } from '../../../components/ui'
import type { DraftCourseVM } from '../../../lib/planner/draft-vm'
import { MARKER_LABEL } from '../constants'

export default function DraftCourse({ course }: { course: DraftCourseVM }) {
  const markerLabel = MARKER_LABEL[course.marker]
  return (
    <Card className="px-3.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold leading-snug">
          {course.nameHe ? course.nameHe : <span className="text-[var(--text-muted)]">פרטי הקורס אינם זמינים</span>}
        </h4>
        {markerLabel && <Badge variant="purple">{markerLabel}</Badge>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {course.isMandatory != null && (
          <Badge variant={course.isMandatory ? 'purple' : 'neutral'}>{course.isMandatory ? 'חובה' : 'בחירה'}</Badge>
        )}
        {course.weeklyHours != null && <Badge>{course.weeklyHours} ש״ש</Badge>}
      </div>
      <div className="mt-2 text-[11px] text-[var(--text-muted)]">
        <span dir="ltr" className="font-mono tracking-tight">{course.id}</span>
      </div>
    </Card>
  )
}
