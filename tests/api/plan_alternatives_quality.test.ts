import { buildPlanAlternatives, qualityOf } from '../../api/ai/plan_alternatives'
import type { PlanCandidate } from '../../api/ai/candidate_set'
import type { ConstraintModel, PlanState } from '../../api/ai/planner_types'
import type { PrerequisiteCatalog } from '../../api/ai/prerequisites'

const SEMS = ['s1', 's2']
const c = (course: string) => ({ course })
const catalog: PrerequisiteCatalog = {
  BASE: { status: 'verified_none', expression: null, corequisites: null },
  ADV: { status: 'verified', expression: c('BASE'), corequisites: null },
  ROBO: { status: 'verified', expression: c('BASE'), corequisites: null },
  GUESS: { status: 'none_listed', expression: null, corequisites: null },
}
const profile = (id: string, hours = 4) => ({ course_id: id, name_he: `קורס ${id}`, hours }) as never
const model = (fit?: Record<string, number>): ConstraintModel => ({
  profiles: new Map(['BASE', 'ADV', 'ROBO', 'GUESS'].map((id) => [id, profile(id)])),
  knownSemesterIds: SEMS, completedCourseIds: new Set(), requiredMandatoryCourseIds: [], categories: [],
  degreeRequiredHours: 12, priorHours: 0, maxHoursPerSemester: 22, hardCap: 26,
  disallowedCourseIds: new Set(), pinnedCourseIds: new Set(), wantedCourseIds: new Set(),
  ...(fit ? { courseFitById: new Map(Object.entries(fit)) } : {}),
}) as unknown as ConstraintModel
const cand = (id: string, rank: number, semesters: PlanState['semesters']): PlanCandidate => ({
  id, policy: 'neutral', state: { semesters }, valid: true, validationErrors: [], scoreVector: [], normalizedIdentity: id, rank,
  provenance: 'test', differences: [], profileVersion: 1, rationaleHe: '', nonDominated: true, objectiveScores: [], composedUtility: 0,
}) as unknown as PlanCandidate

const recommended = cand('rec', 0, { s1: ['BASE'], s2: ['ADV', 'GUESS'] })       // ready, no focus
const robotics = cand('rob', 1, { s1: ['ROBO'], s2: ['BASE', 'GUESS'] })          // ROBO before its prerequisite

const build = (m: ConstraintModel) => buildPlanAlternatives({
  candidates: [recommended, robotics], selectedId: 'rec', model: m, constraintFingerprint: 'f', snapshotId: 's',
  profileVersion: 1, objectiveIds: [], prerequisiteCatalog: catalog,
})

describe('alternative quality differences are derived from held data only', () => {
  test('specialization is reported only when an interest was stated, and counts focus courses', () => {
    const withFit = build(model({ ROBO: 1 }))
    const alt = withFit.find((a) => a.candidateId === 'rob')!
    expect(alt.quality.specialization).toEqual({ focusCourses: 1, focusHours: 4 })
    expect(alt.differences.find((d) => d.kind === 'specialization')?.textHe).toContain('1 קורסים')
    const noFit = build(model()).find((a) => a.candidateId === 'rob')!
    expect(noFit.quality.specialization).toBeNull()                  // not applicable — never a fake zero
    expect(noFit.differences.some((d) => d.kind === 'specialization')).toBe(false)
  })

  test('a placement before its verified prerequisite shows as a WARNING difference, never as blocking', () => {
    const alt = build(model()).find((a) => a.candidateId === 'rob')!
    expect(alt.quality.prerequisites.verifiedWarnings).toBe(1)
    const diff = alt.differences.find((d) => d.kind === 'prerequisite_warnings')!
    expect(diff.textHe).toMatch(/אזהרה בלבד, לא חסימה/)
    expect(alt.applyable).toBe(true)
  })

  test('single-source / assumed prerequisite data is counted as unverified, not as verified-none', () => {
    expect(qualityOf(robotics, model(), catalog).prerequisites.unverifiedCourses).toBe(1)
  })

  test('identical quality produces no quality difference rows', () => {
    const twin = cand('twin', 1, { s1: ['BASE'], s2: ['GUESS', 'ROBO'] })
    const m = model()
    const out = buildPlanAlternatives({ candidates: [recommended, twin], selectedId: 'rec', model: m, constraintFingerprint: 'f', snapshotId: 's', profileVersion: 1, objectiveIds: [], prerequisiteCatalog: catalog })
    const diffs = out.find((a) => a.candidateId === 'twin')!.differences
    expect(diffs.some((d) => d.kind === 'prerequisite_warnings')).toBe(false)
  })

  test('progress difference states hours against the requirement', () => {
    const alt = build(model()).find((a) => a.candidateId === 'rob')!
    expect(alt.quality.progress).toEqual({ degreeHours: 12, requiredHours: 12 })
  })
})
