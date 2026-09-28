'use client'

/**
 * CompletedCoursesPanel — the native replacement for the legacy "הקורסים שלי"
 * modal (the retired single-file planner: openMyCoursesModal /
 * _renderMyCoursesGrid). Same domain semantics, rebuilt as an accessible React
 * component; no legacy DOM code is carried over.
 *
 * WHAT IT OWNS. The student's own academic history as DRAFT state:
 *   - each standard early-year course is completed / not_completed / unknown
 *     (tri-state — an unanswered course is UNKNOWN, never silently "not taken",
 *     which is the one legacy semantic this deliberately fixes);
 *   - completed ELECTIVES chosen from the authoritative catalog (the legacy
 *     modal covered mandatory courses only);
 *   - saving with nothing ticked is an explicit "I completed none of these";
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
import { useMemo } from 'react'
import {
  EARLY_YEAR_SEMESTERS,
  earlyYearCoursesFor,
  earlyYearHoursById,
} from '../../../../shared/planner/early_year_courses'
import CourseNamePicker, { type PickerCourse } from './CourseNamePicker'
import { Badge } from '../../../components/ui'

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

/** Rebuilds the editable view from the server-owned academic status after refresh. */
export function academicStatusDraftFromPersonalStatus(
  personalStatus: unknown,
  programId: string,
): AcademicStatusDraft {
  const status = (personalStatus ?? {}) as {
    completed?: unknown
    completed_knowledge?: { status?: unknown }
  }
  const completed = Array.isArray(status.completed)
    ? [...new Set(status.completed.flatMap((entry) => {
        const id = (entry as { course_id?: unknown })?.course_id
        return typeof id === 'string' && id.trim() ? [id] : []
      }))]
    : []
  const standardIds = new Set(earlyYearCoursesFor(programId).map((course) => course.courseId))
  return {
    statuses: Object.fromEntries(completed.filter((id) => standardIds.has(id)).map((id) => [id, 'completed'])),
    electiveIds: completed.filter((id) => !standardIds.has(id)),
    confirmed: status.completed_knowledge?.status === 'known',
  }
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

  // Any edit re-opens the answer: it must be saved again before it counts as
  // known, so a stale confirmation can never vouch for changed facts. An
  // unticked course stays UNKNOWN until saved — never silently "not taken".
  const setMany = (courseIds: readonly string[], completed: boolean) => {
    const statuses: Record<string, CompletionAnswer> = { ...value.statuses }
    for (const id of courseIds) {
      if (completed) statuses[id] = 'completed'
      else delete statuses[id]
    }
    onChange({ ...value, statuses, confirmed: false })
  }

  // Saving is the student's "I finished answering": every unticked standard
  // course becomes an explicit not_completed, and the set becomes known.
  const save = () => {
    const statuses: Record<string, CompletionAnswer> = {}
    for (const c of standard) statuses[c.courseId] = value.statuses[c.courseId] === 'completed' ? 'completed' : 'not_completed'
    onChange({ ...value, statuses, confirmed: true })
  }

  const checkbox = 'size-4 shrink-0 accent-[var(--purple-strong)]'

  return (
    <details className="group rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]">
        <span className="text-sm font-semibold">קורסים שהשלמתי</span>
        {/* Always-visible status — text, not colour alone. */}
        <span role="status" aria-live="polite" className="flex items-center gap-1.5">
          {(completedIds.length > 0 || value.confirmed) && <Badge>{completedIds.length} קורסים · {credits} ש״ש</Badge>}
          {value.confirmed ? <Badge variant="success">נשמר</Badge> : <Badge variant="warn">לא נשמר</Badge>}
          <span aria-hidden className="text-xs text-[var(--text-muted)] group-open:rotate-180">▾</span>
        </span>
      </summary>

      <div className="flex flex-col gap-3 border-t border-[var(--border)] p-3" dir="rtl">
        {EARLY_YEAR_SEMESTERS.map((sem) => {
          const courses = standard.filter((c) => c.semesterId === sem.id)
          if (courses.length === 0) return null
          const ids = courses.map((c) => c.courseId)
          const allDone = ids.every((id) => value.statuses[id] === 'completed')
          return (
            <fieldset key={sem.id} className="flex flex-col gap-1.5">
              <legend className="mb-1 flex w-full items-center gap-2 text-xs font-semibold">
                <input type="checkbox" className={checkbox} checked={allDone}
                  aria-label={`כל ${sem.titleHe}`}
                  onChange={() => setMany(ids, !allDone)} />
                {sem.titleHe}
              </legend>
              {courses.map((c) => (
                <label key={c.courseId} className="flex items-center gap-2 ps-6 text-xs">
                  <input type="checkbox" className={checkbox}
                    checked={value.statuses[c.courseId] === 'completed'}
                    onChange={(e) => setMany([c.courseId], e.target.checked)} />
                  <span className="min-w-0 flex-1">{c.nameHe}</span>
                  <span className="shrink-0 text-[var(--text-muted)]">{c.creditHours} ש״ש</span>
                </label>
              ))}
            </fieldset>
          )
        })}

        {/* Completed ELECTIVES — catalog-backed only; the student cannot invent
            a course, its credits, or its category. */}
        <CourseNamePicker
          inputName="completed-elective-search"
          label="קורסי בחירה שהשלמתי"
          placeholder="חיפוש לפי שם…"
          courses={catalogCourses}
          selectedIds={value.electiveIds}
          onChange={(ids) => onChange({ ...value, electiveIds: ids, confirmed: false })}
        />

        {unknownHourIds.length > 0 && (
          <p className="text-[11px] text-amber-700 dark:text-amber-300">
            לחלק מהקורסים אין נתוני שעות בקטלוג — הם לא נספרים בשעות.
          </p>
        )}

        <button
          type="button"
          onClick={save}
          disabled={value.confirmed}
          className="self-start rounded-lg bg-[var(--purple-strong)] px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]"
        >
          {value.confirmed ? 'נשמר' : 'שמירה'}
        </button>
      </div>
    </details>
  )
}
