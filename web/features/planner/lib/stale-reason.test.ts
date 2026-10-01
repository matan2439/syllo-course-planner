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
  proposal: null,
  convProfileVersion: undefined,
  capturedManualRevision: 1,
  manualRevision: 1,
  boardVersion: 'bv_1',
  boardSyncing: false,
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

  it('treats an advanced typed-profile version as a preference change', () => {
    const proposal = { profileVersion: 1 } as GeneratedPlanModel
    expect(computeStaleReason(fresh({ proposal, convProfileVersion: 2 }))).toBe('preferences')
  })

  it('flags a proposal planned on a board this tab no longer holds, but not while it catches up', () => {
    const planned = (base: string | null) => ({ proposal: { baseBoardVersion: base } }) as GeneratedPlanModel
    expect(computeStaleReason(fresh({ proposal: planned('bv_1') }))).toBeNull()
    expect(computeStaleReason(fresh({ proposal: planned('bv_2') }))).toBe('board')
    expect(computeStaleReason(fresh({ proposal: planned('bv_2'), boardSyncing: true }))).toBeNull()
  })

  it('reports the catalog first when several things changed', () => {
    expect(computeStaleReason(fresh({ current: board('rev-2'), statusVersion: 3, manualRevision: 2 }))).toBe('catalog')
  })
})
