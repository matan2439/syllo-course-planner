'use client'

/**
 * CompletedCoursesPanel — the native replacement for the legacy "הקורסים שלי"
 * modal (app/web/semester_board_viewer.html: openMyCoursesModal /
 * _renderMyCoursesGrid). Same domain semantics, rebuilt as an accessible React
 * component; no legacy DOM code is carried over.
 *
 * WHAT IT OWNS. The student's own academic history as DRAFT state:
 *   - each standard early-year course is completed / not_completed / unknown
 *     (tri-state — an unanswered course is UNKNOWN, never silently "not taken",
 *     which is the one legacy semantic this deliberately fixes);
 *   - completed ELECTIVES chosen from the authoritative catalog (the legacy
 *     modal covered mandatory courses only);
 *   - an explicit "I completed none of these" answer;
 *   - `confirmed` — the student finished answering, which is what makes the set
 *     KNOWN (see api/ai/academic_status_knowledge.ts). Nothing here is known
 *     merely because a list happens to be empty.
 *
 * BOUNDARIES. Editing only updates draft academic status — it never mutates the
 * committed board, never edits authoritative catalog facts (credits/category/
 * prerequisites come from catalog data only), and NEVER calls Generate. Only an
 * explicit Build/Rebuild does.
 *
 * Motion: a productivity surface — instant state changes, no decorative motion
 * (same restraint as PreferenceConversation).
 */
import { useId, useMemo, useState } from 'react'
import {
  EARLY_YEAR_SEMESTERS,
  earlyYearCoursesFor,
  earlyYearHoursById,
} from '../../../shared/planner/early_year_courses'
import CourseNamePicker, { type PickerCourse } from './CourseNamePicker'
import { Badge, Card } from './ui'

export type CompletionAnswer = 'completed' | 'not_completed' | 'unknown'

export interface AcademicStatusDraft {
  /** Per standard early-year course. A missing entry is UNKNOWN (not answered). */
  statuses: Record<string, CompletionAnswer>
  /** Completed ELECTIVES, by authoritative catalog id. */
  electiveIds: string[]
  /** The student explicitly finished answering — this is what makes the set known. */
  confirmed: boolean
}

export const EMPTY_ACADEMIC_STATUS: AcademicStatusDraft = {
  statuses: {}, electiveIds: [], confirmed: false,
}

/** The completed course ids a draft reports, de-duplicated across both sections. */
export function completedCourseIdsOf(draft: AcademicStatusDraft): string[] {
  const ids = Object.entries(draft.statuses)
    .filter(([, s]) => s === 'completed')
    .map(([id]) => id)
  return [...new Set([...ids, ...draft.electiveIds])]
}

export default function CompletedCoursesPanel({
  programId,
  catalogCourses,
  catalogHoursById,
  value,
  onChange,
}: {
  programId: string
  catalogCourses: PickerCourse[]
  /** Authoritative weekly/credit hours by catalog course id (for electives). */
  catalogHoursById: Record<string, number | null | undefined>
  value: AcademicStatusDraft
  onChange: (next: AcademicStatusDraft) => void
}) {
  const [open, setOpen] = useState(false)
  const regionId = useId()

  const standard = useMemo(() => earlyYearCoursesFor(programId), [programId])
  const standardHours = useMemo(() => earlyYearHoursById(programId), [programId])

  const completedIds = completedCourseIdsOf(value)
  // Recognized credits: AUTHORITATIVE hours of the uniquely identified completed
  // courses. Never derived from an hours total, and each id counted exactly once
  // even if it appears in both the standard list and the elective selection.
  const { credits, unknownHourIds } = useMemo(() => {
    let sum = 0
    const unknown: string[] = []
    for (const id of completedIds) {
      const h = standardHours[id] ?? catalogHoursById[id]
      if (typeof h === 'number' && Number.isFinite(h)) sum += h
      else unknown.push(id)
    }
    return { credits: sum, unknownHourIds: unknown }
  }, [completedIds, standardHours, catalogHoursById])

  const answeredCount = standard.filter((c) => (value.statuses[c.courseId] ?? 'unknown') !== 'unknown').length
  const unansweredCount = standard.length - answeredCount

  const setStatus = (courseId: string, next: CompletionAnswer) => {
    const statuses = { ...value.statuses }
    if (next === 'unknown') delete statuses[courseId]
    else statuses[courseId] = next
    // Any edit re-opens the answer: it must be confirmed again before it counts
    // as known, so a stale confirmation can never vouch for changed facts.
    onChange({ ...value, statuses, confirmed: false })
  }

  const markAllNotCompleted = () => {
    const statuses: Record<string, CompletionAnswer> = { ...value.statuses }
    for (const c of standard) statuses[c.courseId] = 'not_completed'
    onChange({ ...value, statuses, confirmed: false })
  }

  const nameOf = (id: string) =>
    standard.find((c) => c.courseId === id)?.nameHe
    ?? catalogCourses.find((c) => c.id === id)?.nameHe
    ?? id

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold tracking-tight">קורסים שכבר השלמתי</h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={regionId}
          className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]"
        >
          {open ? 'סגור' : 'פתח'}
        </button>
      </div>

      {/* Always-visible status line — the student sees whether this is answered
          without opening the panel. Text, not colour alone. */}
      <p role="status" aria-live="polite" className="text-xs text-[var(--text-muted)]">
        {value.confirmed
          ? `נשמר: ${completedIds.length} קורסים שהושלמו · ${credits} ש״ש מוכרות`
          : 'עדיין לא נענה — בלי זה לא ניתן לאשר תוכנית. סך שעות בלבד אינו מספיק; צריך לדעת אילו קורסים.'}
      </p>

      {open && (
        <div id={regionId} className="flex flex-col gap-4" dir="rtl">
          {standard.length > 0 ? (
            <>
              <p className="text-xs text-[var(--text-muted)]">
                סמנו לכל קורס האם השלמתם אותו. קורס שלא נענה נשאר “לא ידוע” — הוא לא ייחשב כאילו לא נלמד.
              </p>
              {EARLY_YEAR_SEMESTERS.map((sem) => {
                const courses = standard.filter((c) => c.semesterId === sem.id)
                if (courses.length === 0) return null
                return (
                  <fieldset key={sem.id} className="rounded-xl border border-[var(--border)] p-3">
                    <legend className="px-1 text-xs font-semibold">{sem.titleHe}</legend>
                    <ul className="flex flex-col gap-2">
                      {courses.map((c) => {
                        const status = value.statuses[c.courseId] ?? 'unknown'
                        return (
                          <li key={c.courseId} className="flex flex-wrap items-center justify-between gap-2">
                            <span className="min-w-0 flex-1 text-xs">
                              {c.nameHe}
                              <span className="text-[var(--text-muted)]"> · {c.creditHours} ש״ש</span>
                            </span>
                            <span className="flex gap-1" role="group" aria-label={`סטטוס: ${c.nameHe}`}>
                              <button
                                type="button"
                                aria-pressed={status === 'completed'}
                                onClick={() => setStatus(c.courseId, status === 'completed' ? 'unknown' : 'completed')}
                                className={`rounded-full border px-2.5 py-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)] ${
                                  status === 'completed'
                                    ? 'border-emerald-600 bg-emerald-600 text-white'
                                    : 'border-[var(--border)]'
                                }`}
                              >
                                השלמתי
                              </button>
                              <button
                                type="button"
                                aria-pressed={status === 'not_completed'}
                                onClick={() => setStatus(c.courseId, status === 'not_completed' ? 'unknown' : 'not_completed')}
                                className={`rounded-full border px-2.5 py-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)] ${
                                  status === 'not_completed'
                                    ? 'border-[var(--text-muted)] bg-[var(--text-muted)] text-white'
                                    : 'border-[var(--border)]'
                                }`}
                              >
                                לא השלמתי
                              </button>
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </fieldset>
                )
              })}
              <button
                type="button"
                onClick={markAllNotCompleted}
                className="self-start rounded-full border border-dashed border-[var(--border)] px-4 py-1.5 text-xs text-[var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]"
              >
                לא השלמתי אף אחד מהקורסים ברשימה
              </button>
            </>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">
              לתוכנית הזו אין רשימת קורסי שנים א׳–ב׳ מובנית. אפשר להוסיף קורסים שהושלמו מתוך הקטלוג.
            </p>
          )}

          {/* Completed ELECTIVES — catalog-backed only; the student cannot invent
              a course, its credits, or its category. */}
          <div className="flex flex-col gap-1.5">
            <CourseNamePicker
              inputName="completed-elective-search"
              label="קורסי בחירה שכבר השלמתי (חיפוש לפי שם)"
              placeholder="הקלידו שם קורס בחירה שהושלם…"
              courses={catalogCourses}
              selectedIds={value.electiveIds}
              onChange={(ids) => onChange({ ...value, electiveIds: ids, confirmed: false })}
            />
            <p className="text-[11px] text-[var(--text-muted)]">
              נקודות הזכות והשיוך לקטגוריה נלקחים מנתוני הקטלוג בלבד.
            </p>
          </div>

          {/* Summary — what will actually be reported. */}
          <section aria-label="סיכום קורסים שהושלמו" className="rounded-xl border border-[var(--border)] p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{completedIds.length} קורסים</Badge>
              <Badge>{credits} ש״ש מוכרות</Badge>
              {unansweredCount > 0 && <Badge variant="warn">{unansweredCount} ללא תשובה</Badge>}
            </div>
            {completedIds.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {completedIds.map((id) => (
                  <li key={id} className="flex items-center justify-between gap-2">
                    <span>{nameOf(id)}</span>
                    <button
                      type="button"
                      aria-label={`הסר ${nameOf(id)}`}
                      onClick={() => {
                        if (value.electiveIds.includes(id)) {
                          onChange({ ...value, electiveIds: value.electiveIds.filter((x) => x !== id), confirmed: false })
                        } else {
                          setStatus(id, 'unknown')
                        }
                      }}
                      className="text-[var(--text-muted)] hover:text-[var(--text)]"
                    >
                      הסר
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {unknownHourIds.length > 0 && (
              <p className="mt-2 text-amber-700 dark:text-amber-300">
                לחלק מהקורסים אין נתוני שעות בקטלוג — הם נרשמו כהושלמו אך אינם נספרים בשעות המוכרות.
              </p>
            )}
          </section>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChange({ ...value, confirmed: true })}
              disabled={value.confirmed}
              className="rounded-full bg-[var(--purple-strong)] px-5 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {value.confirmed ? 'נשמר' : 'שמור את הסטטוס'}
            </button>
            <span className="text-[11px] text-[var(--text-muted)]">שמירה לא מייצרת תוכנית — לחצו “בנה תוכנית”.</span>
          </div>
        </div>
      )}
    </Card>
  )
}
