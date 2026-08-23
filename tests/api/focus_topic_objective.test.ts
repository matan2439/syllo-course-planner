import {
  groundedTopicsForFocusAreas,
  mergeExplicitFocusObjective,
  mergeStructuredAvoidObjective,
  mergeStructuredStyleObjectives,
} from '../../api/ai/focus_topic_objective';
import { scoreObjective, type ResolvedObjective } from '../../api/ai/grounded_objective_set';

const avoidMaterials: ResolvedObjective = {
  id: 'avoid_topic_exposure',
  preferenceId: 'avoid-materials',
  kind: 'topic',
  target: 'course_topic_avoidance',
  topicIds: ['materials'],
  source: 'structured_academic_profile',
  profileVersion: 1,
};

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

  test('structured avoidance is canonical and carries distinct provenance', () => {
    const a = mergeStructuredAvoidObjective(undefined, [
      { area: 'materials', weight: 1 }, { area: 'robotics', weight: 1 },
    ], 4)!;
    const b = mergeStructuredAvoidObjective(undefined, [
      { area: 'robotics', weight: 1 }, { area: 'materials', weight: 1 },
    ], 4)!;
    expect(a.objectives).toEqual(b.objectives);
    expect(a.objectives[0]).toMatchObject({
      id: 'avoid_topic_exposure',
      topicIds: ['materials', 'robotics'],
      source: 'structured_academic_profile',
    });
  });

  test('the same topic in focus and avoid is removed from both and disclosed', () => {
    const focused = mergeExplicitFocusObjective(undefined, [{ area: 'materials' }], 2)!;
    const conflicted = mergeStructuredAvoidObjective(focused, [{ area: 'materials' }], 2)!;
    expect(conflicted.objectives).toEqual([]);
    expect(conflicted.excluded).toContainEqual({
      id: 'conflicting_topic:materials',
      value: 'materials',
      reason: 'conflicting_grounded_topic',
    });
  });

  test('unknown evidence and an evidenced non-match are equally neutral', () => {
    const topics = new Map([
      ['KNOWN_OTHER', { topicIds: new Set(['robotics' as const]), sourceRef: 'official:other', academicYear: 2027 }],
    ]);
    const unknown = scoreObjective(['UNKNOWN'], avoidMaterials, 'snapshot', new Map(), topics);
    const knownOther = scoreObjective(['KNOWN_OTHER'], avoidMaterials, 'snapshot', new Map(), topics);
    expect(unknown.normalized).toBe(1);
    expect(knownOther.normalized).toBe(1);
  });

  test('only affirmative avoided-topic evidence lowers the objective', () => {
    const topics = new Map([
      ['EXPOSED', { topicIds: new Set(['materials' as const]), sourceRef: 'official:materials', academicYear: 2027 }],
    ]);
    const exposed = scoreObjective(['EXPOSED', 'EXPOSED'], avoidMaterials, 'snapshot', new Map(), topics);
    expect(exposed.raw).toBe(1);
    expect(exposed.denominator).toBe(1);
    expect(exposed.normalized).toBe(0);
    expect(exposed.contributions).toHaveLength(1);
  });

  test('only officially supported structured styles become objectives', () => {
    const result = mergeStructuredStyleObjectives(undefined, [
      { style: 'project_based', weight: 1 },
      { style: 'lab_based', weight: 1 },
      { style: 'exam_light', weight: 1 },
      { style: 'theoretical', weight: 1 },
      { style: 'industry_relevant', weight: 1 },
    ], 5)!;
    expect(result.objectives.map((o) => o.id)).toEqual([
      'prefer_laboratory_courses', 'prefer_project_courses',
    ]);
    expect(result.objectives.every((o) => o.source === 'structured_academic_profile')).toBe(true);
  });

  test('unsupported and zero-weight styles are inert', () => {
    expect(mergeStructuredStyleObjectives(undefined, [
      { style: 'practical', weight: 1 },
      { style: 'project_based', weight: 0 },
    ], 1)).toBeUndefined();
  });

  test('typed delivery provenance wins over an equivalent structured style', () => {
    const base = {
      objectives: [{
        id: 'prefer_project_courses' as const,
        preferenceId: 'typed-project', kind: 'delivery' as const,
        target: 'project_based', source: 'explicit_answer', profileVersion: 8,
      }],
      objective: 'prefer_project_courses' as const,
    };
    const result = mergeStructuredStyleObjectives(base, [{ style: 'project_based', weight: 1 }], 8)!;
    expect(result.objectives).toEqual(base.objectives);
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
