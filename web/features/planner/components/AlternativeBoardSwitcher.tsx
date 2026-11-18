'use client'

import { useState } from 'react'
import type { GeneratedPlanModel } from '../../../../shared/planner/model'

type Alternative = NonNullable<GeneratedPlanModel['alternatives']>[number]
type Difference = NonNullable<Alternative['differences']>[number]

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

const DIFF_ICON: Record<string, string> = {
  adds: '➕',
  removes: '➖',
  moves: '↔',
  peak_hours: '📊',
  active_periods: '📅',
  specialization: '🎯',
  prerequisite_warnings: '⚠️',
  unverified_prerequisites: '❔',
  progress: '🎓',
}

const DIFF_COLOR: Record<string, string> = {
  adds: 'text-emerald-600 dark:text-emerald-400',
  removes: 'text-rose-600 dark:text-rose-400',
  moves: 'text-amber-600 dark:text-amber-400',
  peak_hours: 'text-[var(--text-muted)]',
  active_periods: 'text-[var(--text-muted)]',
  specialization: 'text-[var(--purple)]',
  prerequisite_warnings: 'text-amber-600 dark:text-amber-400',
  unverified_prerequisites: 'text-[var(--text-muted)]',
  progress: 'text-emerald-600 dark:text-emerald-400',
}

/** The button's whole label: "חלופה א׳ · <short title>". The courses live in the details below. */
export const alternativeName = (alternative: Alternative, index: number) =>
  `חלופה ${LETTERS[index] ?? index + 1}${alternative.labelHe ? ` · ${alternative.labelHe}` : ''}`

/** Horizontal bar representing this alternative's peak workload relative to the set's max. */
function WorkloadBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
      <div
        className="h-full rounded-full bg-[var(--purple)]/60 transition-[width] duration-300"
        style={{ width: `${pct}%` }}
        aria-hidden
      />
    </div>
  )
}

/** One structured difference row. */
function DiffRow({ diff }: { diff: Difference }) {
  const icon = DIFF_ICON[diff.kind] ?? '•'
  const color = DIFF_COLOR[diff.kind] ?? 'text-[var(--text-muted)]'
  return (
    <li className={`flex items-start gap-1.5 text-[.72rem] leading-snug ${color}`}>
      <span aria-hidden className="shrink-0 text-[.8rem]">{icon}</span>
      <span>{diff.textHe}</span>
    </li>
  )
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

  const shownIndex = Math.max(0, alternatives.findIndex((a) => a.candidateId === selectedId))
  const shown = alternatives[shownIndex]

  // Max peak across the set — used for relative workload bars
  const maxPeak = Math.max(...alternatives.map((a) => a.workload.peakHours), 1)

  return (
    <section
      data-testid="alternative-board-switcher"
      aria-label="חלופות על לוח הסמסטרים"
      className="mb-3 rounded-xl border border-[var(--purple)]/35 bg-[var(--purple)]/5 p-3"
      dir="rtl"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold">בחרו חלופה להצגה על הלוח</h3>
        <span className="text-xs text-[var(--text-muted)]">תצוגה מקדימה בלבד — הלוח לא השתנה</span>
      </div>

      {/* Alternative selector — one card per option */}
      <div
        role="radiogroup"
        aria-label="בחירת חלופה על לוח הסמסטרים"
        className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap"
      >
        {alternatives.map((alt, index) => {
          const selected = alt.candidateId === selectedId
          const name = alternativeName(alt, index)
          const diffs = alt.differences ?? alt.differencesHe.map((t) => ({ kind: 'other' as string, textHe: t }))
          const previewDiffs = diffs.slice(0, 2)
          return (
            <button
              key={alt.candidateId}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onSelect(alt.candidateId)}
              className={`flex min-w-0 flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-start text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)] disabled:cursor-not-allowed disabled:opacity-50 sm:max-w-[18rem] ${
                selected
                  ? 'border-[var(--purple-strong)] bg-[var(--surface)] ring-1 ring-[var(--purple-strong)]'
                  : 'border-[var(--border)] hover:border-[var(--purple)]/50 hover:bg-[var(--surface)]/60'
              }`}
            >
              {/* Header row: name + recommended badge */}
              <div className="flex w-full items-center justify-between gap-2">
                <span className="font-semibold text-[var(--text)]">
                  {selected ? '✓ ' : ''}{name}
                </span>
                {alt.recommended && (
                  <span className="shrink-0 rounded-full bg-[var(--purple)]/15 px-1.5 py-0.5 text-[.65rem] font-medium text-[var(--purple)]">
                    מומלץ
                  </span>
                )}
              </div>

              {/* Workload row: numeric + bar */}
              <div className="w-full">
                <span className="text-[.7rem] text-[var(--text-muted)]">
                  {alt.workload.peakHours} ש״ש שיא · {alt.workload.activePeriods} סמסטרים פעילים
                </span>
                <WorkloadBar value={alt.workload.peakHours} max={maxPeak} />
              </div>

              {/* Quick difference preview — up to 2 lines with icons */}
              {previewDiffs.length > 0 && (
                <ul className="mt-0.5 w-full space-y-0.5" aria-label="הבדלים עיקריים">
                  {previewDiffs.map((d, i) => (
                    <DiffRow key={i} diff={d as Difference} />
                  ))}
                  {diffs.length > 2 && (
                    <li className="text-[.7rem] text-[var(--text-muted)]">+{diffs.length - 2} עוד…</li>
                  )}
                </ul>
              )}
            </button>
          )
        })}
      </div>

      {/* Comparison strip: all alternatives side-by-side */}
      {alternatives.length > 1 && (
        <div className="mt-3 flex gap-3 overflow-x-auto text-[.7rem] text-[var(--text-muted)]" aria-hidden>
          {alternatives.map((alt, index) => (
            <div key={alt.candidateId} className="flex shrink-0 flex-col items-center gap-0.5">
              <span className="font-medium">{LETTERS[index] ?? index + 1}</span>
              <span>{alt.workload.peakHours} ש״ש</span>
            </div>
          ))}
        </div>
      )}

      {/* Detail panel for the selected alternative */}
      <details
        className="mt-2 text-xs"
        open={detailsOpen}
        onToggle={(e) => setDetailsOpen(e.currentTarget.open)}
      >
        <summary className="cursor-pointer select-none text-[var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]">
          {alternativeName(shown, shownIndex)} — פירוט קורסים
        </summary>

        {/* Full structured differences */}
        {(() => {
          const diffs = shown.differences ?? shown.differencesHe.map((t) => ({ kind: 'other' as string, textHe: t }))
          return diffs.length > 0 ? (
            <div
              className="mt-2 rounded-md border border-[var(--purple)]/20 bg-[var(--surface)] px-2.5 py-2"
              role="note"
              aria-label="הבדלים מול ההצעה המומלצת"
            >
              <p className="mb-1.5 font-semibold text-[var(--text)]">הבדלים מהחלופה המומלצת:</p>
              <ul className="flex flex-col gap-1">
                {diffs.map((d, i) => (
                  <DiffRow key={i} diff={d as Difference} />
                ))}
              </ul>
            </div>
          ) : null
        })()}

        {/* Semester grid */}
        <div
          data-testid={`alternative-preview-${shown.candidateId}`}
          aria-label={`תצוגת לוח: ${alternativeName(shown, shownIndex)}`}
          className="mt-2 grid grid-cols-1 gap-1.5 text-[var(--text-muted)] sm:grid-cols-2"
        >
          {shown.semesters
            .filter((s) => s.courseIds.length > 0)
            .map((s) => (
              <div
                key={s.semesterId}
                className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5"
              >
                <span className="block text-[.68rem] font-semibold leading-tight">
                  {SEMESTER_LABEL_HE[s.semesterId] ?? s.semesterId}
                </span>
                <ul className="mt-1 flex flex-col gap-0.5 leading-tight">
                  {s.courseIds.map((id) => (
                    <li key={id} className="break-words">{courseNameById[id] ?? id}</li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      </details>

      {disabled && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          החלופות התיישנו בעקבות שינוי ידני או שינוי בהעדפות. יש לבנות מחדש.
        </p>
      )}
    </section>
  )
}
