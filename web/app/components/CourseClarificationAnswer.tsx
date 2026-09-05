'use client'

import { useMemo, useState } from 'react'
import { rankCourseMatches } from '../../../shared/search/course-name-match'

type CourseQuestionId = 'completed_courses' | 'current_courses' | 'excluded_courses'

const ANSWER_LABELS = {
  completed_courses: { prefix: 'הקורסים שהשלמתי', none: 'לא השלמתי קורסים' },
  current_courses: { prefix: 'הקורסים שאני לומד/ת כעת', none: 'איני לומד/ת קורסים כעת' },
  excluded_courses: { prefix: 'הקורסים שברצוני להחריג', none: 'אין קורסים להחרגה' },
} satisfies Record<CourseQuestionId, { prefix: string; none: string }>

export function isCourseQuestion(id: string | undefined): id is CourseQuestionId {
  return id === 'completed_courses' || id === 'current_courses' || id === 'excluded_courses'
}

/** A draft answer inside a server-issued question; selection alone sends nothing. */
export default function CourseClarificationAnswer({ questionId, courseNameById = {}, disabled, onConfirm }: {
  questionId: CourseQuestionId
  courseNameById?: Readonly<Record<string, string | null | undefined>>
  disabled: boolean
  onConfirm: (ids: string[], text: string) => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const courses = useMemo(() => Object.entries(courseNameById)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
    .map(([id, name]) => ({ id, name })), [courseNameById])
  const matches = useMemo(() => rankCourseMatches(query, courses, (course) => course.name, (course) => course.id), [query, courses])
  const labels = ANSWER_LABELS[questionId]
  const nameOf = (id: string) => courseNameById[id] ?? id

  return (
    <fieldset disabled={disabled} className="mt-3 min-w-0 space-y-3 disabled:opacity-60">
      <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
        חיפוש קורסים לתשובה
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="שם קורס או מספר…"
          className="min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]" />
      </label>
      {matches.length > 0 ? (
        <ul aria-label="קורסים לבחירה" className="max-h-44 overflow-y-auto overscroll-contain divide-y divide-[var(--border)]">
          {matches.slice(0, 8).map(({ item }) => (
            <li key={item.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 py-2 text-sm">
                <input type="checkbox" checked={selected.includes(item.id)}
                  disabled={selected.length >= 64 && !selected.includes(item.id)}
                  onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))}
                  className="h-4 w-4 shrink-0 accent-[var(--purple-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]" />
                <span className="min-w-0"><span className="block break-words">{item.name}</span>
                  <bdi className="text-xs text-[var(--text-muted)]">{item.id}</bdi>
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p role="status" className="text-sm text-[var(--text-muted)]">לא נמצאו קורסים. אפשר לשנות את החיפוש או להסביר לעוזר בהודעה.</p>
      )}
      {matches.length > 8 && <p className="text-xs text-[var(--text-muted)]">מוצגים 8 מתוך {matches.length} קורסים. חיפוש לפי שם יצמצם את הרשימה.</p>}
      {selected.length > 0 && (
        <div role="group" aria-label="קורסים שנבחרו לתשובה" className="flex flex-wrap gap-2">
          {selected.map((id) => (
            <button key={id} type="button" aria-label={`הסר ${nameOf(id)} מהתשובה`}
              onClick={() => setSelected((ids) => ids.filter((current) => current !== id))}
              className="min-h-11 max-w-full rounded-lg border border-[var(--purple)] px-3 py-2 text-start text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]">
              {nameOf(id)} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={selected.length === 0}
          onClick={() => onConfirm(selected, `${labels.prefix}: ${selected.map(nameOf).join(', ')}`)}
          className="min-h-11 rounded-full bg-[var(--purple-strong)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]">
          {selected.length === 1 ? 'אישור קורס אחד' : `אישור ${selected.length} קורסים`}
        </button>
        <button type="button" disabled={selected.length > 0} onClick={() => onConfirm([], labels.none)}
          className="min-h-11 rounded-full border border-[var(--border)] px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]">
          {labels.none}
        </button>
      </div>
    </fieldset>
  )
}
