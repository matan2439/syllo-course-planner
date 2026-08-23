import {
  groundedTopicsForFocusAreas,
  mergeExplicitFocusObjective,
} from '../../api/ai/focus_topic_objective';

describe('explicit academic focus → evidence-backed topic objective', () => {
  test('maps only semantically supported existing focus areas', () => {
    expect(groundedTopicsForFocusAreas([
      { area: 'materials' },
      { area: 'finite_elements' },
      { area: 'biomechanics' },
      { area: 'general' },
    ])).toEqual(['finite_element_analysis', 'materials']);
  });

  test('is duplicate- and order-invariant', () => {
    const a = groundedTopicsForFocusAreas([
      { area: 'fluids' }, { area: 'heat_transfer' }, { area: 'robotics' },
    ]);
    const b = groundedTopicsForFocusAreas([
      { area: 'robotics' }, { area: 'heat_transfer' }, { area: 'fluids' },
    ]);
    expect(a).toEqual(['robotics', 'thermofluids']);
    expect(b).toEqual(a);
  });

  test('unsupported broad areas stay inert instead of being guessed', () => {
    expect(mergeExplicitFocusObjective(undefined, [{ area: 'general' }, { area: 'biomechanics' }], 0))
      .toBeUndefined();
  });

  test('a normalized zero-weight focus stays inert', () => {
    expect(groundedTopicsForFocusAreas([{ area: 'materials', weight: 0 }])).toEqual([]);
  });

  test('structured focus provenance is explicit and distinct from free text', () => {
    const result = mergeExplicitFocusObjective(
      undefined,
      [{ area: 'materials', weight: 1 }],
      3,
      'structured_academic_profile',
    )!;
    expect(result.objectives[0]).toMatchObject({
      source: 'structured_academic_profile',
      preferenceId: 'structured_academic_profile:materials',
      profileVersion: 3,
    });
  });

  test('merges with a typed topic objective without replacing its provenance', () => {
    const base = {
      objectives: [{
        id: 'prefer_topic_alignment' as const,
        preferenceId: 'typed-topic', kind: 'topic' as const,
        target: 'course_topic_interest', topicIds: ['robotics' as const],
        source: 'explicit_answer', profileVersion: 7,
      }],
      objective: 'prefer_topic_alignment' as const,
      topicIds: ['robotics' as const],
    };
    const merged = mergeExplicitFocusObjective(base, [{ area: 'materials' }], 7)!;
    expect(merged.objectives[0]).toMatchObject({
      preferenceId: 'typed-topic', source: 'explicit_answer',
      topicIds: ['materials', 'robotics'],
    });
  });
});
