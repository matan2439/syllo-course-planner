import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { BoardModel, GeneratedPlanModel } from '../../../../shared/planner/model'
import type { CommittedBoardState } from '../../../../shared/planner/api-client'
import type {
  editBoard, GeneratePlanRequest, LoadedPlanningContext, ManualBoardEditResult,
} from '../../../../shared/planner/api-client'
import type { PreferenceProfile } from '../../../../api/ai/preference_model'
import { applyCommittedBoard } from '../../../lib/planner/apply-plan'
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
  contextVersion, contextReady,
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
  contextVersion: string
  contextReady: boolean
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
  const manualEditKeyRef = useRef<{ identity: string; operationId: string } | null>(null)
  const editInFlightRef = useRef(false)
  const submittedIntentRef = useRef<ManualAddIntent | null>(null)
  const syncedContextRef = useRef<{ version: string; sourceDigest: string | undefined; digest: string } | null>(null)

  /** The academic-status digest an edit must echo; establishes the context first if none exists yet. */
  const resolveAcademicStatusDigest = async (base: BoardModel): Promise<string> => {
    const known = loadedAcademicContext?.academicStatusDigest ?? proposal?.proposal?.academicStatusDigest
    const cached = syncedContextRef.current
    if (cached?.version === contextVersion && cached.sourceDigest === known) return cached.digest
    // A digest loaded before a profile edit describes the old completions and
    // constraints. Publish the student's changed inputs before validating a drop.
    if (known && contextVersion === '0:0') return known
    const contextRequest = buildRequest(base, convProfileRef.current ?? undefined)
    const synced = await establishPlanningContextFn({
      program_id: programId,
      plan_context: contextRequest.plan_context as Parameters<typeof establishPlanningContextFn>[0]['plan_context'],
      preferences: contextRequest.preferences as Parameters<typeof establishPlanningContextFn>[0]['preferences'],
    })
    syncedContextRef.current = { version: contextVersion, sourceDigest: known, digest: synced.academicStatusDigest }
    return synced.academicStatusDigest
  }

  /**
   * One key per edit attempt. It is held across a thrown (network) failure so a retry is recognised as
   * the same work, but dropped on a definitive server rejection: nothing was committed, and reusing the
   * key for the NEXT, different edit makes the server answer IDEMPOTENCY_CONFLICT (409).
   */
  const beginEdit = (operation: string, courseId: string, semesterId?: string): string => {
    const identity = JSON.stringify([programId, boardVersion, contextVersion, operation, courseId, semesterId])
    const operationId = manualEditKeyRef.current?.identity === identity
      ? manualEditKeyRef.current.operationId : `edit_${uuidv4()}`
    manualEditKeyRef.current = { identity, operationId }
    editInFlightRef.current = true
    setManualEditPhase('saving')
    setManualEditError(null)
    return operationId
  }

  const adoptCommittedBoard = (
    base: BoardModel,
    board: CommittedBoardState,
    noteHe: string,
  ) => {
    setCurrent(applyCommittedBoard(board, base))
    setBoardVersion(board.version)
    onEditCommitted()
    manualEditKeyRef.current = null
    setMessages((items) => [...items, { role: 'system', text: noteHe }])
    onCommittedCourseIdsChange?.(board.semesters.flatMap((semester) => semester.courseIds))
  }

  const commitManualAdd = async (semesterId: string, requestedCourseId?: string) => {
    const courseId = requestedCourseId ?? manualAddIntent?.courseId
    if (!current || !courseId || editInFlightRef.current) return
    const operationId = beginEdit('add_course', courseId, semesterId)
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
      editInFlightRef.current = false
      setManualEditPhase('idle')
      setManualEditError(SAVE_FAILED_HE)
      return
    }
    editInFlightRef.current = false
    setManualEditPhase('idle')
    if (!result.ok) {
      manualEditKeyRef.current = null
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
    if (!current || editInFlightRef.current) return
    const operationId = beginEdit('remove_course', courseId)
    try {
      const academicStatusDigest = await resolveAcademicStatusDigest(current)
      const result = await editBoardFn({
        operation: 'remove_course', program_id: programId,
        expected_board_version: boardVersion, operation_id: operationId,
        course_id: courseId, academic_status_digest: academicStatusDigest,
      })
      editInFlightRef.current = false
      setManualEditPhase('idle')
      if (!result.ok) {
        manualEditKeyRef.current = null
        setManualEditError(result.messageHe)
        if (result.currentBoardVersion !== undefined) setBoardVersion(result.currentBoardVersion ?? null)
        return
      }
      adoptCommittedBoard(current, result.board, 'הקורס הוסר מהלוח לאחר אימות השרת. יש לבנות מחדש כדי לעדכן את הצעת העוזר.')
    } catch {
      editInFlightRef.current = false
      setManualEditPhase('idle')
      setManualEditError(SAVE_FAILED_HE)
    }
  }

  const commitManualMove = async (courseId: string, semesterId: string) => {
    if (!current || editInFlightRef.current) return
    const operationId = beginEdit('move_course', courseId, semesterId)
    try {
      const academicStatusDigest = await resolveAcademicStatusDigest(current)
      const result = await editBoardFn({
        operation: 'move_course', program_id: programId,
        expected_board_version: boardVersion, operation_id: operationId,
        course_id: courseId, semester_id: semesterId,
        academic_status_digest: academicStatusDigest,
      })
      editInFlightRef.current = false
      setManualEditPhase('idle')
      if (!result.ok) {
        manualEditKeyRef.current = null
        setManualEditError(result.messageHe)
        showRejectedDrop(semesterId)
        if (result.currentBoardVersion !== undefined) setBoardVersion(result.currentBoardVersion ?? null)
        return
      }
      showJustPlaced(semesterId)
      adoptCommittedBoard(current, result.board, 'הקורס הועבר בלוח לאחר אימות השרת. יש לבנות מחדש כדי לעדכן את הצעת העוזר.')
    } catch {
      editInFlightRef.current = false
      setManualEditPhase('idle')
      setManualEditError(SAVE_FAILED_HE)
    }
  }

  /** Add a semester past the board's own columns, or remove an empty added one. */
  const commitSemesterChange = async (operation: 'add_semester' | 'remove_semester', semesterId: string) => {
    if (!current || editInFlightRef.current) return
    const operationId = beginEdit(operation, '', semesterId)
    try {
      const academicStatusDigest = await resolveAcademicStatusDigest(current)
      const result = await editBoardFn({
        operation, program_id: programId,
        expected_board_version: boardVersion, operation_id: operationId,
        semester_id: semesterId, academic_status_digest: academicStatusDigest,
      })
      editInFlightRef.current = false
      setManualEditPhase('idle')
      if (!result.ok) {
        manualEditKeyRef.current = null
        setManualEditError(result.messageHe)
        if (result.currentBoardVersion !== undefined) setBoardVersion(result.currentBoardVersion ?? null)
        return
      }
      adoptCommittedBoard(current, result.board, operation === 'add_semester'
        ? 'סמסטר נוסף ללוח.' : 'הסמסטר הוסר מהלוח.')
    } catch {
      editInFlightRef.current = false
      setManualEditPhase('idle')
      setManualEditError(SAVE_FAILED_HE)
    }
  }

  // Choosing a destination is the action. A second confirmation adds no
  // information; ask only when multiple semester choices remain. Remember the
  // intent object so rerenders and StrictMode effect replay cannot submit twice.
  useEffect(() => {
    if (!manualAddIntent) { submittedIntentRef.current = null; return }
    if (!current || !contextReady || manualAddIntent.semesterIds.length !== 1 || editInFlightRef.current
      || submittedIntentRef.current === manualAddIntent) return
    submittedIntentRef.current = manualAddIntent
    void commitManualAdd(manualAddIntent.semesterIds[0], manualAddIntent.courseId)
  }, [manualAddIntent, current, manualEditPhase, contextReady])

  return { manualEditPhase, manualEditError, commitManualAdd, commitManualRemove, commitManualMove, commitSemesterChange }
}
