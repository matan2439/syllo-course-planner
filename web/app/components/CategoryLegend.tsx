const CATEGORIES: Array<{ id: string; label: string; accentVar: string }> = [
  { id: 'mandatory', label: 'חובה', accentVar: '--purple' },
  { id: 'fluids', label: 'זורמים', accentVar: '--cat-fluids-accent' },
  { id: 'solids', label: 'מוצקים', accentVar: '--cat-solids-accent' },
  { id: 'systems', label: 'מערכות', accentVar: '--cat-systems-accent' },
  { id: 'advanced_labs', label: 'מעבדה', accentVar: '--cat-labs-accent' },
  { id: 'other_specialization', label: 'בחירה כללית', accentVar: '--cat-other-accent' },
  { id: 'shaar_ruach', label: 'שער רוח', accentVar: '--cat-gateway-accent' },
]

/** Small, collapsible color key so the CourseCard category accents are decodable at a glance. */
export default function CategoryLegend() {
  return (
    <details className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium text-[var(--text-muted)]">מקרא צבעים</summary>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
        {CATEGORIES.map((c) => (
          <span key={c.id} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block size-2.5 rounded-full"
              style={{ background: `var(${c.accentVar})` }}
            />
            {c.label}
          </span>
        ))}
      </div>
    </details>
  )
}
