'use client'

import type { GeneratedPlanModel } from '../../../shared/planner/model'

type Alternative = NonNullable<GeneratedPlanModel['alternatives']>[number]

export default function AlternativeBoardSwitcher({
  alternatives,
  selectedId,
  onSelect,
  disabled = false,
}: {
  alternatives: Alternative[]
  selectedId: string
  onSelect: (candidateId: string) => void
  disabled?: boolean
}) {
  if (alternatives.length < 2) return null
  return (
    <section data-testid="alternative-board-switcher" aria-label="חלופות על לוח הסמסטרים" className="mb-3 rounded-xl border border-[var(--purple)]/35 bg-[var(--purple)]/5 p-3" dir="rtl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold">בחרו חלופה להצגה על הלוח</h3>
        <span className="text-xs text-[var(--text-muted)]">התצוגה מקדימה בלבד — הלוח לא השתנה</span>
      </div>
      <div role="radiogroup" aria-label="בחירת חלופה על לוח הסמסטרים" className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {alternatives.map((alternative) => {
          const selected = alternative.candidateId === selectedId
          return (
            <button
              key={alternative.candidateId}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onSelect(alternative.candidateId)}
              className={`rounded-lg border px-3 py-2 text-right text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)] disabled:cursor-not-allowed disabled:opacity-50 ${
                selected ? 'border-[var(--purple-strong)] bg-[var(--surface)] font-semibold' : 'border-[var(--border)] hover:border-[var(--purple)]/50'
              }`}
            >
              <span className="block">{selected ? '✓ ' : ''}{alternative.labelHe}</span>
              <span className="mt-1 block text-xs font-normal text-[var(--text-muted)]">עומס שיא {alternative.workload.peakHours} ש״ש · {alternative.workload.activePeriods} סמסטרים פעילים</span>
            </button>
          )
        })}
      </div>
      {disabled && <p className="mt-2 text-xs text-[var(--text-muted)]">החלופות התיישנו בעקבות שינוי ידני או שינוי בהעדפות. יש לבנות מחדש.</p>}
    </section>
  )
}
