import {
  parsePrerequisiteExpression, evaluatePrerequisiteExpression, selectPrerequisiteCourses,
  requirementExpression, type PrerequisiteExpression,
} from '../../shared/planner/prerequisite-expression';

const leaf = (course_id: string): PrerequisiteExpression => ({ course_id });

describe('bounded prerequisite expressions', () => {
  test('preserves nested AND/OR and explicit absence', () => {
    const expression = { all_of: [{ any_of: [leaf('A'), leaf('B')] }, leaf('C')] };
    expect(parsePrerequisiteExpression(expression)).toEqual(expression);
    expect(evaluatePrerequisiteExpression(expression, id => ['B', 'C'].includes(id) ? 'satisfied' : 'unsatisfied')).toBe('satisfied');
    expect(evaluatePrerequisiteExpression(expression, id => id === 'B' ? 'satisfied' : 'unsatisfied')).toBe('unsatisfied');
    expect(evaluatePrerequisiteExpression({ all_of: [] }, () => 'unknown')).toBe('satisfied');
  });

  test.each([null, undefined, {}, [], { any_of: [] }, { course_id: '' },
    { course_id: 'A', all_of: [] }, { all_of: [null] }, { any_of: [leaf('A'), {}] }])('malformed or missing expression is unknown: %j', raw => {
    expect(parsePrerequisiteExpression(raw)).toBeNull();
    expect(evaluatePrerequisiteExpression(raw, () => 'satisfied')).toBe('unknown');
  });

  test('unknown leaves do not satisfy AND, but a known OR alternative suffices', () => {
    const status = (id: string) => id === 'A' ? 'satisfied' as const : 'unknown' as const;
    expect(evaluatePrerequisiteExpression({ any_of: [leaf('A'), leaf('B')] }, status)).toBe('satisfied');
    expect(evaluatePrerequisiteExpression({ all_of: [leaf('A'), leaf('B')] }, status)).toBe('unknown');
  });

  test('accepts exactly 256 nodes and depth 16; rejects excess and cycles', () => {
    expect(parsePrerequisiteExpression({ all_of: Array.from({ length: 255 }, () => leaf('A')) })).not.toBeNull();
    expect(parsePrerequisiteExpression({ all_of: Array.from({ length: 256 }, () => leaf('A')) })).toBeNull();
    let expression = leaf('A');
    for (let i = 1; i < 16; i++) expression = { all_of: [expression] };
    expect(parsePrerequisiteExpression(expression)).not.toBeNull();
    expect(parsePrerequisiteExpression({ all_of: [expression] })).toBeNull();
    const cyclic: any = { all_of: [] };
    cyclic.all_of.push(cyclic);
    expect(parsePrerequisiteExpression(cyclic)).toBeNull();
  });

  test('falls back to legacy AND only when expression is absent', () => {
    expect(requirementExpression(undefined, ['A', 'B'])).toEqual({ all_of: [leaf('A'), leaf('B')] });
    expect(requirementExpression(null, ['A'])).toBeNull();
    expect(requirementExpression({ any_of: [leaf('A'), leaf('B')] }, ['C']))
      .toEqual({ any_of: [leaf('A'), leaf('B')] });
    expect(requirementExpression(undefined, undefined)).toBeNull();
  });

  test('selects one feasible OR witness, preferring completed alternatives', () => {
    const expression = { all_of: [{ any_of: [leaf('A'), leaf('B')] }, leaf('C')] };
    expect(selectPrerequisiteCourses(expression, () => 'satisfied', id => id === 'B' ? 0 : 1))
      .toEqual({ status: 'satisfied', courseIds: ['B', 'C'] });
    expect(selectPrerequisiteCourses({ any_of: [leaf('A'), leaf('B')] }, id => id === 'B' ? 'satisfied' : 'unknown').courseIds)
      .toEqual(['B']);
  });
});
