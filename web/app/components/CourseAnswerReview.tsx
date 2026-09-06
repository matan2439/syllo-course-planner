'use client'

import { useState } from 'react'
import { rankCourseMatches } from '../../../shared/search/course-name-match'

export type CourseScope = { id: string; label: string; courseIds: string[] }
type Names = Readonly<Record<string, string | null | undefined>>
export type CourseTextReview = { text: string; except: boolean; queries: string[] }

/** A tentative interpretation, never an academic claim until reviewed. */
export function reviewCourseText(text: string, names: Names): CourseTextReview | null {
  const content = text.replace(/^(?:השלמתי|עשיתי|למדתי)\s+/u, '').trim()
  const except = /^(?:כל הקורסים|הכול|הכל)\s+(?:חוץ\s+מ|למעט\s+)(.+)$/u.exec(content)
  const queries = (except?.[1] ?? content).split(/[,;\n]+/u).map((query) => query.trim()).filter(Boolean)
  const courses = Object.entries(names).filter((entry): entry is [string, string] => Boolean(entry[1]))
  if (!except && !queries.every((query) => rankCourseMatches(query, courses, (c) => c[1], (c) => c[0]).length > 0)) return null
  return queries.length ? { text, except: Boolean(except), queries } : null
}

export default function CourseAnswerReview({ review, names, scopes, disabled, onConfirm, onCancel }: {
  review: CourseTextReview
  names: Names
  scopes: readonly CourseScope[]
  disabled: boolean
  onConfirm: (ids: string[], text: string) => void
  onCancel: () => void
}) {
  const [scopeId, setScopeId] = useState('')
  const [queries, setQueries] = useState(review.queries)
  const [choices, setChoices] = useState<Record<number, string>>({})
  const courses = Object.entries(names).filter((entry): entry is [string, string] => Boolean(entry[1]))
  const matches = queries.map((query) => query.trim() ? rankCourseMatches(query, courses, (c) => c[1], (c) => c[0]) : [])
  const chosen = matches.map((items, index) => choices[index] ?? (items.length === 1 ? items[0].item[0] : ''))
  const scope = scopes.find((item) => item.id === scopeId)
  const resolved = chosen.every((id, index) => id && matches[index].some(({ item }) => item[0] === id))
  const inScope = !review.except || Boolean(scope && chosen.every((id) => scope.courseIds.includes(id)))
  const ids = [...new Set(review.except ? scope?.courseIds.filter((id) => !chosen.includes(id)) ?? [] : chosen.filter(Boolean))]
  const ready = resolved && inScope && ids.length <= 64
  const controlClass = 'min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]'

  return (
    <fieldset disabled={disabled} className="mt-3 min-w-0 space-y-3 rounded-xl border border-[var(--purple)]/40 p-3">
      <legend className="px-1 text-sm font-semibold">נבדוק יחד שהבנתי נכון</legend>
      <p className="text-sm break-words">{review.text}</p>
      <p className="text-xs text-[var(--text-muted)]">זו רשימה לבדיקה בלבד. שום קורס לא יירשם כהושלם לפני האישור שלך.</p>
      {review.except && (
        <label className="block space-y-1 text-sm">לאיזו קבוצת קורסים התכוונת?
          <select className={controlClass} value={scopeId} onChange={(event) => setScopeId(event.target.value)}>
            <option value="">בחרו קבוצה — ללא ניחוש</option>
            {scopes.map((item) => <option key={item.id} value={item.id}>{item.label} ({item.courseIds.length})</option>)}
          </select>
        </label>
      )}
      {queries.map((query, index) => (
        <div key={index} className="space-y-1">
          <label className="block text-xs">{review.except ? 'חיפוש קורס שלא הושלם' : 'חיפוש שם הקורס'} {index + 1}
            <input className={controlClass} value={query} onChange={(event) => {
              setQueries((items) => items.map((item, i) => i === index ? event.target.value : item))
              setChoices((items) => { const next = { ...items }; delete next[index]; return next })
            }} />
          </label>
          {matches[index].length === 0 ? <p role="status" className="text-xs">לא נמצאה התאמה. נסו חלק אחר מהשם, או חזרו לשיחה.</p> : (
            <label className="block text-xs">איזה קורס הוא „{query}”?
              <select className={controlClass} value={chosen[index]} onChange={(event) => setChoices((items) => ({ ...items, [index]: event.target.value }))}>
                <option value="">בחרו את הקורס המתאים</option>
                {matches[index].map(({ item: [id, name] }) => <option key={id} value={id}>{name} ({id})</option>)}
              </select>
            </label>
          )}
        </div>
      ))}
      {review.except && scope && resolved && !inScope && <p role="status" className="text-xs">אחד הקורסים שהוחרגו אינו בקבוצה שנבחרה. בחרו קבוצה או קורס אחר.</p>}
      {ready && <div className="text-sm">
        <p className="font-semibold">לאישור שלך: {ids.length} קורסים</p>
        <ul aria-label="הרשימה שתישלח לעוזר" className="max-h-44 overflow-y-auto space-y-1 py-2">
          {ids.map((id) => <li key={id}>{names[id] ?? id}</li>)}
        </ul>
      </div>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!ready} onClick={() => onConfirm(ids, `${review.text}\nאישור הרשימה: ${ids.length ? ids.map((id) => names[id] ?? id).join(', ') : 'אין קורסים'}`)}
          className="min-h-11 rounded-full bg-[var(--purple-strong)] px-4 text-sm text-white disabled:opacity-50">אישור הרשימה ושליחה לעוזר</button>
        <button type="button" onClick={onCancel} className="min-h-11 rounded-full border border-[var(--border)] px-4 text-sm">חזרה לשיחה</button>
      </div>
    </fieldset>
  )
}
