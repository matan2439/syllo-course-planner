import { categoryAccentColor } from '../../courses/components/course-category'

export type LegendCategory = { id: string; title: string }

/** Small, collapsible color key so the CourseCard category accents are decodable at a glance. */
export default function CategoryLegend({ categories }: { categories: readonly LegendCategory[] }) {
  return (
    <details className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium text-[var(--text-muted)]">מקרא צבעים</summary>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
        {[{ id: 'mandatory', title: 'חובה' }, ...categories.filter(c => c.id !== 'mandatory')].map((c) => (
          <span key={c.id} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block size-2.5 rounded-full"
              style={{ background: categoryAccentColor(c.id) }}
            />
            {c.title}
          </span>
        ))}
      </div>
    </details>
  )
}
