import { useState } from 'react'
import type { RequirementsVM } from '../../../lib/requirements'
import { Badge } from '../../../components/ui'

/**
 * Small always-visible header badge showing degree-progress at a glance
 * (hours placed/required + per-category coverage), expandable for detail.
 * Renders the RequirementsVM the server computed (see lib/requirements.ts) —
 * never a second computation here.
 */
export default function ProgressBadge({ requirements, completedHours = 0 }: {
  requirements: RequirementsVM | null
  /** Credit already earned outside the board (e.g. Years 1–2), counted toward the degree. */
  completedHours?: number
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
        <div className="absolute z-10 mt-2 w-72 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-premium)] backdrop-blur-sm">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold">נותרו {remaining} ש״ש</span>
            <span className="text-[var(--text-muted)]">קורסי ליבה: {requirements.core.selected}/{requirements.core.min}</span>
          </div>
          {completedHours > 0 && (
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">כולל {completedHours} ש״ש שכבר הושלמו</p>
          )}
          <div className="mt-2 flex flex-col gap-1.5">
            {requirements.categories.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-xs">
                <span>{c.title}</span>
                {c.satisfied
                  ? <Badge variant="success">הושלם</Badge>
                  : <Badge variant="warn">{c.selectedCount}/{c.minCourses}</Badge>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
