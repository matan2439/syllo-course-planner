import { useEffect, useState } from 'react'
import type { BoardModel, GeneratedPlanModel } from '../../../../shared/planner/model'
import type { CommittedBoardState } from '../../../../shared/planner/api-client'
import { applyCommittedBoard } from '../../../lib/planner/apply-plan'
import type { BoardPhase } from '../types'

type SemesterCourseIds = Array<{ semesterId: string; courseIds: string[] }>

/**
 * The board the student is looking at: the program CATALOG merged with this
 * session's COMMITTED board, plus the server's version of that committed board.
 * Also tells the parent which courses/semesters are on the board.
 */
export function useCommittedBoard({
  programId, getBoardFn, committedBoardFn, serverApply, onCommittedCourseIdsChange, onSemestersChange,
}: {
  programId: string
  getBoardFn: (programId: string) => Promise<BoardModel>
  committedBoardFn: (programId: string) => Promise<CommittedBoardState | null>
  serverApply: boolean
  onCommittedCourseIdsChange?: (courseIds: string[]) => void
  onSemestersChange?: (semesters: SemesterCourseIds) => void
}) {
  const [boardPhase, setBoardPhase] = useState<BoardPhase>('loading')
  const [current, setCurrent] = useState<BoardModel | null>(null)
  /**
   * S5 — the server's version of the committed board. `null` means this session
   * has never applied one, which is a legitimate expected value for a first
   * Apply rather than a missing field.
   */
  const [boardVersion, setBoardVersion] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setBoardPhase('loading')
    // The CATALOG is program data (course universe, names, hours); the
    // COMMITTED board is this session's own state. Both are needed, and only
    // the second is user data — so a failure to read it must not hide the
    // catalog, but it must also never be replaced by a silent default.
    const committed = serverApply ? committedBoardFn(programId).catch((e) => {
      console.error('[NativePlannerJourney] committed board load failed:', e)
      return null
    }) : Promise.resolve(null)

    Promise.all([getBoardFn(programId), committed]).then(
      ([catalog, saved]) => {
        if (!live) return
        setCurrent(saved ? applyCommittedBoard(saved, catalog) : catalog)
        setBoardVersion(saved?.version ?? null)
        setBoardPhase('ready')
      },
      (e) => { if (live) { console.error('[NativePlannerJourney] board load failed:', e); setBoardPhase('error') } },
    )
    return () => { live = false }
  }, [programId, getBoardFn, committedBoardFn, serverApply])

  useEffect(() => {
    if (!current) return
    onCommittedCourseIdsChange?.([...new Set(current.semesters.flatMap((semester) =>
      semester.courses.map((course) => course.courseId)))])
  }, [current, onCommittedCourseIdsChange])

  useEffect(() => {
    if (!current) return
    onSemestersChange?.(current.semesters.map((semester) => ({
      semesterId: semester.semesterId,
      courseIds: semester.courses.map((course) => course.courseId),
    })))
  }, [current, onSemestersChange])

  return { boardPhase, current, setCurrent, boardVersion, setBoardVersion }
}
