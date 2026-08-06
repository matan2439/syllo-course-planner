'use client'

/**
 * Approximate course-name picker — type a Hebrew course name (approximately: no
 * parens/nikkud, partial, small typos) and pick from a RANKED list; selections
 * are kept as chips. Resolves names to canonical ids for the planner. Reuses the
 * shared fuzzy matcher (course-name-match.ts) so every search bar ranks alike.
 */
import { useMemo, useState } from 'react'
import { rankCourseMatches } from '../../../shared/search/course-name-match'

export interface PickerCourse {
  id: string
  nameHe: string | null
}

export default function CourseNamePicker({
  label,
  placeholder,
  courses,
  selectedIds,
  onChange,
}: {
  label: string
  placeholder?: string
  courses: PickerCourse[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
}) {
  const [q, setQ] = useState('')

  const matches = useMemo(() => {
    if (!q.trim()) return []
    const pool = courses.filter((c) => !selectedIds.includes(c.id))
    return rankCourseMatches(q, pool, (c) => c.nameHe ?? '', (c) => c.id).slice(0, 8)
  }, [q, courses, selectedIds])

  const nameOf = (id: string) => courses.find((c) => c.id === id)?.nameHe ?? id
  const add = (id: string) => { onChange([...new Set([...selectedIds, id])]); setQ('') }
  const remove = (id: string) => onChange(selectedIds.filter((x) => x !== id))

  return (
    <div className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
      {label}
      <div className="relative">
        <input
          aria-label={label}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder ?? 'הקלידו שם קורס…'}
          className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text)]"
        />
        {matches.length > 0 && (
          <ul
            role="listbox"
            aria-label={`${label} — הצעות`}
            className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-lg"
          >
            {matches.map((m) => (
              <li key={m.item.id} role="option" aria-selected="false">
                <button
                  type="button"
                  onClick={() => add(m.item.id)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-right text-sm hover:bg-[var(--surface-hover,rgba(0,0,0,0.05))]"
                >
                  <span className="truncate text-[var(--text)]">{m.item.nameHe ?? m.item.id}</span>
                  <span dir="ltr" className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">{m.item.id}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {selectedIds.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {selectedIds.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text)]">
              {nameOf(id)}
              <button type="button" aria-label={`הסר ${nameOf(id)}`} onClick={() => remove(id)} className="text-[var(--text-muted)] hover:text-[var(--text)]">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
