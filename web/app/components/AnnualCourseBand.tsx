import type { CourseVM } from '../../lib/board'
import CourseCard from './CourseCard'

/**
 * A year-long course, spanning both semester columns of its year. Reuses the
 * exact same CourseCard every other course renders with — same size, badges,
 * hover, and category accent — just wrapped to span two grid columns. It is
 * never draggable (CourseCard itself refuses to move/split an annual course),
 * matching a regular course card's own behavior for a locked course.
 */
export default function AnnualCourseBand({ course, onRemove, onSelect }: {
  course: CourseVM
  onRemove?: (courseId: string) => void
  onSelect?: (course: CourseVM) => void
}) {
  return (
    <div style={{ gridColumn: '1 / span 2' }} className="min-w-0 px-3 pt-3">
      <CourseCard course={course} onRemove={onRemove} onSelect={onSelect} />
    </div>
  )
}
