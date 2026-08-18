'use client'

/**
 * C3/C6 — choose between validated plan alternatives.
 *
 * The server decides WHICH plans are legitimate choices (validated, distinct,
 * non-dominated, same hard constraints/profile/snapshot). This component only
 * lets a person compare and pick one. It never reconstructs a plan from the
 * difference text and never regenerates: selecting swaps the active draft to
 * the exact candidate the handler already returned.
 *
 * Motion: this is a productivity surface and the content is meant to be SCANNED
 * and compared, so nothing here animates layout, size or position — a moving
 * card would actively hurt the comparison it exists to support. The only
 * transition is a short colour/border change on the selected card, and it is
 * removed entirely under `prefers-reduced-motion`. Selection itself is instant.
 *
 * Accessibility: a real radiogroup — arrow keys move between alternatives, the
 * selected one is conveyed by a text badge and a border (never colour alone),
 * and a live region announces the change for screen readers.
 */
import { useRef } from 'react'
import type { GeneratedPlanModel } from '../../../shared/planner/model'

type Alternative = NonNullable<GeneratedPlanModel['alternatives']>[number]

const SEMESTER_LABEL_HE: Record<string, string> = {
  year_3_semester_a: 'סמסטר א׳',
  year_3_semester_b: 'סמסטר ב׳',
}
const semesterLabel = (id: string) => SEMESTER_LABEL_HE[id] ?? id

export default function PlanAlternatives({
  alternatives,
  selectedId,
  onSelect,
  disabled = false,
  courseNameById = {},
}: {
  alternatives: Alternative[]
  selectedId: string
  onSelect: (candidateId: string) => void
  /** Stale set: still readable for comparison, but no longer selectable. */
  disabled?: boolean
  courseNameById?: Record<string, string>
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  // One plan is a proposal, not a choice — the server returns an empty set in
  // that case, and this guard keeps the component honest if it ever does not.
  if (alternatives.length < 2) return null

  const selected = alternatives.find((a) => a.candidateId === selectedId) ?? alternatives[0]

  /** Arrow keys move within the group, as a radiogroup is expected to. */
  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']
    if (!keys.includes(e.key) || disabled) return
    e.preventDefault()
    // RTL: ArrowLeft advances, ArrowRight goes back.
    const forward = e.key === 'ArrowLeft' || e.key === 'ArrowDown'
    const next = (index + (forward ? 1 : -1) + alternatives.length) % alternatives.length
    const target = alternatives[next]
    onSelect(target.candidateId)
    refs.current[target.candidateId]?.focus()
  }

  return (
    <section aria-label="חלופות תוכנית" className="flex flex-col gap-3" dir="rtl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold tracking-tight">
          {`${alternatives.length} תוכניות חוקיות לבחירתך`}
        </h2>
        <p className="text-xs text-[var(--text-muted)]">
          כולן עומדות באותן דרישות ומגבלות. הן נבדלות בקורסים עצמם.
        </p>
      </div>

      {/* One live region for the whole group: it announces the set going STALE
          (a state change the student did not initiate on this control, and which
          removes their ability to choose) as well as the selection. Staleness
          takes precedence, because it is the fact that changes what they can do. */}
      <p role="status" aria-live="polite" className="sr-only">
        {disabled
          ? 'החלופות אינן זמינות לבחירה — ההעדפות השתנו מאז הבנייה, ויש לבנות מחדש.'
          : `נבחרה חלופה: ${selected.labelHe}`}
      </p>

      <div
        role="radiogroup"
        aria-label="בחירת חלופת תוכנית"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {alternatives.map((alt, i) => {
          const isSelected = alt.candidateId === selected.candidateId
          return (
            <button
              key={alt.candidateId}
              ref={(el) => { refs.current[alt.candidateId] = el }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected ? 0 : -1}
              disabled={disabled}
              onClick={() => !disabled && onSelect(alt.candidateId)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={[
                'flex flex-col gap-2 rounded-xl border p-3 text-right align-top',
                'motion-safe:transition-colors motion-safe:duration-150',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]',
                'disabled:cursor-not-allowed disabled:opacity-60',
                isSelected
                  ? 'border-[var(--purple-strong,#6d28d9)] border-2 bg-[var(--surface-hover,rgba(0,0,0,0.04))]'
                  : 'border-[var(--border)]',
              ].join(' ')}
            >
              <span className="flex flex-wrap items-center gap-2">
                {/* Selected state is text + border, never colour alone. */}
                <span className="text-xs font-semibold text-[var(--text)]">
                  {isSelected ? '✓ נבחר' : 'לא נבחר'}
                </span>
                {alt.recommended && (
                  <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]">
                    ברירת המחדל שלנו
                  </span>
                )}
              </span>

              <span className="text-sm font-medium text-[var(--text)]">{alt.labelHe}</span>

              <ul className="flex flex-col gap-0.5 text-xs text-[var(--text-muted)]">
                {alt.semesters
                  .filter((s) => s.courseIds.length > 0)
                  .map((s) => (
                    <li key={s.semesterId}>
                      <span className="font-medium">{semesterLabel(s.semesterId)}:</span>{' '}
                      {s.courseIds.map((id) => courseNameById[id] ?? id).join(', ')}
                    </li>
                  ))}
              </ul>

              <span className="text-xs text-[var(--text-muted)]">
                {`עומס שיא ${alt.workload.peakHours} ש״ש · סה״כ ${alt.workload.totalHours} ש״ש · ${alt.workload.activePeriods} סמסטרים פעילים`}
              </span>

              {alt.differencesHe.length > 0 && (
                <ul className="flex flex-col gap-0.5 text-xs text-[var(--text-muted)]">
                  {alt.differencesHe.map((d) => <li key={d}>• {d}</li>)}
                </ul>
              )}
            </button>
          )
        })}
      </div>

      {disabled && (
        // Text, not colour: the disabled cards are also dimmed, but dimming alone
        // would leave the reason invisible to anyone who cannot perceive it.
        <p className="text-xs text-[var(--text-muted)]">
          ההעדפות שלך השתנו מאז הבנייה — צריך לבנות מחדש כדי לבחור חלופה.
        </p>
      )}
    </section>
  )
}
