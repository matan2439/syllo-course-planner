/**
 * K9C — impact-driven elicitation for the grounded course-feature topic, and the
 * factual explanation surface.
 *
 * The topic lives in the EXISTING DeterministicPreferenceElicitation catalog —
 * no separate questionnaire, no separate knowledge-preference store. It is
 * gated so it is asked only when answering it could really change which plan is
 * selected, never merely because it exists in the catalog.
 */
import {
  DeterministicPreferenceElicitation,
  DEFAULT_QUESTION_CATALOG,
  type ElicitationContext,
} from '../../api/ai/preference_elicitation';
import { emptyProfile, type PreferenceProfile } from '../../api/ai/preference_model';
import { resolveGroundedObjective } from '../../api/ai/grounded_preference';
import { effectivePlannerPreferences } from '../../api/ai/preference_eligibility';
import { explainGroundedRanking } from '../../api/ai/grounded_objectives';

const elicitation = new DeterministicPreferenceElicitation();
const TOPIC = 'course_feature_practical';

const impactful = (over: Partial<NonNullable<ElicitationContext['groundedFeatureImpact']>> = {}) => ({
  feature: 'practical_laboratory',
  distinguishesCandidates: true,
  coverageSufficient: true,
  hasConflicts: false,
  ...over,
});

/** Answer every OTHER topic so the grounded one is the only candidate left. */
function profileWithOthersAnswered(): PreferenceProfile {
  let p = emptyProfile();
  for (const q of DEFAULT_QUESTION_CATALOG) {
    if (q.id === TOPIC) continue;
    p = elicitation.applyAnswer(p, q, { kind: 'indifferent' }).profile;
  }
  return p;
}

const nextId = (profile: PreferenceProfile, ctx: ElicitationContext) =>
  elicitation.selectNextQuestion(profile, ctx)?.id ?? null;

describe('K9C — the grounded topic is asked only when it is impactful', () => {
  test('asked when evidence-backed alternatives genuinely differ', () => {
    expect(nextId(profileWithOthersAnswered(), { groundedFeatureImpact: impactful() })).toBe(TOPIC);
  });

  test('NOT asked merely because it exists in the catalog (no evidence signal at all)', () => {
    expect(nextId(profileWithOthersAnswered(), {})).toBeNull();
  });

  test('NOT asked when the evidence does not distinguish the candidates', () => {
    expect(nextId(profileWithOthersAnswered(), {
      groundedFeatureImpact: impactful({ distinguishesCandidates: false }),
    })).toBeNull();
  });

  test('NOT asked when evidence coverage is insufficient', () => {
    expect(nextId(profileWithOthersAnswered(), {
      groundedFeatureImpact: impactful({ coverageSufficient: false }),
    })).toBeNull();
  });

  test('NOT asked when the evidence is in conflict', () => {
    expect(nextId(profileWithOthersAnswered(), {
      groundedFeatureImpact: impactful({ hasConflicts: true }),
    })).toBeNull();
  });

  test('NOT re-asked once answered — including an indifferent answer', () => {
    const q = DEFAULT_QUESTION_CATALOG.find((x) => x.id === TOPIC)!;
    const answered = elicitation.applyAnswer(profileWithOthersAnswered(), q, { kind: 'indifferent' }).profile;
    expect(nextId(answered, { groundedFeatureImpact: impactful() })).toBeNull();
  });

  test('a higher-impact unanswered topic is asked first', () => {
    // Nothing answered yet: workload (0.9) outranks the grounded topic (0.5).
    expect(nextId(emptyProfile(), { groundedFeatureImpact: impactful() })).toBe('workload_target');
  });
});

describe('K9C — the question wording is student-facing, never internal', () => {
  const q = DEFAULT_QUESTION_CATALOG.find((x) => x.id === TOPIC)!;

  test('offers a natural Hebrew practical/laboratory choice and an indifferent option', () => {
    expect(q.question_he).toMatch(/מעבדה|מעשית/);
    expect(q.options!.map((o) => o.value)).toContain('practical_laboratory');
    expect(q.allowIndifferent).toBe(true);
    expect(q.options!.some((o) => /אין לי העדפה/.test(o.label_he))).toBe(true);
  });

  test('never exposes evidence ids, source classes or the internal objective name', () => {
    const surface = [q.question_he, q.rationale_he, ...q.options!.map((o) => o.label_he)].join(' ');
    for (const internal of ['prefer_laboratory_courses', 'official_syllabus', 'snapshotId', 'ev_', 'sha_', 'evidenceId']) {
      expect(surface).not.toContain(internal);
    }
  });
});

describe('K9C — answering feeds the SAME eligibility boundary', () => {
  test('choosing the practical option produces a preference that resolves to the objective', () => {
    const q = DEFAULT_QUESTION_CATALOG.find((x) => x.id === TOPIC)!;
    const { profile, requiresConfirmation } = elicitation.applyAnswer(
      profileWithOthersAnswered(), q, { kind: 'choice', value: 'practical_laboratory' },
    );
    expect(requiresConfirmation).toBe(false); // an explicit offered choice, not a vague interpretation
    const resolved = resolveGroundedObjective(effectivePlannerPreferences(profile));
    expect(resolved.objective).toBe('prefer_laboratory_courses');
    expect(resolved.provenance!.source).toBe('explicit_answer');
  });

  test('choosing "no preference" adds NO bias but still records the topic as addressed', () => {
    const q = DEFAULT_QUESTION_CATALOG.find((x) => x.id === TOPIC)!;
    const { profile } = elicitation.applyAnswer(profileWithOthersAnswered(), q, { kind: 'indifferent' });
    expect(resolveGroundedObjective(effectivePlannerPreferences(profile)).objective).toBeUndefined();
    expect(profile.preferences.some((p) => p.id === TOPIC)).toBe(true);
  });

  test('every answer bumps the profile version, so an existing proposal goes stale', () => {
    const q = DEFAULT_QUESTION_CATALOG.find((x) => x.id === TOPIC)!;
    const before = profileWithOthersAnswered();
    const after = elicitation.applyAnswer(before, q, { kind: 'choice', value: 'practical_laboratory' }).profile;
    expect(after.version).toBeGreaterThan(before.version);
  });
});

describe('K9C — the explanation is factual and makes no unsupported claim', () => {
  const objective = { id: 'prefer_laboratory_courses' as const, confirmed: true as const, snapshotId: 'snap_x' };
  const selected = {
    score: 1,
    contributions: [{ courseId: 'E3', feature: 'laboratory' as const, sourceRef: 'https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0542379200&year=2025', academicYear: 2025, excerpt: 'מעבדה' }],
    unknownCourseIds: [] as string[],
  };

  test('states the confirmed preference, the supporting feature, the source and the year', () => {
    const text = explainGroundedRanking({ objective, selected });
    expect(text).toMatch(/מעבדה/);
    expect(text).toContain('ims.tau.ac.il');
    expect(text).toContain('2025');
    expect(text).toContain('E3');
  });

  test('never claims the course is better, easier, less work, or career-valuable', () => {
    const text = explainGroundedRanking({
      objective, selected,
      alternative: { score: 0, contributions: [], unknownCourseIds: [] },
    });
    for (const forbidden of ['טוב יותר', 'קל יותר', 'עומס', 'שכר', 'קריירה', 'מומלץ יותר']) {
      expect(text).not.toContain(forbidden);
    }
  });

  test('discloses coverage limitations instead of implying absence means "no laboratory"', () => {
    const text = explainGroundedRanking({
      objective,
      selected: { ...selected, unknownCourseIds: ['E4'] },
    });
    expect(text).toMatch(/לא קיימת עדות רשמית/);
    expect(text).not.toMatch(/אין מעבדה|ללא מעבדה/); // never asserts a negative from missing data
  });

  test('with no supporting evidence it says so plainly rather than inventing a reason', () => {
    const text = explainGroundedRanking({
      objective,
      selected: { score: 0, contributions: [], unknownCourseIds: [] },
    });
    expect(text).toMatch(/לא נמצאה עדות רשמית/);
  });
});
