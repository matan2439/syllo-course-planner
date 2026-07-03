import type { RequirementsVM, RequirementCategoryVM } from '../../lib/requirements'
import { Badge, Card } from './ui'

function RequirementStatusBadge({
  satisfied,
  missingCount,
}: {
  satisfied: boolean
  missingCount: number
}) {
  if (satisfied) return <Badge variant="success">הושלם</Badge>
  return <Badge variant="warn">חסר {missingCount}</Badge>
}

function RequirementCategoryCard({ category }: { category: RequirementCategoryVM }) {
  return (
    <Card className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold leading-snug">
          {category.title}
        </h3>
        {category.minCourses > 0 && (
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            {category.selectedCount} מתוך {category.minCourses} נדרשים
          </p>
        )}
      </div>
      <RequirementStatusBadge
        satisfied={category.satisfied}
        missingCount={category.missingCount}
      />
    </Card>
  )
}

/**
 * Read-only progress panel for /plan — renders the pre-computed
 * program_requirements_validation block exactly as shipped. The bar width
 * only scales the shipped planned/required hours for display.
 */
export default function RequirementsProgressPanel({
  requirements,
}: {
  requirements: RequirementsVM
}) {
  const pct = Math.min(
    100,
    Math.max(0, (requirements.plannedHours / requirements.totalRequiredHours) * 100)
  )

  return (
    <section aria-label="דרישות התואר" className="flex flex-col gap-4">
      <Card className="px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold tracking-tight">דרישות התואר</h2>
          <span className="text-xs text-[var(--text-muted)]">
            נותרו {requirements.remainingHours} ש״ש
          </span>
        </div>

        <div className="mt-3">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-medium">
              {requirements.plannedHours} מתוך {requirements.totalRequiredHours} ש״ש
            </span>
            <span className="text-[var(--text-muted)]">
              קורסי ליבה: {requirements.core.selected} מתוך {requirements.core.min}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={requirements.plannedHours}
            aria-valuemin={0}
            aria-valuemax={requirements.totalRequiredHours}
            aria-label="שעות מתוכננות מתוך הנדרש"
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]"
          >
            <div
              className="h-full rounded-full bg-[var(--purple)] transition-[width] duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {requirements.categories.map((c) => (
          <RequirementCategoryCard key={c.id} category={c} />
        ))}
      </div>

      {!requirements.valid && requirements.warnings.length > 0 && (
        <details className="group rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 backdrop-blur-sm">
          <summary className="cursor-pointer list-none text-sm font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]">
            <span className="me-1 inline-block transition-transform duration-150 group-open:rotate-90">
              ‹
            </span>
            חסר להשלמה
          </summary>
          <ul className="mt-2 space-y-1 text-xs leading-relaxed text-[var(--text-muted)]">
            {requirements.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
