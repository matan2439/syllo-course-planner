/**
 * Slice 17A (part 1) — typed semester-distribution policy + mapping.
 * Maps the confirmed active `semester_balance` preference to a generic policy.
 * Never infers compactness from missing data; anything absent/indifferent/
 * uncertain/unsupported → neutral (preserves the legacy stable-planner default).
 */
import { resolveDistributionPolicy } from '../../api/ai/distribution_policy';
import { effectivePlannerPreferences } from '../../api/ai/preference_eligibility';
import { emptyProfile, upsertPreference, fromExplicitChoice, fromVagueStatement, makePreference } from '../../api/ai/preference_model';

function eff(...prefs: Parameters<typeof upsertPreference>[1][]) {
  let profile = emptyProfile();
  for (const p of prefs) profile = upsertPreference(profile, p);
  return effectivePlannerPreferences(profile);
}
const balanced = fromExplicitChoice({ id: 'semester_balance', category: 'semester_balance', normalized: 'balanced', value: 'balanced', affects: 'balance_score' });
const compact = fromExplicitChoice({ id: 'semester_balance', category: 'semester_balance', normalized: 'compact', value: 'compact', affects: 'balance_score' });

describe('resolveDistributionPolicy', () => {
  test('no preference → neutral (legacy default)', () => {
    expect(resolveDistributionPolicy(eff()).policy).toBe('neutral');
  });

  test('confirmed active balanced → balanced, with source+version provenance', () => {
    const r = resolveDistributionPolicy(eff(balanced));
    expect(r.policy).toBe('balanced');
    expect(r.provenance?.source).toBe('explicit_answer');
    expect(typeof r.provenance?.profileVersion).toBe('number');
  });

  test('confirmed active compact → compact', () => {
    expect(resolveDistributionPolicy(eff(compact)).policy).toBe('compact');
  });

  test('indifferent → neutral (no bias)', () => {
    const indiff = makePreference({ id: 'semester_balance', category: 'semester_balance', normalized: 'no_preference', value: null, classification: 'indifferent', confidence: 1, source: 'explicit_answer', affects: 'balance_score' });
    expect(resolveDistributionPolicy(eff(indiff)).policy).toBe('neutral');
  });

  test('uncertain/unconfirmed vague value → neutral (never infer compactness)', () => {
    const vague = fromVagueStatement({ id: 'semester_balance', category: 'semester_balance', originalWording: 'לא משנה כזה', normalized: 'free_text', affects: 'balance_score' });
    expect(resolveDistributionPolicy(eff(vague)).policy).toBe('neutral');
  });

  test('an unsupported/invalid normalized value → neutral (not compact)', () => {
    const weird = fromExplicitChoice({ id: 'semester_balance', category: 'semester_balance', normalized: 'zigzag', value: 'zigzag', affects: 'balance_score' });
    expect(resolveDistributionPolicy(eff(weird)).policy).toBe('neutral');
  });
});
