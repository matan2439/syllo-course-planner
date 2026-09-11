'use client'

import { useEffect, useMemo, useState, type RefObject } from 'react'
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

export default function WeeklyScheduleDrawer({
  programId,
  semesterDestinations,
  semesterCourses,
  onClose,
  closeRef,
  fetchScheduleGroupsFn = fetchScheduleGroups,
  fetchCourseSearchFn = fetchCourseSearch,
}: {
  programId: string
  semesterDestinations: readonly SemesterDestination[]
  semesterCourses: readonly SemesterCourses[]
  onClose: () => void
  closeRef: RefObject<HTMLButtonElement | null>
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
  }, [activeSemesterId])

  useEffect(() => {
    let live = true
    if (candidateCourseIds.length === 0) {
      setScheduleData({ semester: term.semester, courses: [], source: 'bidit', fetchedAt: new Date().toISOString() })
      return
    }
    fetchScheduleGroupsFn(candidateCourseIds, term.semester).then(
      (data) => { if (live) setScheduleData(data) },
      () => { if (live) setScheduleData(null) },
    )
    return () => { live = false }
    // candidateCourseIds is intentionally omitted — candidateCourseIdsKey
    // captures its content, and the array itself is read via closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateCourseIdsKey, term.semester, fetchScheduleGroupsFn])

  const selectedGroupIds = (courseId: string): string[] =>
    state.selections[selectionKey(courseId, term)] ?? []

  const allSelectedGroups = (): Array<{ courseId: string; courseName: string; group: ScheduleGroup }> => {
    if (!scheduleData) return []
    const result: Array<{ courseId: string; courseName: string; group: ScheduleGroup }> = []
    for (const course of scheduleData.courses) {
      for (const groupId of selectedGroupIds(course.courseId)) {
        const group = course.groups.find((g) => g.groupId === groupId)
        if (group) result.push({ courseId: course.courseId, courseName: course.nameHe ?? course.courseId, group })
      }
    }
    return result
  }

  useEffect(() => {
    if (!scheduleData) return

    const accepted: Array<{ courseId: string; courseName: string; group: ScheduleGroup }> = []
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
      const selectedIds = state.selections[key] ?? []
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

  const toggleGroup = (courseId: string, courseName: string, group: ScheduleGroup) => {
    const key = selectionKey(courseId, term)
    const current = state.selections[key] ?? []
    const isSelected = current.includes(group.groupId)

    if (isSelected) {
      setState((prev) => ({ ...prev, selections: { ...prev.selections, [key]: current.filter((id) => id !== group.groupId) } }))
      setConflictMessage(null)
      return
    }

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
    setState((prev) => ({ ...prev, selections: { ...prev.selections, [key]: [...current, group.groupId] } }))
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
    if (!searchText.trim()) { setSearchResults([]); return }
    const result = await fetchCourseSearchFn(searchText.trim(), term.semester)
    setSearchResults(result.results)
  }

  const blocks: GridBlock[] = allSelectedGroups().flatMap(({ courseId, courseName, group }) =>
    group.slots.map((slot, i) => ({
      key: `${courseId}:${group.groupId}:${i}`,
      courseId, courseName, groupId: group.groupId, kind: group.kind, slot,
    })),
  )

  return (
    <div>
      <div role="tablist" aria-label="בחירת סמסטר">
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

      <div>
        <label>
          שנה
          <input
            type="number"
            value={term?.year ?? ''}
            onChange={(e) => setTermField('year', Number(e.target.value))}
          />
        </label>
        <label>
          סמסטר
          <select
            value={term?.semester ?? 1}
            onChange={(e) => setTermField('semester', Number(e.target.value) as 1 | 2)}
          >
            <option value={1}>א׳</option>
            <option value={2}>ב׳</option>
          </select>
        </label>
      </div>

      <div>
        <input
          type="text"
          placeholder="חיפוש קורס להוספה לצפייה"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <button type="button" onClick={runSearch}>חפש</button>
        {searchResults.map((r) => (
          <button
            key={r.courseId}
            type="button"
            onClick={() => setExtraCourseIds((prev) => [...new Set([...prev, r.courseId])])}
          >
            הוסף {r.nameHe}
          </button>
        ))}
      </div>

      {conflictMessage && <p role="alert">{conflictMessage}</p>}

      <WeeklyScheduleGrid blocks={blocks} />

      <ul>
        {(scheduleData?.courses ?? []).map((course) => (
          <li key={course.courseId}>
            <span>{course.nameHe ?? course.courseId}</span>
            {course.cYear !== null && course.cYear !== term.year && (
              <span role="status">
                {' '}נתוני bid-it הם לשנת {course.cYear}, ולא לשנת {term.year} שנבחרה
              </span>
            )}
            {!course.found && <span> אין נתוני שעות</span>}
            {course.found && course.incompleteData && <span> נתוני שעות חלקיים</span>}
            {course.found && course.groups.map((group) => {
              const slot = group.slots[0]
              const label = slot
                ? `${course.nameHe ?? course.courseId}, ${group.kind}, יום ${slot.day}, ${slot.start}-${slot.end}`
                : `${course.nameHe ?? course.courseId}, ${group.kind}, אין נתוני שעות`
              return (
                <label key={group.groupId}>
                  <input
                    type="checkbox"
                    aria-label={label}
                    checked={selectedGroupIds(course.courseId).includes(group.groupId)}
                    disabled={group.slots.length === 0}
                    onChange={() => toggleGroup(course.courseId, course.nameHe ?? course.courseId, group)}
                  />
                  {label}
                </label>
              )
            })}
          </li>
        ))}
      </ul>

      {scheduleData && (
        <p>מקור: bid-it (לא רשמי) · עודכן {new Date(scheduleData.fetchedAt).toLocaleTimeString('he-IL')}</p>
      )}

      <button ref={closeRef} type="button" onClick={onClose}>סגור מערכת שעות</button>
    </div>
  )
}
