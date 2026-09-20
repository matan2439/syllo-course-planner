import { useEffect, useRef, type MutableRefObject } from 'react'
import type { BoardModel } from '../../../../shared/planner/model'
import type {
  establishPlanningContext, GeneratePlanRequest, LoadedPlanningContext,
} from '../../../../shared/planner/api-client'
import type { PreferenceProfile } from '../../../../api/ai/preference_model'
import type { defaultEstablishPlanningContext } from '../lib/api-defaults'

/**
 * On first load the production workspace may establish an explicitly-unknown
 * planning context (once), so the assistant has something to converse against.
 */
export function useInitialPlanningContext({
  enabled, useAcademicDecisionAgent, current, academicContextPhase, loadedAcademicContext, buildRequest,
  convProfileRef, establishPlanningContextFn, programId, refreshAcademicContext,
}: {
  enabled: boolean
  useAcademicDecisionAgent: boolean
  current: BoardModel | null
  academicContextPhase: 'loading' | 'ready' | 'error'
  loadedAcademicContext: LoadedPlanningContext | null
  buildRequest: (base: BoardModel, profile?: PreferenceProfile) => GeneratePlanRequest
  convProfileRef: MutableRefObject<PreferenceProfile>
  establishPlanningContextFn: typeof defaultEstablishPlanningContext
  programId: string
  refreshAcademicContext: () => void
}) {
  const initializedPlanningContextRef = useRef(false)
  useEffect(() => {
    if (!enabled || !useAcademicDecisionAgent || !current
      || academicContextPhase !== 'ready' || loadedAcademicContext || initializedPlanningContextRef.current) return
    initializedPlanningContextRef.current = true
    const contextRequest = buildRequest(current, convProfileRef.current ?? undefined)
    establishPlanningContextFn({
      program_id: programId,
      plan_context: contextRequest.plan_context as Parameters<typeof establishPlanningContext>[1]['plan_context'],
      preferences: contextRequest.preferences as Parameters<typeof establishPlanningContext>[1]['preferences'],
    }).then(() => refreshAcademicContext()).catch((error) => {
      console.error('[NativePlannerJourney] initial academic context setup failed:', error)
    })
  }, [academicContextPhase, buildRequest, current, establishPlanningContextFn, enabled,
    loadedAcademicContext, programId, refreshAcademicContext, useAcademicDecisionAgent])
}
