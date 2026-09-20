import type { BoardModel, GeneratedPlanModel } from '../../../../shared/planner/model'
import { proposalBaseRevision } from '../../../../shared/planner/model'
import { computeStaleReason, type StaleInputs } from './stale-reason'

const board = (catalogRevision: string) => ({ catalogRevision } as unknown as BoardModel)

// A proposal that is fresh on every axis; each test breaks exactly one.
const fresh = (over: Partial<StaleInputs> = {}): StaleInputs => ({
  genPhase: 'done',
  capturedRev: proposalBaseRevision('rev-1'),
  current: board('rev-1'),
  capturedStatusVersion: 2,
  statusVersion: 2,
  capturedPreferenceVersion: 3,
  preferenceVersion: 3,
  useAcademicDecisionAgent: false,
  proposal: null,
  convProfileVersion: undefined,
  capturedManualRevision: 1,
  manualRevision: 1,
  ...over,
})

describe('computeStaleReason', () => {
  it('is null when nothing changed, and before a proposal exists', () => {
    expect(computeStaleReason(fresh())).toBeNull()
    expect(computeStaleReason(fresh({ genPhase: 'idle', manualRevision: 9 }))).toBeNull()
  })

  it('names the real cause of staleness', () => {
    expect(computeStaleReason(fresh({ current: board('rev-2') }))).toBe('catalog')
    expect(computeStaleReason(fresh({ statusVersion: 3 }))).toBe('status')
    expect(computeStaleReason(fresh({ preferenceVersion: 4 }))).toBe('preferences')
    expect(computeStaleReason(fresh({ manualRevision: 2 }))).toBe('manual')
  })

  it('treats an advanced typed-profile version as a preference change only on the agent path', () => {
    const proposal = { profileVersion: 1 } as GeneratedPlanModel
    const stale = { proposal, convProfileVersion: 2 }
    expect(computeStaleReason(fresh({ ...stale, useAcademicDecisionAgent: true }))).toBe('preferences')
    expect(computeStaleReason(fresh({ ...stale, useAcademicDecisionAgent: false }))).toBeNull()
  })

  it('reports the catalog first when several things changed', () => {
    expect(computeStaleReason(fresh({ current: board('rev-2'), statusVersion: 3, manualRevision: 2 }))).toBe('catalog')
  })
})
