/**
 * isProposalApplyable — the single native Apply gate. Backward-compatible with
 * the legacy (flag-off) response (no agent outcome → gate on blocked/errors/stale
 * only), and additionally blocks Apply for any non-'proposal' structured agent
 * outcome (clarification_required / validation_failed / error) even when the plan
 * itself carries no blocking gate error.
 */
import { isProposalApplyable } from './apply-eligibility'
import type { GeneratedPlanModel } from '../../../shared/planner/model'

function proposal(over: Partial<GeneratedPlanModel> = {}): GeneratedPlanModel {
  return { semesters: [], moves: [], warningsHe: [], errors: [], blocked: false, ...over }
}

describe('isProposalApplyable', () => {
  test('legacy proposal (no agent fields), clean & fresh → applyable', () => {
    expect(isProposalApplyable(proposal(), false)).toBe(true)
  })

  test('stale draft is never applyable', () => {
    expect(isProposalApplyable(proposal(), true)).toBe(false)
  })

  test('blocked draft is never applyable', () => {
    expect(isProposalApplyable(proposal({ blocked: true }), false)).toBe(false)
  })

  test('errored draft is never applyable', () => {
    expect(isProposalApplyable(proposal({ errors: ['x'] }), false)).toBe(false)
  })

  test('agent proposal outcome + applyEligible true → applyable', () => {
    expect(isProposalApplyable(proposal({ agentOutcome: 'proposal', applyEligible: true }), false)).toBe(true)
  })

  test.each(['clarification_required', 'validation_failed', 'error'] as const)(
    'agent %s outcome (applyEligible false) → NOT applyable even with no blocking error',
    (agentOutcome) => {
      expect(isProposalApplyable(proposal({ agentOutcome, applyEligible: false }), false)).toBe(false)
    },
  )

  // Slice 14 — profile-version staleness enforced at the Apply boundary.
  test('a proposal whose profile version matches the current draft profile is applyable', () => {
    const p = proposal({ agentOutcome: 'proposal', applyEligible: true, profileVersion: 5 })
    expect(isProposalApplyable(p, false, { currentProfileVersion: 5 })).toBe(true)
  })

  test('a proposal built from an OLDER profile version is rejected at the Apply boundary', () => {
    const p = proposal({ agentOutcome: 'proposal', applyEligible: true, profileVersion: 5 })
    expect(isProposalApplyable(p, false, { currentProfileVersion: 6 })).toBe(false)
  })

  test('a flagged proposal LACKING version evidence is rejected when a profile version is in play', () => {
    const p = proposal({ agentOutcome: 'proposal', applyEligible: true }) // no profileVersion
    expect(isProposalApplyable(p, false, { currentProfileVersion: 6 })).toBe(false)
  })

  test('legacy proposal (no agent outcome) is unaffected by profile version', () => {
    expect(isProposalApplyable(proposal(), false, { currentProfileVersion: 6 })).toBe(true)
  })
})
