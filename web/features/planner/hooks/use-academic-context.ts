import { useCallback, useEffect, useRef, useState } from 'react'
import type { LoadedPlanningContext } from '../../../../shared/planner/api-client'
import {
  EMPTY_ACADEMIC_STATUS,
  academicStatusDraftFromPersonalStatus,
  completedCourseIdsOf,
  type AcademicStatusDraft,
} from '../../courses/components/CompletedCoursesPanel'
import type { defaultSendConversation } from '../lib/api-defaults'

/**
 * The student's own academic status and the planning context saved for them
 * (flagged path). Draft state only: editing never touches the committed board
 * and never generates. `confirmed` is what makes the completed set KNOWN — an
 * empty list is otherwise UNKNOWN, never an implicit "none"
 * (academic_status_knowledge.ts).
 */
export function useAcademicContext({
  programId, planningContextFn, sendConversationFn,
}: {
  programId: string
  planningContextFn: (programId: string) => Promise<LoadedPlanningContext | null>
  sendConversationFn: typeof defaultSendConversation
}) {
  const [academicStatus, setAcademicStatus] = useState<AcademicStatusDraft>(EMPTY_ACADEMIC_STATUS)
  const [academicContextPhase, setAcademicContextPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadedAcademicContext, setLoadedAcademicContext] = useState<LoadedPlanningContext | null>(null)
  const academicContextReadVersionRef = useRef(0)
  const [statusVersion, setStatusVersion] = useState(0)
  const acceptedStatusVersionRef = useRef(0)
  const statusVersionRef = useRef(0)

  const updateAcademicStatus = useCallback((next: AcademicStatusDraft) => {
    setAcademicStatus(next)
    statusVersionRef.current += 1
    setStatusVersion((v) => v + 1) // any edit invalidates a proposal built from the old status
  }, [])

  const sendConversationWithPanelStatus: typeof defaultSendConversation = async (request) => {
    const panelChanged = statusVersion > acceptedStatusVersionRef.current && academicStatus.confirmed
    const answers = new Map((request.clarification_answers ?? []).map((answer) => [answer.question_id, answer]))
    if (panelChanged && !answers.has('completed_courses')) {
      answers.set('completed_courses', { question_id: 'completed_courses', value: completedCourseIdsOf(academicStatus) })
    }
    const response = await sendConversationFn({
      ...request,
      ...(answers.size ? { clarification_answers: [...answers.values()] } : {}),
    })
    if (panelChanged && response.outcome !== 'assistant_unavailable') acceptedStatusVersionRef.current = statusVersion
    return response
  }

  useEffect(() => {
    let live = true
    setAcademicContextPhase('loading')
    planningContextFn(programId).then(
      (stored) => {
        if (!live) return
        if (stored) {
          if (statusVersionRef.current === acceptedStatusVersionRef.current) {
            setAcademicStatus(academicStatusDraftFromPersonalStatus(stored.personalStatus, programId))
          }
          setLoadedAcademicContext(stored)
        }
        setAcademicContextPhase('ready')
      },
      (error) => {
        if (!live) return
        console.error('[NativePlannerJourney] academic context load failed:', error)
        setAcademicContextPhase('error')
      },
    )
    return () => { live = false }
  }, [programId, planningContextFn])

  /**
   * The ACADEMIC STATUS both Generate and Apply describe.
   *
   * Apply echoes it so the server can confirm the plan's assumptions still
   * hold — a plan built before the student edited their completed courses must
   * not be committed afterwards. It is one function so the two can never
   * describe the same state differently and produce a spurious mismatch.
   */
  const applyAcademicStatus = useCallback((): Record<string, unknown> => {
    const completedIds = completedCourseIdsOf(academicStatus)
    const status: Record<string, unknown> = {
      completed: completedIds.map((course_id) => ({ course_id })),
      currently_taking: [],
    }
    if (academicStatus.confirmed) {
      status.completed_knowledge = { status: 'known', provenance: 'explicit_user' }
    }
    return status
  }, [academicStatus])

  const refreshAcademicContext = useCallback(() => {
    const readVersion = ++academicContextReadVersionRef.current
    planningContextFn(programId).then((stored) => {
      // A slower read from an earlier turn must not rewind accepted answers or digests.
      if (readVersion !== academicContextReadVersionRef.current) return
      if (stored) {
        setLoadedAcademicContext(stored)
        if (statusVersionRef.current === acceptedStatusVersionRef.current) {
          setAcademicStatus(academicStatusDraftFromPersonalStatus(stored.personalStatus, programId))
        }
      }
    }).catch((error) => {
      console.error('[NativePlannerJourney] academic context refresh failed:', error)
    })
  }, [planningContextFn, programId])

  const handleAcademicContextUpdated = useCallback((update: {
    academic_status_digest: string
    preference_digest: string
  }) => {
    setLoadedAcademicContext((current) => current
      ? {
          ...current,
          academicStatusDigest: update.academic_status_digest,
          preferenceDigest: update.preference_digest,
        }
      : current)
    refreshAcademicContext()
  }, [refreshAcademicContext])

  return {
    academicStatus, updateAcademicStatus, academicContextPhase, loadedAcademicContext, statusVersion,
    applyAcademicStatus, refreshAcademicContext, handleAcademicContextUpdated, sendConversationWithPanelStatus,
  }
}
