'use client'

import { useState } from 'react'
import type { GeneratedPlanModel } from '../../../../shared/planner/model'

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
const LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ז׳', 'ח׳', 'ט׳', 'י׳', 'י״א', 'י״ב']

/** The button's whole label: "חלופה א׳ · <short title>". The courses live in the details below. */
export const alternativeName = (alternative: Alternative, index: number) =>
  `חלופה ${LETTERS[index] ?? index + 1}${alternative.labelHe ? ` · ${alternative.labelHe}` : ''}`

/** Compact workload badge text for one alternative. */
function workloadBadge(alt: Alternative) {
  return `${alt.workload.peakHours} ש״ש שיא · ${alt.workload.activePeriods} סמסטרים`
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
  const [detailsOpen, setDetailsOpen] = useState(false)
  if (alternatives.length < 2) return null
  const shownIndex = Math.max(0, alternatives.findIndex((alternative) => alternative.candidateId === selectedId))
  const shown = alternatives[shownIndex]
  const shownDifferences = shown.differencesHe ?? []
  return (
    <section data-testid="alternative-board-switcher" aria-label="חלופות על לוח הסמסטרים" className="mb-3 rounded-xl border border-[var(--purple)]/35 bg-[var(--purple)]/5 p-3" dir="rtl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold">בחרו חלופה להצגה על הלוח</h3>
        <span className="text-xs text-[var(--text-muted)]">התצוגה מקדימה בלבד — הלוח לא השתנה</span>
      </div>

      {/* Alternative selector — one card per option */}
      <div role="radiogroup" aria-label="בחירת חלופה על לוח הסמסטרים" className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {alternatives.map((alternative, index) => {
          const selected = alternative.candidateId === selectedId
          const name = alternativeName(alternative, index)
          const diffs = alternative.differencesHe ?? []
          return (
            <button
              key={alternative.candidateId}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onSelect(alternative.candidateId)}
              className={`flex min-w-0 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-start text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)] disabled:cursor-not-allowed disabled:opacity-50 sm:max-w-[16rem] ${
                selected
                  ? 'border-[var(--purple-strong)] bg-[var(--surface)] ring-1 ring-[var(--purple-strong)]'
                  : 'border-[var(--border)] hover:border-[var(--purple)]/50 hover:bg-[var(--surface)]/60'
              }`}
            >
              <span className="font-semibold text-[var(--text)]">
                {selected ? '✓ ' : ''}{name}
              </span>
              <span className="text-[.7rem] text-[var(--text-muted)]">{workloadBadge(alternative)}</span>
              {/* Show first difference inline as a quick preview */}
              {diffs.length > 0 && (
                <span className="mt-0.5 line-clamp-2 text-[.7rem] text-[var(--text-muted)]">
                  {diffs[0]}
                  {diffs.length > 1 ? ` +${diffs.length - 1} עוד` : ''}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Detail panel for the selected alternative */}
      <details className="mt-2 text-xs" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer select-none text-[var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]">
          הקורסים ב{alternativeName(shown, shownIndex)} · עומס שיא {shown.workload.peakHours} ש״ש · {shown.workload.activePeriods} סמסטרים פעילים
        </summary>

        {/* Academic differences — the most important section for comparison */}
        {shownDifferences.length > 0 && (
          <div className="mt-2 rounded-md border border-[var(--purple)]/20 bg-[var(--surface)] px-2.5 py-2" role="note" aria-label="הבדלים מול ההצעה">
            <p className="mb-1 font-semibold text-[var(--text)]">הבדלים מהצעת העוזר:</p>
            <ul className="flex flex-col gap-0.5 text-[var(--text-muted)]">
              {shownDifferences.map((line, i) => (
                <li key={i}>• {line}</li>
              ))}
            </ul>
          </div>
        )}

        <div
          data-testid={`alternative-preview-${shown.candidateId}`}
          aria-label={`תצוגת לוח: ${alternativeName(shown, shownIndex)}`}
          className="mt-2 grid grid-cols-1 gap-1.5 text-[var(--text-muted)] sm:grid-cols-2"
        >
          {shown.semesters.filter((semester) => semester.courseIds.length > 0).map((semester) => (
            <div key={semester.semesterId} className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5">
              <span className="block text-[.68rem] font-semibold leading-tight">{SEMESTER_LABEL_HE[semester.semesterId] ?? semester.semesterId}</span>
              <ul className="mt-1 flex flex-col gap-0.5 leading-tight">
                {semester.courseIds.map((courseId) => <li key={courseId} className="break-words">{courseNameById[courseId] ?? courseId}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </details>
      {disabled && <p className="mt-2 text-xs text-[var(--text-muted)]">החלופות התיישנו בעקבות שינוי ידני או שינוי בהעדפות. יש לבנות מחדש.</p>}
    </section>
  )
}
