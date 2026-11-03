import type { SemesterVM } from '../../../lib/board'
import { Badge } from '../../../components/ui'
import { useLocale } from '../../locale/LocaleProvider'
import { semesterLabel } from '../../locale/semester-label'

/** The title/count/hours/warnings row for one semester — rendered once per
 *  year-pair above both that pair's SemesterColumn bodies, so an annual
 *  course's spanning card can sit between the headers and the rest of each
 *  semester's own course list. */
export default function SemesterColumnHeader({ semester, onRemove }: {
  semester: SemesterVM
  /** Set only for an empty semester the student added; the server re-checks both. */
  onRemove?: () => void
}) {
  const { t, locale } = useLocale()
  const label = semesterLabel(semester.id, semester.title, locale)
  return (
    <header className="flex items-baseline justify-between gap-2 border-b border-[var(--border)] p-3 pb-2">
      <h2 className="text-sm font-bold tracking-tight">{label}</h2>
      <div className="flex shrink-0 items-center gap-1.5">
        {semester.courses.length > 0 && (
          <span className="text-[11px] text-[var(--text-muted)]">
            {semester.courses.length} {t('קורסים', 'courses')}
          </span>
        )}
        {semester.totalWeeklyHours != null && (
          <Badge>{semester.totalWeeklyHours} {t('ש״ש', 'weekly hours')}</Badge>
        )}
        {semester.warnings.length > 0 && (
          <span title={semester.warnings.join(' · ')} className="cursor-help">
            <Badge variant="warn">{semester.warnings.length} {t('אזהרות', 'warnings')}</Badge>
          </span>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={t(`הסרת ${label}`, `Remove ${label}`)}
            className="rounded px-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-panel)] hover:text-[var(--text)]"
          >
            ×
          </button>
        )}
      </div>
    </header>
  )
}
