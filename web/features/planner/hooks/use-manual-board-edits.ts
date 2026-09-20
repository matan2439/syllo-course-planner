import { useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { BoardModel, GeneratedPlanModel } from '../../../../shared/planner/model'
import type {
  editBoard, GeneratePlanRequest, LoadedPlanningContext, ManualBoardEditResult,
} from '../../../../shared/planner/api-client'
import type { PreferenceProfile } from '../../../../api/ai/preference_model'
import { applyGeneratedToBoard } from '../../../lib/planner/apply-plan'
import { uuidv4 } from '../../../lib/ai-session-token'
import type { defaultEstablishPlanningContext } from '../lib/api-defaults'
import type { ChatMsg, ManualAddIntent } from '../types'

const SAVE_FAILED_HE = 'שמירת העריכה נכשלה. הלוח הנוכחי לא השתנה.'

/**
 * Manual add / move / remove, each one a server-authoritative board edit.
 *
 * The committed board changes only with what the server returns after it
 * accepts the edit; a refusal is shown as-is and leaves the board untouched.
 * Every accepted edit calls `onEditCommitted`, which is what marks an open
 * proposal stale ("the board changed by hand").
 */
export function useManualBoardEdits({
  programId, current, setCurrent, boardVersion, setBoardVersion, manualAddIntent,
  loadedAcademicContext, proposal, buildRequest, convProfileRef, establishPlanningContextFn, editBoardFn,
  showRejectedDrop, showJustPlaced, setMessages, onCommittedCourseIdsChange, onManualAddSettled, onEditCommitted,
}: {
  programId: string
  current: BoardModel | null
  setCurrent: Dispatch<SetStateAction<BoardModel | null>>
  boardVersion: string | null
  setBoardVersion: Dispatch<SetStateAction<string | null>>
  manualAddIntent: ManualAddIntent | null
  loadedAcademicContext: LoadedPlanningContext | null
  proposal: GeneratedPlanModel | null
  buildRequest: (base: BoardModel, profile?: PreferenceProfile) => GeneratePlanRequest
  convProfileRef: MutableRefObject<PreferenceProfile>
  establishPlanningContextFn: typeof defaultEstablishPlanningContext
  editBoardFn: (req: Parameters<typeof editBoard>[1]) => Promise<ManualBoardEditResult>
  showRejectedDrop: (semesterId: string) => void
  showJustPlaced: (semesterId: string) => void
  setMessages: Dispatch<SetStateAction<ChatMsg[]>>
  onCommittedCourseIdsChange?: (courseIds: string[]) => void
  onManualAddSettled?: () => void
  /** Called once per edit the server accepted. */
  onEditCommitted: () => void
}) {
  const [manualEditPhase, setManualEditPhase] = useState<'idle' | 'saving'>('idle')
  const [manualEditError, setManualEditError] = useState<string | null>(null)
  const manualEditKeyRef = useRef<string | null>(null)

  /** The academic-status digest an edit must echo; establishes the context first if none exists yet. */
  const resolveAcademicStatusDigest = async (base: BoardModel): Promise<string> => {
    const known = loadedAcademicContext?.academicStatusDigest ?? proposal?.proposal?.academicStatusDigest
    if (known) return known
    const contextRequest = buildRequest(base, convProfileRef.current ?? undefined)
    const synced = await establishPlanningContextFn({
      program_id: programId,
      plan_context: contextRequest.plan_context as Parameters<typeof establishPlanningContextFn>[0]['plan_context'],
      preferences: contextRequest.preferences as Parameters<typeof establishPlanningContextFn>[0]['preferences'],
    })
    return synced.academicStatusDigest
  }

  /** One key per edit attempt, held until the edit succeeds so a retry is recognised as the same work. */
  const beginEdit = (): string => {
    const operationId = manualEditKeyRef.current ?? `edit_${uuidv4()}`
    manualEditKeyRef.current = operationId
    setManualEditPhase('saving')
    setManualEditError(null)
    return operationId
  }

  const adoptCommittedBoard = (
    base: BoardModel,
    board: { semesters: Array<{ semesterId: string; courseIds: string[] }>; version: string },
    noteHe: string,
  ) => {
    setCurrent(applyGeneratedToBoard({ semesters: board.semesters } as GeneratedPlanModel, base))
    setBoardVersion(board.version)
    onEditCommitted()
    manualEditKeyRef.current = null
    setMessages((items) => [...items, { role: 'system', text: noteHe }])
    onCommittedCourseIdsChange?.(board.semesters.flatMap((semester) => semester.courseIds))
  }

  const commitManualAdd = async (semesterId: string, requestedCourseId?: string) => {
    const courseId = requestedCourseId ?? manualAddIntent?.courseId
    if (!current || !courseId || manualEditPhase === 'saving') return
    const operationId = beginEdit()
    let result: ManualBoardEditResult
    try {
      const academicStatusDigest = await resolveAcademicStatusDigest(current)
      result = await editBoardFn({
        operation: 'add_course', program_id: programId,
        expected_board_version: boardVersion, operation_id: operationId,
        course_id: courseId, semester_id: semesterId,
        academic_status_digest: academicStatusDigest,
      })
    } catch {
      setManualEditPhase('idle')
      setManualEditError(SAVE_FAILED_HE)
      return
    }
    setManualEditPhase('idle')
    if (!result.ok) {
      setManualEditError(result.messageHe)
      showRejectedDrop(semesterId)
      if (result.currentBoardVersion !== undefined) setBoardVersion(result.currentBoardVersion ?? null)
      return
    }
    showJustPlaced(semesterId)
    adoptCommittedBoard(current, result.board, 'הקורס נוסף ללוח לאחר אימות השרת. יש לבנות מחדש כדי לעדכן את הצעת העוזר.')
    onManualAddSettled?.()
  }

  const commitManualRemove = async (courseId: string) => {
    if (!current || manualEditPhase === 'saving') return
    const operationId = beginEdit()
    try {
      const academicStatusDigest = await resolveAcademicStatusDigest(current)
      const result = await editBoardFn({
        operation: 'remove_course', program_id: programId,
        expected_board_version: boardVersion, operation_id: operationId,
        course_id: courseId, academic_status_digest: academicStatusDigest,
      })
      setManualEditPhase('idle')
      if (!result.ok) {
        setManualEditError(result.messageHe)
        if (result.currentBoardVersion !== undefined) setBoardVersion(result.currentBoardVersion ?? null)
        return
      }
      adoptCommittedBoard(current, result.board, 'הקורס הוסר מהלוח לאחר אימות השרת. יש לבנות מחדש כדי לעדכן את הצעת העוזר.')
    } catch {
      setManualEditPhase('idle')
      setManualEditError(SAVE_FAILED_HE)
    }
  }

  const commitManualMove = async (courseId: string, semesterId: string) => {
    if (!current || manualEditPhase === 'saving') return
    const operationId = beginEdit()
    try {
      const academicStatusDigest = await resolveAcademicStatusDigest(current)
      const result = await editBoardFn({
        operation: 'move_course', program_id: programId,
        expected_board_version: boardVersion, operation_id: operationId,
        course_id: courseId, semester_id: semesterId,
        academic_status_digest: academicStatusDigest,
      })
      setManualEditPhase('idle')
      if (!result.ok) {
        setManualEditError(result.messageHe)
        if (result.currentBoardVersion !== undefined) setBoardVersion(result.currentBoardVersion ?? null)
        return
      }
      showJustPlaced(semesterId)
      adoptCommittedBoard(current, result.board, 'הקורס הועבר בלוח לאחר אימות השרת. יש לבנות מחדש כדי לעדכן את הצעת העוזר.')
    } catch {
      setManualEditPhase('idle')
      setManualEditError(SAVE_FAILED_HE)
    }
  }

  return { manualEditPhase, manualEditError, commitManualAdd, commitManualRemove, commitManualMove }
}
