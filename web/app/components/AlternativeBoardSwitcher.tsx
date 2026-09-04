'use client'

import type { GeneratedPlanModel } from '../../../shared/planner/model'

type Alternative = NonNullable<GeneratedPlanModel['alternatives']>[number]

const SEMESTER_LABEL_HE: Record<string, string> = {
  year_1_semester_a: 'שנה א׳ — סמסטר א׳',
  year_1_semester_b: 'שנה א׳ — סמסטר ב׳',
  year_2_semester_a: 'שנה ב׳ — סמסטר א׳',
  year_2_semester_b: 'שנה ב׳ — סמסטר ב׳',
  year_3_semester_a: 'שנה ג׳ — סמסטר א׳',
  year_3_semester_b: 'שנה ג׳ — סמסטר ב׳',
  year_4_semester_a: 'שנה ד׳ — סמסטר א׳',
  year_4_semester_b: 'שנה ד׳ — סמסטר ב׳',
}

export default function AlternativeBoardSwitcher({
  alternatives,
  selectedId,
  onSelect,
  disabled = false,
  courseNameById = {},
}: {
  alternatives: Alternative[]
  selectedId: string
  onSelect: (candidateId: string) => void
  disabled?: boolean
  courseNameById?: Readonly<Record<string, string | null | undefined>>
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
              <span className="mt-2 flex flex-col gap-0.5 border-t border-[var(--border)] pt-2 text-xs font-normal text-[var(--text-muted)]">
                {alternative.semesters.filter((semester) => semester.courseIds.length > 0).map((semester) => (
                  <span key={semester.semesterId}>
                    <span className="font-semibold">{SEMESTER_LABEL_HE[semester.semesterId] ?? semester.semesterId}:</span>{' '}
                    {semester.courseIds.map((courseId) => courseNameById[courseId] ?? courseId).join(', ')}
                  </span>
                ))}
              </span>
            </button>
          )
        })}
      </div>
      {disabled && <p className="mt-2 text-xs text-[var(--text-muted)]">החלופות התיישנו בעקבות שינוי ידני או שינוי בהעדפות. יש לבנות מחדש.</p>}
    </section>
  )
}
