'use client'

import { useEffect, useMemo, useState } from 'react'
import type { SemesterDestination } from './UnifiedCourseRepository'
import WeeklyScheduleGrid, { type GridBlock } from './WeeklyScheduleGrid'
import { fetchScheduleGroups, fetchCourseSearch } from '../../lib/planner/schedule-client'
import {
  loadWeeklyScheduleState,
  saveWeeklyScheduleState,
  selectionKey,
} from '../../lib/planner/schedule-storage'
import { defaultTermMapping, groupsOverlap } from '../../../shared/planner/schedule'
import type {
  ScheduleGroupsResponse,
  ScheduleGroup,
  SemesterTerm,
  CourseSearchResponse,
} from '../../../shared/planner/schedule'

interface SemesterCourses {
  semesterId: string
  courseIds: string[]
}

type SelectedScheduleGroup = { courseId: string; courseName: string; group: ScheduleGroup }

/** A lecture and its tutorial are separate choices; parallel groups of the
 * same kind/mode are alternatives for the student to choose between. */
function choiceKey(group: ScheduleGroup): string {
  return `${group.kind}\u0000${group.teachingMode}`
}

function groupsByChoice(groups: readonly ScheduleGroup[]): ScheduleGroup[][] {
  const byChoice = new Map<string, ScheduleGroup[]>()
  for (const group of groups) {
    const key = choiceKey(group)
    byChoice.set(key, [...(byChoice.get(key) ?? []), group])
  }
  return [...byChoice.values()]
}

function automaticGroupIds(groups: readonly ScheduleGroup[]): string[] {
  return groupsByChoice(groups)
    .filter((choices) => choices.length === 1 && choices[0].slots.length > 0)
    .map(([group]) => group.groupId)
}

function groupDescription(group: ScheduleGroup): string {
  const slot = group.slots[0]
  return slot
    ? `${group.kind} · קבוצה ${group.havura || group.groupId} · יום ${slot.day} ${slot.start}–${slot.end}`
    : `${group.kind} · קבוצה ${group.havura || group.groupId} · ללא שעות`
}

export default function WeeklyScheduleDrawer({
  programId,
  semesterDestinations,
  semesterCourses,
  fetchScheduleGroupsFn = fetchScheduleGroups,
  fetchCourseSearchFn = fetchCourseSearch,
}: {
  programId: string
  semesterDestinations: readonly SemesterDestination[]
  semesterCourses: readonly SemesterCourses[]
  fetchScheduleGroupsFn?: typeof fetchScheduleGroups
  fetchCourseSearchFn?: typeof fetchCourseSearch
}) {
  const defaultMapping = useMemo(
    () => defaultTermMapping(semesterDestinations.map((d) => d.id), new Date()),
    [semesterDestinations],
  )
  const [state, setState] = useState(() => loadWeeklyScheduleState(programId, defaultMapping))
  const [activeSemesterId, setActiveSemesterId] = useState(semesterDestinations[0]?.id ?? '')
  const [scheduleData, setScheduleData] = useState<ScheduleGroupsResponse | null>(null)
  const [extraCourseIds, setExtraCourseIds] = useState<string[]>([])
  const [searchText, setSearchText] = useState('')
  const [searchResults, setSearchResults] = useState<CourseSearchResponse['results']>([])
  const [conflictMessage, setConflictMessage] = useState<string | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    saveWeeklyScheduleState(programId, state)
  }, [programId, state])

  const term: SemesterTerm = state.termMapping[activeSemesterId] ?? defaultMapping[activeSemesterId]

  const boardCourseIds = useMemo(
    () => semesterCourses.find((s) => s.semesterId === activeSemesterId)?.courseIds ?? [],
    [semesterCourses, activeSemesterId],
  )
  const candidateCourseIds = useMemo(
    () => [...new Set([...boardCourseIds, ...extraCourseIds])],
    [boardCourseIds, extraCourseIds],
  )
  // Content-based key so the fetch effect below only re-runs when the actual
  // set of course ids changes — not merely when an upstream array/object
  // reference changes (e.g. the extraCourseIds-reset effect on mount).
  const candidateCourseIdsKey = useMemo(
    () => [...candidateCourseIds].sort().join(','),
    [candidateCourseIds],
  )

  useEffect(() => {
    setExtraCourseIds([])
    setConflictMessage(null)
    setSearchError(null)
  }, [activeSemesterId])

  useEffect(() => {
    let live = true
    if (candidateCourseIds.length === 0) {
      setFetchError(null)
      setScheduleData({ semester: term.semester, courses: [], source: 'bidit', fetchedAt: new Date().toISOString() })
      return
    }
    fetchScheduleGroupsFn(candidateCourseIds, term.semester).then(
      (data) => { if (live) { setFetchError(null); setScheduleData(data) } },
      () => {
        if (live) {
          setFetchError('טעינת נתוני השעות נכשלה. נסו לרענן או לנסות שוב מאוחר יותר.')
          setScheduleData(null)
        }
      },
    )
    return () => { live = false }
    // candidateCourseIds is intentionally omitted — candidateCourseIdsKey
    // captures its content, and the array itself is read via closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateCourseIdsKey, term.semester, fetchScheduleGroupsFn])

  const persistedGroupIds = (courseId: string): string[] =>
    state.selections[selectionKey(courseId, term)] ?? []

  const selectedGroupIds = (course: ScheduleGroupsResponse['courses'][number]): string[] =>
    [...new Set([...automaticGroupIds(course.groups), ...persistedGroupIds(course.courseId)])]

  const allSelectedGroups = (): SelectedScheduleGroup[] => {
    if (!scheduleData) return []
    const result: SelectedScheduleGroup[] = []
    for (const course of scheduleData.courses) {
      for (const groupId of selectedGroupIds(course)) {
        const group = course.groups.find((g) => g.groupId === groupId)
        if (group) result.push({ courseId: course.courseId, courseName: course.nameHe ?? course.courseId, group })
      }
    }
    return result
  }

  useEffect(() => {
    if (!scheduleData) return

    // Automatically placed singleton choices are informational: keep them on
    // the grid even if two fixed meetings overlap. The student still cannot
    // choose an optional group that overlaps another course.
    const accepted = scheduleData.courses.flatMap((course) =>
      automaticGroupIds(course.groups)
        .map((groupId) => course.groups.find((group) => group.groupId === groupId))
        .filter((group): group is ScheduleGroup => group !== undefined)
        .map((group) => ({ courseId: course.courseId, courseName: course.nameHe ?? course.courseId, group })),
    )
    const nextSelections = { ...state.selections }
    let changed = false
    const removedSelections: Array<
      | { kind: 'conflict'; courseName: string; conflictingCourseName: string }
      | { kind: 'dangling'; courseName: string }
    > = []

    // When this refetch reveals a conflict between two selections that were
    // previously independent, the course that sorts EARLIER in
    // scheduleData.courses (board/API order) survives and the later one is
    // dropped. That is a different tie-break than toggleGroup's, which
    // always keeps whatever the user already had selected and blocks the
    // new click — there is no "the user's original choice" to prefer here,
    // because this revalidation runs in response to a data refresh, not a
    // user action. The survivor is simply whichever course is reached first
    // while iterating the freshly-fetched course list.
    for (const course of scheduleData.courses) {
      const key = selectionKey(course.courseId, term)
      const automaticIds = new Set(automaticGroupIds(course.groups))
      const selectedIds = (state.selections[key] ?? []).filter((groupId) => !automaticIds.has(groupId))
      const keptIds: string[] = []

      for (const groupId of selectedIds) {
        const group = course.groups.find((candidate) => candidate.groupId === groupId)
        if (!group) {
          changed = true
          removedSelections.push({ kind: 'dangling', courseName: course.nameHe ?? course.courseId })
          continue
        }
        const conflict = accepted.find(
          (selected) => selected.courseId !== course.courseId && groupsOverlap(selected.group, group),
        )
        if (conflict) {
          changed = true
          removedSelections.push({
            kind: 'conflict',
            courseName: course.nameHe ?? course.courseId,
            conflictingCourseName: conflict.courseName,
          })
          continue
        }
        keptIds.push(groupId)
        accepted.push({
          courseId: course.courseId,
          courseName: course.nameHe ?? course.courseId,
          group,
        })
      }

      if (keptIds.length !== selectedIds.length) nextSelections[key] = keptIds
    }

    if (!changed) return
    setState((previous) => ({ ...previous, selections: nextSelections }))
    if (removedSelections.length === 1) {
      const removal = removedSelections[0]
      setConflictMessage(
        removal.kind === 'conflict'
          ? `הבחירה ב'${removal.courseName}' הוסרה כי היא חופפת ל'${removal.conflictingCourseName}' לאחר רענון נתוני השעות.`
          : `הבחירה ב'${removal.courseName}' הוסרה כי נתוני הקבוצה השתנו או נעלמו לאחר רענון נתוני השעות.`,
      )
    } else if (removedSelections.length > 1) {
      const courseNames = [...new Set(removedSelections.map((removal) => removal.courseName))]
      setConflictMessage(
        `הבחירות הבאות הוסרו לאחר רענון נתוני השעות: ${courseNames.join(', ')}.`,
      )
    }
  }, [scheduleData, state.selections, term])

  const chooseGroup = (courseId: string, courseName: string, group: ScheduleGroup) => {
    const key = selectionKey(courseId, term)
    const current = state.selections[key] ?? []

    const conflict = allSelectedGroups().find(
      (selected) => selected.courseId !== courseId && groupsOverlap(selected.group, group),
    )
    if (conflict) {
      const slot = conflict.group.slots[0]
      setConflictMessage(
        `חופף ל'${conflict.courseName}' בימי ${slot?.day ?? ''} ${slot?.start ?? ''}–${slot?.end ?? ''}`,
      )
      return
    }
    setConflictMessage(null)
    const currentCourse = scheduleData?.courses.find((course) => course.courseId === courseId)
    const previousInChoice = new Set(
      (currentCourse?.groups ?? [])
        .filter((candidate) => choiceKey(candidate) === choiceKey(group))
        .map((candidate) => candidate.groupId),
    )
    setState((prev) => ({
      ...prev,
      selections: {
        ...prev.selections,
        [key]: [...current.filter((id) => !previousInChoice.has(id)), group.groupId],
      },
    }))
  }

  const setTermField = (field: 'year' | 'semester', value: number) => {
    setState((prev) => ({
      ...prev,
      termMapping: {
        ...prev.termMapping,
        [activeSemesterId]: { ...prev.termMapping[activeSemesterId], [field]: value },
      },
    }))
  }

  const runSearch = async () => {
    if (!searchText.trim()) { setSearchResults([]); setSearchError(null); return }
    try {
      const result = await fetchCourseSearchFn(searchText.trim(), term.semester)
      setSearchError(null)
      setSearchResults(result.results)
    } catch {
      setSearchError('החיפוש נכשל. נסו שוב.')
    }
  }

  const blocks: GridBlock[] = allSelectedGroups().flatMap(({ courseId, courseName, group }) =>
    group.slots.map((slot, i) => ({
      key: `${courseId}:${group.groupId}:${i}`,
      courseId, courseName, groupId: group.groupId, kind: group.kind, slot,
    })),
  )

  const courses = scheduleData?.courses ?? []
  const coursesWithAlternatives = courses.filter((course) =>
    groupsByChoice(course.groups).some((choices) => choices.length > 1),
  )

  return (
    <div className="weekly-schedule" dir="rtl">
      <header className="weekly-schedule-header">
        <div>
          <p className="weekly-schedule-eyebrow">תצוגת מערכת</p>
          <h2 className="weekly-schedule-title">מערכת שעות שבועית</h2>
          <p className="weekly-schedule-description">קבוצות יחידות מהלוח נבחרות אוטומטית. בחלופות בוחרים את הקבוצה המתאימה.</p>
        </div>
        <div className="weekly-term-controls" aria-label="מועד לימודים">
          <label>
            <span>שנת לימודים</span>
            <input
              aria-label="שנת לימודים"
              type="number"
              value={term?.year ?? ''}
              onChange={(e) => setTermField('year', Number(e.target.value))}
            />
          </label>
          <label>
            <span>סמסטר</span>
            <select
              aria-label="סמסטר"
              value={term?.semester ?? 1}
              onChange={(e) => setTermField('semester', Number(e.target.value) as 1 | 2)}
            >
              <option value={1}>א׳</option>
              <option value={2}>ב׳</option>
            </select>
          </label>
        </div>
      </header>

      <div role="tablist" aria-label="בחירת סמסטר" className="weekly-semester-tabs">
        {semesterDestinations.map((dest) => (
          <button
            key={dest.id}
            type="button"
            role="tab"
            aria-selected={activeSemesterId === dest.id}
            onClick={() => setActiveSemesterId(dest.id)}
          >
            {dest.label}
          </button>
        ))}
      </div>

      <div className="weekly-schedule-layout">
        <section className="weekly-schedule-grid-panel" aria-label="לוח שעות">
          <WeeklyScheduleGrid blocks={blocks} />
          {fetchError && <p role="alert" className="weekly-schedule-alert">{fetchError}</p>}
          {conflictMessage && <p role="alert" className="weekly-schedule-alert">{conflictMessage}</p>}
          {scheduleData && (
            <p className="weekly-schedule-provenance">מקור: bid-it (לא רשמי) · עודכן {new Date(scheduleData.fetchedAt).toLocaleTimeString('he-IL')}</p>
          )}
        </section>

        <aside className="weekly-group-picker" aria-label="בחירת קבוצות">
          <div className="weekly-group-picker-heading">
            <h3>בחירת קבוצות</h3>
            <span>{coursesWithAlternatives.length} קורסים לבחירה</span>
          </div>
          {courses.filter((course) => course.found && !groupsByChoice(course.groups).some((choices) => choices.length > 1)).map((course) => (
            <p key={course.courseId} className="weekly-auto-course">
              <strong>{course.nameHe ?? course.courseId}</strong>
              <span>נבחר אוטומטית</span>
              {course.cYear !== null && course.cYear !== term.year && (
                <small role="status">נתוני bid-it הם לשנת {course.cYear}</small>
              )}
            </p>
          ))}
          {coursesWithAlternatives.map((course) => (
            <article key={course.courseId} className="weekly-group-course">
              <div>
                <h4>{course.nameHe ?? course.courseId}</h4>
                {course.cYear !== null && course.cYear !== term.year && (
                  <p role="status">נתוני bid-it הם לשנת {course.cYear}, ולא לשנת {term.year} שנבחרה</p>
                )}
              </div>
              {groupsByChoice(course.groups).filter((choices) => choices.length > 1).map((choices) => (
                <fieldset key={choiceKey(choices[0])} className="weekly-group-options">
                  <legend>בחירת {choices[0].teachingMode || choices[0].kind}</legend>
                  {choices.map((group) => {
                    const label = `${course.nameHe ?? course.courseId}, ${groupDescription(group)}`
                    return (
                      <label key={group.groupId} className="weekly-group-option">
                        <input
                          type="radio"
                          name={`${course.courseId}-${choiceKey(group)}`}
                          aria-label={label}
                          checked={persistedGroupIds(course.courseId).includes(group.groupId)}
                          disabled={group.slots.length === 0}
                          onChange={() => chooseGroup(course.courseId, course.nameHe ?? course.courseId, group)}
                        />
                        <span>{groupDescription(group)}</span>
                      </label>
                    )
                  })}
                </fieldset>
              ))}
            </article>
          ))}
          {courses.some((course) => !course.found) && (
            <p className="weekly-missing-data">לחלק מהקורסים אין עדיין נתוני שעות ב־bid-it.</p>
          )}
          {courses.length > 0 && coursesWithAlternatives.length === 0 && (
            <p className="weekly-picker-empty">כל הקבוצות הייחודיות מהלוח כבר מוצגות במערכת.</p>
          )}

          <details className="weekly-search-details">
            <summary>הוספת קורס נוסף לצפייה</summary>
            <div className="weekly-search-controls">
              <input
                type="text"
                placeholder="חיפוש קורס להוספה לצפייה"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
              <button type="button" onClick={runSearch}>חפש</button>
            </div>
            {searchError && <p role="alert" className="weekly-schedule-alert">{searchError}</p>}
            {searchResults.map((result) => (
              <button
                key={result.courseId}
                type="button"
                className="weekly-search-result"
                onClick={() => setExtraCourseIds((previous) => [...new Set([...previous, result.courseId])])}
              >
                הוסף {result.nameHe}
              </button>
            ))}
          </details>
        </aside>
      </div>
    </div>
  )
}
