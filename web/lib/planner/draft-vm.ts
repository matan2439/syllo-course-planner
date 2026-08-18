/**
 * Slice 2 — draft view-model. Resolves the generated proposal's course IDs
 * against the canonical BoardModel.courseCatalog and derives new/moved/unchanged
 * markers from a PLACEMENT-SET diff (base vs generated), never from the response
 * `moves` array. Draft-specific types live here (they are not the read-only
 * BoardVM). Pure/derived: inputs are never mutated.
 */
import { SEMESTER_ORDER } from '../board'
import { fromHalfHours, normalizeCourseId } from '../../../shared/planner/model'
import type { BoardModel, GeneratedPlanModel } from '../../../shared/planner/model'
import { semesterTitleHe } from './board-vm'

export type DraftMarker = 'new' | 'moved' | 'unchanged'

export interface DraftCourseVM {
  /** The generated course id, preserved exactly. */
  id: string
  /** false when the id is absent from courseCatalog (metadata unavailable). */
  resolved: boolean
  nameHe: string | null
  weeklyHours: number | null
  courseType: string | null
  isMandatory: boolean | null
  marker: DraftMarker
}
export interface DraftSemesterVM {
  id: string
  title: string
  courses: DraftCourseVM[]
  /** Authoritative sum ONLY when every course is resolved with known hours. */
  totalWeeklyHours: number | null
  totalComplete: boolean
}
export interface DraftVM {
  semesters: DraftSemesterVM[]
  blocked: boolean
  warningsHe: string[]
  errors: string[]
  /** Structured agent outcome (opt-in path only). Absent on the legacy response. */
  agentOutcome?: GeneratedPlanModel['agentOutcome']
  /** Server Apply-eligibility floor (opt-in path only). Absent on the legacy response. */
  applyEligible?: boolean
  /** Structured clarification items + validation findings (opt-in path only). */
  agentClarificationItems?: GeneratedPlanModel['agentClarificationItems']
  agentValidationFindings?: GeneratedPlanModel['agentValidationFindings']
  /** K9C — gates the grounded question; see GeneratedPlanModel. */
  groundedQuestionImpact?: GeneratedPlanModel['groundedQuestionImpact']
  /** W1 — gates the course content/topic question; see GeneratedPlanModel. */
  topicQuestionImpact?: GeneratedPlanModel['topicQuestionImpact']
  /** M7 — how several confirmed objectives were composed; see GeneratedPlanModel. */
  groundedComposition?: GeneratedPlanModel['groundedComposition']
  /** C1 — selectable validated alternatives; see GeneratedPlanModel. */
  alternatives?: GeneratedPlanModel['alternatives']
  groundedExplanationHe?: GeneratedPlanModel['groundedExplanationHe']
  groundedSources?: GeneratedPlanModel['groundedSources']
  groundedCoverage?: GeneratedPlanModel['groundedCoverage']
  groundedObjective?: GeneratedPlanModel['groundedObjective']
}

/** courseId(normalized) → set of semester ids it is placed in. */
function placementIndex(
  semesters: Array<{ semesterId: string; ids: string[] }>,
): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>()
  for (const { semesterId, ids } of semesters) {
    for (const raw of ids) {
      const id = normalizeCourseId(raw)
      if (!idx.has(id)) idx.set(id, new Set())
      idx.get(id)!.add(semesterId)
    }
  }
  return idx
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

export function buildDraftVM(generated: GeneratedPlanModel, base: BoardModel): DraftVM {
  const basePlacements = placementIndex(
    base.semesters.map((s) => ({ semesterId: s.semesterId, ids: s.courses.map((c) => c.courseId) })),
  )
  const genPlacements = placementIndex(
    generated.semesters.map((s) => ({ semesterId: s.semesterId, ids: s.courseIds })),
  )

  const markerFor = (normId: string): DraftMarker => {
    const baseSet = basePlacements.get(normId)
    if (!baseSet) return 'new'
    return setsEqual(baseSet, genPlacements.get(normId) ?? new Set()) ? 'unchanged' : 'moved'
  }

  const rank = (id: string) => {
    const i = (SEMESTER_ORDER as readonly string[]).indexOf(id)
    return i === -1 ? SEMESTER_ORDER.length : i
  }

  const semesters: DraftSemesterVM[] = [...generated.semesters]
    .sort((a, b) => rank(a.semesterId) - rank(b.semesterId))
    .map((s) => {
      let sumHalfHours = 0
      let complete = true
      const courses: DraftCourseVM[] = s.courseIds.map((rawId) => {
        const meta = base.courseCatalog[normalizeCourseId(rawId)]
        const halfHours = meta?.halfHours ?? null
        if (!meta || halfHours == null) complete = false
        else sumHalfHours += halfHours
        return {
          id: rawId,
          resolved: !!meta, // metadata resolved = id present in courseCatalog
          // nameAvailable is INDEPENDENT of resolved: a real repo course can be
          // in the catalog yet carry name_he: null → '' → exposed here as null so
          // the UI shows a truthful fallback, never a fabricated or blank name.
          nameHe: meta && meta.nameHe ? meta.nameHe : null,
          weeklyHours: halfHours == null ? null : fromHalfHours(halfHours),
          courseType: meta ? meta.courseType : null,
          isMandatory: meta ? meta.isMandatory : null,
          marker: markerFor(normalizeCourseId(rawId)),
        }
      })
      return {
        id: s.semesterId,
        title: semesterTitleHe(s.semesterId),
        courses,
        totalComplete: complete,
        totalWeeklyHours: complete ? fromHalfHours(sumHalfHours) : null,
      }
    })

  return {
    semesters,
    blocked: generated.blocked,
    warningsHe: generated.warningsHe,
    errors: generated.errors,
    ...(generated.agentOutcome ? { agentOutcome: generated.agentOutcome } : {}),
    ...(typeof generated.applyEligible === 'boolean' ? { applyEligible: generated.applyEligible } : {}),
    ...(generated.agentClarificationItems ? { agentClarificationItems: generated.agentClarificationItems } : {}),
    ...(generated.agentValidationFindings ? { agentValidationFindings: generated.agentValidationFindings } : {}),
    // K9C — carried through only when the grounded objective actually applied.
    ...(generated.groundedQuestionImpact ? { groundedQuestionImpact: generated.groundedQuestionImpact } : {}),
    ...(generated.topicQuestionImpact ? { topicQuestionImpact: generated.topicQuestionImpact } : {}),
    ...(generated.groundedComposition ? { groundedComposition: generated.groundedComposition } : {}),
    ...(generated.alternatives?.length ? { alternatives: generated.alternatives } : {}),
    ...(generated.groundedExplanationHe ? { groundedExplanationHe: generated.groundedExplanationHe } : {}),
    ...(generated.groundedSources ? { groundedSources: generated.groundedSources } : {}),
    ...(generated.groundedCoverage ? { groundedCoverage: generated.groundedCoverage } : {}),
    ...(generated.groundedObjective ? { groundedObjective: generated.groundedObjective } : {}),
  }
}
