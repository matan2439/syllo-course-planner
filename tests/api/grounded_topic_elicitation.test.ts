/**
 * T6 — the topic question is IMPACT-DRIVEN, not a questionnaire.
 *
 * It may only be raised when official content evidence genuinely separates the
 * retained candidates in THIS request, and it may only offer the topics that do
 * the separating. With nothing to separate, nothing is asked.
 */
import {
  DeterministicPreferenceElicitation,
  TOPIC_INTEREST_LABELS_HE,
  type ElicitationContext,
} from '../../api/ai/preference_elicitation';
import { resolveGroundedObjective } from '../../api/ai/grounded_preference';
import { effectivePlannerPreferences } from '../../api/ai/preference_eligibility';
import type { PreferenceProfile } from '../../api/ai/preference_model';

const elicitation = new DeterministicPreferenceElicitation();
const empty = (): PreferenceProfile => ({ version: 1, preferences: [] });

const impactful: NonNullable<ElicitationContext['topicInterestImpact']> = {
  category: 'course_topic_interest',
  distinguishesCandidates: true,
  distinguishingTopics: ['materials', 'thermofluids'],
  coverageSufficient: true,
  hasConflicts: false,
};

/**
 * Higher-impact unrelated topics (workload, balance, time of day) are marked
 * already-addressed so this suite isolates the topic question's own gate. The
 * delivery question is naturally absent: no `groundedFeatureImpact` is supplied.
 */
const ctx = (over: Partial<typeof impactful> = {}): ElicitationContext => ({
  irrelevantTopicIds: ['workload_target', 'semester_balance', 'time_of_day'],
  topicInterestImpact: { ...impactful, ...over },
});

const askTopic = (c: ElicitationContext) => {
  const q = elicitation.selectNextQuestion(empty(), c);
  return q?.id === 'course_topic_interest' ? q : null;
};

describe('T6 — when the topic question is asked', () => {
  test('it IS asked when candidates genuinely differ on applicable topics', () => {
    expect(askTopic(ctx())).not.toBeNull();
  });

  test('it offers ONLY the topics that separate real candidates', () => {
    expect(askTopic(ctx())!.options!.map((o) => o.value)).toEqual(['materials', 'thermofluids']);
  });

  test('the labels are student-facing; internal ids are never the label', () => {
    for (const o of askTopic(ctx())!.options!) {
      expect(o.label_he).toBe(TOPIC_INTEREST_LABELS_HE[o.value]);
      expect(o.label_he).not.toBe(o.value);
      expect(o.label_he).not.toMatch(/_/);
    }
  });

  test('the wording names no evidence id, source class or internal objective', () => {
    const q = askTopic(ctx())!;
    for (const text of [q.question_he, q.rationale_he]) {
      expect(text).not.toMatch(/snap_|sha_|prefer_topic_alignment|topic-map\//);
    }
  });
});

describe('T6 — when it is SUPPRESSED', () => {
  test.each([
    ['candidates do not differ', { distinguishesCandidates: false }],
    ['coverage is insufficient', { coverageSufficient: false }],
    ['an authoritative conflict is open', { hasConflicts: true }],
    ['no topic separates anything', { distinguishingTopics: [] }],
  ])('%s → nothing is asked', (_label, over) => {
    expect(askTopic(ctx(over))).toBeNull();
  });

  test('with NO impact signal at all it is never raised', () => {
    expect(askTopic({})).toBeNull();
  });

  test('an already-answered topic is never re-asked', () => {
    const answered = elicitation.applyAnswer(
      empty(),
      askTopic(ctx())!,
      { kind: 'choice', value: 'materials' },
    ).profile;
    expect(elicitation.selectNextQuestion(answered, ctx())).toBeNull();
  });

  test('an INDIFFERENT answer is recorded, silences the topic, and biases nothing', () => {
    const q = askTopic(ctx())!;
    const profile = elicitation.applyAnswer(empty(), q, { kind: 'indifferent' }).profile;
    // Recorded — so it is not asked again...
    expect(profile.preferences.map((p) => p.id)).toContain('course_topic_interest');
    expect(elicitation.selectNextQuestion(profile, ctx())).toBeNull();
    // ...but it resolves to no objective at all.
    expect(resolveGroundedObjective(effectivePlannerPreferences(profile)).objective).toBeUndefined();
  });
});

describe('T6 — the question is NOT yet exposed to the browser surface', () => {
  /**
   * The topic objective is proven server-side but has had no browser
   * acceptance, so it must not reach a real user yet. Non-exposure is
   * STRUCTURAL, not incidental: the web conversation builds its context from
   * `groundedFeatureImpact` only and never supplies `topicInterestImpact`, so
   * `relevantWhen` is false and the question cannot render. This test fails the
   * moment someone wires the signal through without also removing it.
   */
  test('a context carrying only the delivery signal never raises the topic question', () => {
    const webShapedContext: ElicitationContext = {
      irrelevantTopicIds: ['workload_target', 'semester_balance', 'time_of_day'],
      groundedFeatureImpact: {
        feature: 'course_delivery_format',
        distinguishesCandidates: true,
        coverageSufficient: true,
        hasConflicts: false,
      },
    };
    expect(elicitation.selectNextQuestion(empty(), webShapedContext)!.id).toBe('course_feature_practical');
    expect(askTopic(webShapedContext)).toBeNull();
  });
});

describe('T6 — an answer flows to the objective through the real boundary', () => {
  test('a chosen topic becomes the confirmed topic-alignment objective', () => {
    const q = askTopic(ctx())!;
    const profile = elicitation.applyAnswer(empty(), q, { kind: 'choice', value: 'materials' }).profile;
    const resolved = resolveGroundedObjective(effectivePlannerPreferences(profile));
    expect(resolved.objective).toBe('prefer_topic_alignment');
    expect(resolved.topicIds).toEqual(['materials']);
  });

  test('answering does not itself plan — it only returns a profile', () => {
    const q = askTopic(ctx())!;
    const result = elicitation.applyAnswer(empty(), q, { kind: 'choice', value: 'materials' });
    expect(Object.keys(result).sort()).toEqual(['profile', 'requiresConfirmation']);
    expect(result.requiresConfirmation).toBe(false);
  });
});
