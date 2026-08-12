/**
 * Slice 14 — server-side eligibility filter (classification filtering BEFORE
 * planning). The typed PreferenceProfile is the source of truth; this decides
 * which preferences may reach the planner and how, and returns deterministic
 * validation info (never silently drops an ineligible one).
 */
import { effectivePlannerPreferences } from '../../api/ai/preference_eligibility';
import { emptyProfile, upsertPreference, fromExplicitChoice, fromVagueStatement, makePreference, confirmPreference } from '../../api/ai/preference_model';

describe('effectivePlannerPreferences', () => {
  test('a confirmed HARD constraint may affect legality (hard bucket)', () => {
    let profile = emptyProfile();
    const hard = confirmPreference(fromVagueStatement({ id: 'no_fri', category: 'free_days', originalWording: 'לא שישי', normalized: 'free_friday', affects: 'schedule_shape' }), { as: 'hard_constraint' });
    profile = upsertPreference(profile, hard);
    const r = effectivePlannerPreferences(profile);
    expect(r.hard.map((p) => p.id)).toEqual(['no_fri']);
    expect(r.soft).toEqual([]);
    expect(r.profileVersion).toBe(profile.version);
  });

  test('a confirmed SOFT preference and a GOAL affect ranking only (soft bucket)', () => {
    let profile = emptyProfile();
    profile = upsertPreference(profile, fromExplicitChoice({ id: 'bal', category: 'semester_balance', normalized: 'balanced', value: 'balanced', affects: 'balance_score' }));
    profile = upsertPreference(profile, makePreference({ id: 'grad', category: 'degree_length', normalized: 'finish_fast', value: true, classification: 'goal', confidence: 0.9, source: 'explicit_answer', affects: 'completion_pace' }));
    const r = effectivePlannerPreferences(profile);
    expect(r.soft.map((p) => p.id).sort()).toEqual(['bal', 'grad']);
    expect(r.hard).toEqual([]);
  });

  test('uncertain/unconfirmed interpretations are EXCLUDED with a reason (not silently dropped)', () => {
    let profile = emptyProfile();
    profile = upsertPreference(profile, fromVagueStatement({ id: 'load', category: 'workload', originalWording: 'לא עמוס', normalized: 'low_load', affects: 'max_weekly_hours' }));
    const r = effectivePlannerPreferences(profile);
    expect(r.hard).toEqual([]);
    expect(r.soft).toEqual([]);
    expect(r.excluded.map((e) => e.id)).toEqual(['load']);
    expect(r.excluded[0].reason).toMatch(/uncertain|unconfirmed/i);
  });

  test('indifferent is excluded (no bias) with an explicit reason', () => {
    let profile = emptyProfile();
    profile = upsertPreference(profile, makePreference({ id: 't', category: 'time_of_day', normalized: 'no_time_preference', value: null, classification: 'indifferent', confidence: 1, source: 'explicit_answer', affects: 'schedule_shape' }));
    const r = effectivePlannerPreferences(profile);
    expect(r.excluded.map((e) => e.id)).toEqual(['t']);
    expect(r.excluded[0].reason).toMatch(/indifferent|אדיש|ניטרלי/i);
  });

  test('explicit vs safe-default sources remain distinguishable in the effective set', () => {
    let profile = emptyProfile();
    profile = upsertPreference(profile, fromExplicitChoice({ id: 'explicit', category: 'workload', normalized: 'light', value: 'light', affects: 'max_weekly_hours' }));
    profile = upsertPreference(profile, makePreference({ id: 'defaulted', category: 'semester_balance', normalized: 'balanced', value: 'balanced', classification: 'soft_preference', confidence: 0.5, source: 'safe_default', affects: 'balance_score' }));
    const r = effectivePlannerPreferences(profile);
    expect(r.soft.find((p) => p.id === 'explicit')!.source).toBe('explicit_answer');
    expect(r.soft.find((p) => p.id === 'defaulted')!.source).toBe('safe_default');
  });
});
