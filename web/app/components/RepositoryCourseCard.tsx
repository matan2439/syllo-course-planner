import type { RepoCourseVM } from '../../lib/repository'
import { Badge, Card } from './ui'

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: 'קל',
  medium: 'בינוני',
  hard: 'קשה',
  very_hard: 'קשה מאוד',
}

const SEMESTER_LABELS: Record<string, string> = {
  A: 'סמ׳ א׳',
  B: 'סמ׳ ב׳',
}

export default function RepositoryCourseCard({
  course,
  onSelect,
}: {
  course: RepoCourseVM
  /** Opens the read-only details panel. The syllabus link stays independent so
   *  there are no nested interactive elements. */
  onSelect?: () => void
}) {
  return (
    <Card className="px-3.5 py-3 transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-y-px hover:border-purple-500/30 hover:shadow-[var(--shadow-premium)]">
      <button
        type="button"
        onClick={onSelect}
        className="block w-full text-right focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]"
      >
        <h3 className="text-sm font-semibold leading-snug">{course.name}</h3>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {course.weeklyHours != null && <Badge>{course.weeklyHours} ש״ש</Badge>}
        {course.offered.map((s) => (
          <Badge key={s} variant="purple">
            {SEMESTER_LABELS[s] ?? s}
          </Badge>
        ))}
          {course.difficulty && (
            <Badge variant="warn">
              {DIFFICULTY_LABELS[course.difficulty] ?? course.difficulty}
            </Badge>
          )}
        </div>
      </button>

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
