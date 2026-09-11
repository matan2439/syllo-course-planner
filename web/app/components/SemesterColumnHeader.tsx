import type { SemesterVM } from '../../lib/board'
import { Badge } from './ui'

/** The title/count/hours/warnings row for one semester — rendered once per
 *  year-pair above both that pair's SemesterColumn bodies, so an annual
 *  course's spanning card can sit between the headers and the rest of each
 *  semester's own course list. */
export default function SemesterColumnHeader({ semester }: { semester: SemesterVM }) {
  return (
    <header className="flex items-baseline justify-between gap-2 border-b border-[var(--border)] p-3 pb-2">
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
  )
}
