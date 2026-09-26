import type { BoardModel } from '../../../../shared/planner/model'
import type { GeneratePlanRequest } from '../../../../shared/planner/api-client'
import { earlyYearHoursById } from '../../../../shared/planner/early_year_courses'
import type { PreferenceProfile } from '../../../../api/ai/preference_model'
import { getAiSessionToken } from '../../../lib/ai-session-token'
import { completedCourseIdsOf, type AcademicStatusDraft } from '../../courses/components/CompletedCoursesPanel'

/** Everything the student has entered that a planning-context request is made from. */
export interface BuildRequestInputs {
  maxHours: string
  priorHours: string
  /** Category id → completed-but-unnamed course count (see usePlannerInputs). */
  completedCategoryCounts?: Record<string, number>
  wantIds: string[]
  excludeIds: string[]
  exclusionsNoneConfirmed: boolean
  programId: string
  academicStatus: AcademicStatusDraft
  catalogHoursById: Record<string, number | null | undefined>
  /** The academic status Generate and Apply both describe (see applyAcademicStatus). */
  applyAcademicStatus: () => Record<string, unknown>
}

/** The planning-context request (plan_context + preferences) for the current board and inputs. Pure. */
export function buildGeneratePlanRequest(
  base: BoardModel,
  profile: PreferenceProfile | undefined,
  {
    maxHours, priorHours, wantIds, excludeIds, exclusionsNoneConfirmed, programId,
    academicStatus, catalogHoursById, applyAcademicStatus, completedCategoryCounts = {},
  }: BuildRequestInputs,
): GeneratePlanRequest {
  const preferences: Record<string, unknown> = {}
  const hrs = Number(maxHours)
  if (maxHours.trim() && Number.isFinite(hrs)) preferences.max_weekly_hours = hrs
  if (wantIds.length) preferences.wanted_course_ids = wantIds
  if (excludeIds.length) preferences.disallowed_course_ids = excludeIds
  // An explicit "no courses to avoid" is a real answer, so send the key as [] to distinguish it from
  // "never asked" (absent).
  else if (exclusionsNoneConfirmed) preferences.disallowed_course_ids = []
  // Completed courses are ACADEMIC STATE (never a preference). Ids come only
  // from what the student explicitly reported — never derived from an hours
  // total — and the knowledge marker is attached only once they confirmed.
  const personalStatus: Record<string, unknown> = { ...applyAcademicStatus(), planned: [] }
  const planContext: Record<string, unknown> = {
    semesters: base.semesters.map((s) => ({
      id: s.semesterId,
      courses: s.courses.map((c) => ({ course_id: c.courseId })),
    })),
    personal_status: personalStatus,
  }
  const counts = Object.fromEntries(Object.entries(completedCategoryCounts).filter(([, n]) => n > 0))
  if (Object.keys(counts).length) planContext.completed_category_counts = counts
  const completedIds = completedCourseIdsOf(academicStatus)
  const earlyYearHours = earlyYearHoursById(programId)
  const identifiedCompletedHours = completedIds.reduce((sum, id) => {
    const hours = earlyYearHours[id] ?? catalogHoursById[id]
    return sum + (typeof hours === 'number' && Number.isFinite(hours) ? hours : 0)
  }, 0)
  const enteredPriorHours = Number(priorHours)
  if (completedIds.length > 0 || (priorHours.trim() && Number.isFinite(enteredPriorHours))) {
    planContext.total_hours_progress = {
      known_completed_hours: Math.max(
        identifiedCompletedHours,
        priorHours.trim() && Number.isFinite(enteredPriorHours) ? enteredPriorHours : 0,
      ),
    }
  }
  return {
    program_id: programId,
    plan_context: planContext,
    preferences,
    session_token: getAiSessionToken(),
    // Interpret the free-text conversation into structured planner intent so
    // it measurably affects the plan (not just the LLM prompt). Additive.
    interpret_free_text: true,
    use_academic_decision_agent: true,
    // The typed preference profile (source of truth), never the transcript. The server eligibility
    // filter decides which preferences may reach planning.
    ...(profile
      ? {
          preference_profile: {
            version: profile.version,
            preferences: profile.preferences.map((p) => ({
              id: p.id, category: p.category, normalized: p.normalized, value: p.value,
              classification: p.classification, confidence: p.confidence, source: p.source,
              confirmationStatus: p.confirmationStatus, affects: p.affects,
              mayAffectPlanningBeforeConfirmation: p.mayAffectPlanningBeforeConfirmation,
            })),
          },
        }
      : {}),
  }
}
