/**
 * Slice 10 — generic typed elicited-preference model.
 *
 * Program/institution-agnostic: `category`, `affects`, and `value` are open
 * strings/unknowns, never a fixed TAU/ME enum. The invariant under test is the
 * product rule "do not convert vague statements directly into hard constraints".
 */
import {
  makePreference,
  fromExplicitChoice,
  fromVagueStatement,
  confirmPreference,
  emptyProfile,
  upsertPreference,
  activePreferences,
  type Preference,
} from '../../api/ai/preference_model';

describe('preference model — construction & classification', () => {
  test('a preference carries the full typed shape', () => {
    const p = makePreference({
      id: 'workload_target', category: 'workload', normalized: 'weekly_hours_target',
      value: 25, classification: 'soft_preference', confidence: 0.9,
      source: 'explicit_answer', affects: 'max_weekly_hours',
    });
    expect(p).toMatchObject({
      id: 'workload_target', category: 'workload', normalized: 'weekly_hours_target',
      value: 25, classification: 'soft_preference', confidence: 0.9,
      source: 'explicit_answer', confirmationStatus: 'unconfirmed', affects: 'max_weekly_hours',
    });
  });

  test('an explicit concrete choice is a confirmed-source preference that may affect planning', () => {
    const p = fromExplicitChoice({ id: 'time_of_day', category: 'time_of_day', normalized: 'avoid_morning', value: true, affects: 'schedule_shape' });
    expect(p.source).toBe('explicit_answer');
    expect(p.classification).toBe('soft_preference');
    expect(p.mayAffectPlanningBeforeConfirmation).toBe(true);
  });

  test('a VAGUE statement never becomes a hard constraint — it is uncertain and inert until confirmed', () => {
    const p = fromVagueStatement({ id: 'load_feel', category: 'workload', originalWording: 'לא עמוס', normalized: 'low_load', affects: 'max_weekly_hours' });
    expect(p.classification).toBe('uncertain');
    expect(p.mayAffectPlanningBeforeConfirmation).toBe(false);
    expect(p.originalWording).toBe('לא עמוס');
    expect(p.confidence).toBeLessThan(0.5);
  });

  test('confirming an uncertain interpretation promotes it (to a soft preference by default) and marks it confirmed', () => {
    const vague = fromVagueStatement({ id: 'load_feel', category: 'workload', originalWording: 'לא עמוס', normalized: 'low_load', affects: 'max_weekly_hours' });
    const confirmed = confirmPreference(vague);
    expect(confirmed.confirmationStatus).toBe('confirmed');
    expect(confirmed.source).toBe('confirmed_interpretation');
    expect(confirmed.mayAffectPlanningBeforeConfirmation).toBe(true);
    expect(confirmed.classification).toBe('soft_preference');
  });

  test('confirming as a hard constraint is allowed only through explicit intent', () => {
    const vague = fromVagueStatement({ id: 'no_fridays', category: 'free_days', originalWording: 'לא שישי', normalized: 'free_friday', affects: 'schedule_shape' });
    const hard = confirmPreference(vague, { as: 'hard_constraint' });
    expect(hard.classification).toBe('hard_constraint');
    expect(hard.confirmationStatus).toBe('confirmed');
  });

  test('an "indifferent" (לא משנה לי) preference is explicit and inert but records that the topic was addressed', () => {
    const p = makePreference({ id: 'time_of_day', category: 'time_of_day', normalized: 'no_time_preference', value: null, classification: 'indifferent', confidence: 1, source: 'explicit_answer', affects: 'schedule_shape' });
    expect(p.classification).toBe('indifferent');
  });
});

describe('preference profile — versioning & active set', () => {
  test('an empty profile starts at version 1 with no preferences', () => {
    const profile = emptyProfile();
    expect(profile.version).toBe(1);
    expect(profile.preferences).toEqual([]);
  });

  test('upsert bumps the version and replaces same-id preferences (no duplicates)', () => {
    let profile = emptyProfile();
    profile = upsertPreference(profile, fromExplicitChoice({ id: 'workload_target', category: 'workload', normalized: 'weekly_hours_target', value: 25, affects: 'max_weekly_hours' }));
    expect(profile.version).toBe(2);
    profile = upsertPreference(profile, fromExplicitChoice({ id: 'workload_target', category: 'workload', normalized: 'weekly_hours_target', value: 20, affects: 'max_weekly_hours' }));
    expect(profile.version).toBe(3);
    expect(profile.preferences.filter((p: Preference) => p.id === 'workload_target')).toHaveLength(1);
    expect(profile.preferences.find((p: Preference) => p.id === 'workload_target')!.value).toBe(20);
  });

  test('activePreferences excludes uncertain/unconfirmed items that may not yet affect planning', () => {
    let profile = emptyProfile();
    profile = upsertPreference(profile, fromExplicitChoice({ id: 'a', category: 'workload', normalized: 'x', value: 25, affects: 'max_weekly_hours' }));
    profile = upsertPreference(profile, fromVagueStatement({ id: 'b', category: 'workload', originalWording: 'לא עמוס', normalized: 'low_load', affects: 'max_weekly_hours' }));
    const active = activePreferences(profile);
    expect(active.map((p) => p.id)).toEqual(['a']);
  });
});
