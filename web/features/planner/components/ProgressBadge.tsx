import { useState } from 'react'
import type { RequirementsVM } from '../../../lib/requirements'
import { categoryAccentColor } from '../../courses/components/course-category'

/** Hours and course count toward one requirement category, including completed courses. */
export type CategoryProgress = { hours: number; count: number }

/**
 * Small always-visible header badge showing degree-progress at a glance
 * (hours placed/required + per-category coverage), expandable for detail.
 * Renders the RequirementsVM the server computed (see lib/requirements.ts);
 * `categoryProgress` only adds completed courses the board does not hold.
 */
export default function ProgressBadge({ requirements, completedHours = 0, categoryProgress = {} }: {
  requirements: RequirementsVM | null
  /** Credit already earned outside the board (e.g. Years 1–2), counted toward the degree. */
  completedHours?: number
  /** Category id → hours and courses counted there (board + completed). */
  categoryProgress?: Readonly<Record<string, CategoryProgress>>
}) {
  const [open, setOpen] = useState(false)
  if (!requirements) return null
  const earned = Math.round((requirements.plannedHours + completedHours) * 10) / 10
  const remaining = Math.max(0, Math.round((requirements.remainingHours - completedHours) * 10) / 10)
  const satisfied = remaining <= 0
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`התקדמות בתוכנית — ${earned} מתוך ${requirements.totalRequiredHours} ש״ש`}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]"
      >
        <span
          aria-hidden="true"
          className={`size-2 rounded-full ${satisfied ? 'bg-emerald-500' : 'bg-amber-400'}`}
        />
        {earned}/{requirements.totalRequiredHours} ש״ש
      </button>
      {open && (
        <div className="absolute end-0 z-20 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-premium)] backdrop-blur-sm">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-semibold">נותרו {remaining} ש״ש</span>
            <span className="text-[var(--text-muted)]">ליבה {requirements.core.selected}/{requirements.core.min}</span>
          </div>
          {completedHours > 0 && (
            <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">כולל {completedHours} ש״ש שכבר הושלמו</p>
          )}
          <ul className="mt-2.5 flex flex-col gap-1.5 border-t border-[var(--border)] pt-2.5">
            {requirements.categories.map((c) => {
              const progress = categoryProgress[c.id]
              const count = progress?.count ?? c.selectedCount
              const done = c.minCourses > 0 && (c.satisfied || count >= c.minCourses)
              return (
                <li key={c.id} className="flex items-center gap-2 text-xs">
                  <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: categoryAccentColor(c.id) }} />
                  <span className="min-w-0 flex-1 leading-snug">{c.title}</span>
                  {progress && <span className="shrink-0 tabular-nums text-[var(--text-muted)]">{progress.hours} ש״ש</span>}
                  <span className={`shrink-0 tabular-nums font-medium ${done ? 'text-emerald-500' : c.minCourses > 0 ? 'text-amber-500' : 'text-[var(--text-muted)]'}`}>
                    {done && <span className="sr-only">הושלם </span>}
                    {c.minCourses > 0 ? `${count}/${c.minCourses}` : count}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
