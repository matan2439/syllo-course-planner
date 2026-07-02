import type { CourseVM } from '../../lib/board'
import { Badge, Card } from './ui'

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

export default function CourseCard({ course }: { course: CourseVM }) {
  return (
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
    </Card>
  )
}
