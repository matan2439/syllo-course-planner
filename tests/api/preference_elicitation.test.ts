/**
 * Slice 11 — deterministic PreferenceElicitationCapability.
 *
 * Impact-driven progressive profiling (no external provider): pick the single
 * highest-impact UNKNOWN, relevant question; skip known/irrelevant topics; stop
 * when nothing impactful remains; interpret vague answers cautiously.
 */
import {
  DeterministicPreferenceElicitation,
  DEFAULT_QUESTION_CATALOG,
  type ElicitationQuestionDef,
} from '../../api/ai/preference_elicitation';
import { emptyProfile, upsertPreference, fromExplicitChoice } from '../../api/ai/preference_model';

const CATALOG: ElicitationQuestionDef[] = [
  { id: 'workload_target', category: 'workload', affects: 'max_weekly_hours', impact: 0.9, answerType: 'single_choice',
    question_he: 'כמה עמוס?', rationale_he: 'משפיע על מספר הקורסים', allowIndifferent: true, allowFreeText: true,
    options: [{ value: 'light', label_he: 'קל' }, { value: 'full', label_he: 'מלא' }] },
  { id: 'semester_balance', category: 'semester_balance', affects: 'balance_score', impact: 0.6, answerType: 'single_choice',
    question_he: 'לאזן בין סמסטרים?', rationale_he: 'משפיע על פיזור', allowIndifferent: true, allowFreeText: true,
    options: [{ value: 'balanced', label_he: 'מאוזן' }, { value: 'compact', label_he: 'מרוכז' }] },
  { id: 'cosmetic', category: 'cosmetic', affects: 'none', impact: 0.0, answerType: 'single_choice',
    question_he: 'צבע?', rationale_he: '', allowIndifferent: true, allowFreeText: false,
    options: [{ value: 'a', label_he: 'א' }] },
];

const elicit = new DeterministicPreferenceElicitation(CATALOG);

describe('question selection', () => {
  test('the default exported catalog is non-empty and generic (no course ids)', () => {
    expect(DEFAULT_QUESTION_CATALOG.length).toBeGreaterThan(0);
  });

  test('selects the single HIGHEST-impact unknown question', () => {
    const q = elicit.selectNextQuestion(emptyProfile(), {});
    expect(q?.id).toBe('workload_target');
  });

  test('skips a topic already known (not re-asked)', () => {
    let profile = emptyProfile();
    profile = upsertPreference(profile, fromExplicitChoice({ id: 'workload_target', category: 'workload', normalized: 'full', value: 'full', affects: 'max_weekly_hours' }));
    expect(elicit.selectNextQuestion(profile, {})?.id).toBe('semester_balance');
  });

  test('skips a zero-impact / cosmetic question even when unknown', () => {
    let profile = emptyProfile();
    profile = upsertPreference(profile, fromExplicitChoice({ id: 'workload_target', category: 'workload', normalized: 'full', value: 'full', affects: 'max_weekly_hours' }));
    profile = upsertPreference(profile, fromExplicitChoice({ id: 'semester_balance', category: 'semester_balance', normalized: 'balanced', value: 'balanced', affects: 'balance_score' }));
    expect(elicit.selectNextQuestion(profile, {})).toBeNull(); // only cosmetic (impact 0) remains
  });

  test('skips a topic the planner is currently NOT sensitive to (irrelevant context)', () => {
    const q = elicit.selectNextQuestion(emptyProfile(), { irrelevantTopicIds: ['workload_target'] });
    expect(q?.id).toBe('semester_balance');
  });

  test('isSufficient is true exactly when no impactful question remains', () => {
    let profile = emptyProfile();
    expect(elicit.isSufficient(profile, {})).toBe(false);
    profile = upsertPreference(profile, fromExplicitChoice({ id: 'workload_target', category: 'workload', normalized: 'full', value: 'full', affects: 'max_weekly_hours' }));
    profile = upsertPreference(profile, fromExplicitChoice({ id: 'semester_balance', category: 'semester_balance', normalized: 'balanced', value: 'balanced', affects: 'balance_score' }));
    expect(elicit.isSufficient(profile, {})).toBe(true); // user may build now
  });
});

describe('answer application & interpretation', () => {
  const q = CATALOG[0];

  test('an explicit choice updates the profile as an active soft preference', () => {
    const r = elicit.applyAnswer(emptyProfile(), q, { kind: 'choice', value: 'light' });
    expect(r.requiresConfirmation).toBe(false);
    const p = r.profile.preferences.find((x) => x.id === 'workload_target')!;
    expect(p.value).toBe('light');
    expect(p.classification).toBe('soft_preference');
    expect(p.mayAffectPlanningBeforeConfirmation).toBe(true);
  });

  test('"לא משנה לי" is represented explicitly and inertly (topic addressed, not re-asked)', () => {
    const r = elicit.applyAnswer(emptyProfile(), q, { kind: 'indifferent' });
    const p = r.profile.preferences.find((x) => x.id === 'workload_target')!;
    expect(p.classification).toBe('indifferent');
    expect(elicit.selectNextQuestion(r.profile, {})?.id).toBe('semester_balance'); // not re-asked
  });

  test('a vague free-text answer on a consequential topic → uncertain + requires confirmation (not a hard constraint)', () => {
    const r = elicit.applyAnswer(emptyProfile(), q, { kind: 'free_text', text: 'לא עמוס מדי' });
    expect(r.requiresConfirmation).toBe(true);
    const p = r.profile.preferences.find((x) => x.id === 'workload_target')!;
    expect(p.classification).toBe('uncertain');
    expect(p.mayAffectPlanningBeforeConfirmation).toBe(false);
    expect(p.originalWording).toBe('לא עמוס מדי');
  });

  test('confirming the interpretation updates the structured profile (now active)', () => {
    let { profile } = elicit.applyAnswer(emptyProfile(), q, { kind: 'free_text', text: 'לא עמוס מדי' });
    profile = elicit.confirmInterpretation(profile, 'workload_target');
    const p = profile.preferences.find((x) => x.id === 'workload_target')!;
    expect(p.confirmationStatus).toBe('confirmed');
    expect(p.mayAffectPlanningBeforeConfirmation).toBe(true);
  });
});

describe('contradiction detection', () => {
  test('two active preferences affecting the same planner knob with different values are surfaced', () => {
    let profile = emptyProfile();
    profile = upsertPreference(profile, fromExplicitChoice({ id: 'workload_target', category: 'workload', normalized: 'light', value: 'light', affects: 'max_weekly_hours' }));
    profile = upsertPreference(profile, fromExplicitChoice({ id: 'load_feel', category: 'workload', normalized: 'full', value: 'full', affects: 'max_weekly_hours' }));
    const conflicts = elicit.detectContradictions(profile);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].affects).toBe('max_weekly_hours');
    expect(conflicts[0].preferenceIds.sort()).toEqual(['load_feel', 'workload_target']);
  });

  test('no contradiction when the knobs differ', () => {
    let profile = emptyProfile();
    profile = upsertPreference(profile, fromExplicitChoice({ id: 'workload_target', category: 'workload', normalized: 'light', value: 'light', affects: 'max_weekly_hours' }));
    profile = upsertPreference(profile, fromExplicitChoice({ id: 'semester_balance', category: 'semester_balance', normalized: 'balanced', value: 'balanced', affects: 'balance_score' }));
    expect(elicit.detectContradictions(profile)).toEqual([]);
  });
});
