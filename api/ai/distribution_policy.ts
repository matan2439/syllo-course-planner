/**
 * distribution_policy.ts — maps the confirmed active `semester_balance`
 * preference to a generic, program-agnostic semester-distribution policy
 * (Slice 17A, part 1: the typed policy + mapping).
 *
 * Three semantic states:
 *   - balanced — prefer lower peak / lower spread (the current stable metric);
 *   - compact  — prefer consolidation / fewer active periods (order-invariant);
 *   - neutral  — preserve the legacy stable-planner default.
 *
 * Mapping is deterministic and cautious: only a CONFIRMED ACTIVE preference whose
 * normalized value is exactly 'balanced' or 'compact' maps to that policy.
 * Anything absent / indifferent / uncertain / unconfirmed / unsupported / invalid
 * → neutral. Compactness is NEVER inferred from missing data. Source + profile
 * version are preserved as explanatory provenance, but provenance never changes
 * academic legality.
 *
 * NOTE: this is the preference→policy mapping only. The stable planner's scoring
 * consumption of the policy is a separate change; `neutral` is defined so the
 * legacy default is unaffected until that consumption lands.
 */
import type { EffectivePlannerPreferences } from './preference_eligibility';

export type DistributionPolicy = 'balanced' | 'compact' | 'neutral';

export interface DistributionPolicyResult {
  policy: DistributionPolicy;
  /** Present only when a real confirmed active preference drove a non-neutral policy. */
  provenance?: {
    preferenceId: string;
    source: string;
    profileVersion: number;
  };
}

/** The planner knob a semester-distribution preference influences. */
const BALANCE_AFFECTS = 'balance_score';
const BALANCE_CATEGORY = 'semester_balance';

export function resolveDistributionPolicy(effective: EffectivePlannerPreferences): DistributionPolicyResult {
  // Only ACTIVE (hard/soft) preferences are eligible; excluded (indifferent/
  // uncertain/unconfirmed) ones never reach here, so they can't impose a policy.
  const active = [...effective.hard, ...effective.soft];
  const pref = active.find((p) => p.affects === BALANCE_AFFECTS || p.category === BALANCE_CATEGORY);
  if (!pref) return { policy: 'neutral' };

  const value = String(pref.normalized);
  if (value !== 'balanced' && value !== 'compact') {
    // free_text / unsupported / invalid → do not infer; stay neutral.
    return { policy: 'neutral' };
  }
  return {
    policy: value,
    provenance: {
      preferenceId: pref.id,
      source: pref.source,
      profileVersion: effective.profileVersion,
    },
  };
}
