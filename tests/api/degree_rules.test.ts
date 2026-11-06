import {
  evaluateDegreeRules,
  type DegreeRule,
  type DegreeRuleContext,
} from '../../shared/planner/degree-rules';
import eeSpec from '../../data/degrees/tau/electrical_engineering/2027/spec.json';

const rule = (kind: string, course_ids: string[], params: Record<string, unknown> = {}): DegreeRule =>
  ({ rule_id: 'test-rule', kind, course_ids, params });
const evaluate = (r: DegreeRule, context: DegreeRuleContext = {}) => evaluateDegreeRules([r], context)[0];
const at = (courseId: string, semesterId: string | number) => ({ courseId, semesterId });
const core = rule('distinct_categories', ['shared', 'only-a', 'only-c', 'extra'], {
  min_courses: 3, min_distinct_categories: 3,
  category_members: { a: ['shared', 'only-a', 'extra'], b: ['shared'], c: ['only-c'] },
});

describe('generic degree rules', () => {
  test('returns ordered rule ids and Hebrew explanations without assuming unknown kinds pass', () => {
    const results = evaluateDegreeRules([
      { ...rule('future_rule', []), rule_id: 'future' },
      { ...rule('mutually_exclusive', ['a', 'b']), rule_id: 'exclusion' },
    ], {});
    expect(results.map(r => [r.rule_id, r.status])).toEqual([
      ['future', 'needs_review'], ['exclusion', 'pass'],
    ]);
    results.forEach(r => expect(r.explanation).toMatch(/[א-ת]/));
    expect(evaluateDegreeRules([], {})).toEqual([]);
  });

  test('matches overlapping categories by reassigning a shared course rather than greedily consuming it', () => {
    expect(evaluate(core, {
      placements: [at('shared', 5)], completedCourseIds: new Set(['only-a']), currentCourseIds: ['only-c'],
    }).status).toBe('pass');
  });

  test('one shared course cannot cover two tracks even when the total course minimum is met', () => {
    const overlap = rule('distinct_categories', ['shared', 'a1', 'a2'], {
      min_courses: 3, min_distinct_categories: 3,
      category_members: { a: ['a1', 'a2'], b: ['shared'], c: ['shared'] },
    });
    expect(evaluate(overlap, { completedCourseIds: ['shared', 'a1', 'a2'] }).status).toBe('fail');
  });

  test('deduplicates across placements and academic states and ignores courses outside rule scope', () => {
    expect(evaluate(core, {
      placements: [at('shared', 5), at('shared', 6), at('unknown', 7)],
      completedCourseIds: ['shared'], currentCourseIds: ['shared', ''],
    }).status).toBe('fail');
    expect(evaluate(core).status).toBe('fail');
    expect(evaluate(core, { completedCourseIds: ['unknown', ''] }).status).toBe('fail');
  });

  test('checks the course minimum independently of category coverage', () => {
    expect(evaluate({ ...core, params: { ...core.params, min_courses: 4 } }, {
      completedCourseIds: ['shared', 'only-a', 'only-c'],
    }).status).toBe('fail');
  });

  test.each([
    { min_courses: -1, min_distinct_categories: 1, category_members: { a: ['a'] } },
    { min_courses: 1, min_distinct_categories: 1.5, category_members: { a: ['a'] } },
    { min_courses: 1, min_distinct_categories: 1, category_members: { a: 'a' } },
    { min_courses: 1, min_distinct_categories: 1, category_members: {} },
  ])('keeps malformed category parameters unresolved: %j', params => {
    expect(evaluate(rule('distinct_categories', ['a'], params)).status).toBe('needs_review');
  });

  test('does not count mapped courses outside the declared course scope', () => {
    expect(evaluate(rule('distinct_categories', ['a'], {
      min_courses: 1, min_distinct_categories: 1, category_members: { x: ['unknown'] },
    }), { completedCourseIds: ['unknown'] }).status).toBe('needs_review');
  });

  test('does not certify compound core or ambiguous third-lab rules', () => {
    expect(evaluate({ ...core, params: { ...core.params, within_track_courses_min: 12 } }, {
      completedCourseIds: ['shared', 'only-a', 'only-c'],
    }).status).toBe('needs_review');
    const labs = rule('distinct_categories', ['a', 'b', 'c'], {
      min_courses: 2, min_distinct_categories: 2,
      category_members: { x: ['a', 'b'], y: ['c'] }, same_track_requires_third_lab: true,
    });
    expect(evaluate(labs, { completedCourseIds: ['a', 'b'] }).status).toBe('needs_review');
    expect(evaluate(labs, { completedCourseIds: ['a', 'c'] }).status).toBe('needs_review');
  });

  test('exclusions span completed, current, and planned courses, including external counterparts', () => {
    const exclusion = rule('mutually_exclusive', ['a', 'external']);
    expect(evaluate(exclusion, { completedCourseIds: ['a'], currentCourseIds: ['external'] }).status).toBe('fail');
    expect(evaluate(exclusion, { currentCourseIds: ['a'], placements: [at('external', 8)] }).status).toBe('fail');
    expect(evaluate(exclusion, {
      completedCourseIds: ['a'], currentCourseIds: ['a'], placements: [at('a', 7)],
    }).status).toBe('pass');
    expect(evaluate(exclusion, { completedCourseIds: ['unknown', ''] }).status).toBe('pass');
  });

  test.each([[], ['a'], ['a', 'a'], ['a', 'a', 'b'], ['']].map(ids => ({ ids })))('does not auto-pass incomplete or self-referential exclusions: $ids', ({ ids }) => {
    expect(evaluate(rule('mutually_exclusive', ids)).status).toBe('needs_review');
  });

  test.each([
    ['year_3_semester_b', 'fail'], ['year_4_semester_a', 'pass'], ['year_4_semester_b', 'pass'],
    [6, 'fail'], [7, 'pass'], [8, 'pass'], ['year_5_semester_a', 'fail'],
  ])('uses study-year ordinals for year restrictions: %s => %s', (semester, expected) => {
    expect(evaluate(rule('year_restriction', ['a'], { years: [4] }), {
      placements: [at('a', semester)],
    }).status).toBe(expected);
  });

  test.each([[2, 'fail'], [3, 'pass'], [8, 'pass']])('checks inclusive from_semester: %s => %s', (semester, expected) => {
    expect(evaluate(rule('year_restriction', ['a'], { from_semester: 3 }), {
      placements: [at('a', semester)],
    }).status).toBe(expected);
  });

  test.each([[1, 'fail'], [2, 'pass'], [3, 'pass'], [4, 'fail'], [6, 'fail']])('offering windows use full ordinals, not A/B parity: %s => %s', (semester, expected) => {
    expect(evaluate(rule('offering_window', ['a'], { semesters: [2, 3] }), {
      placements: [at('a', semester)],
    }).status).toBe(expected);
  });

  test('intersects timing conditions and checks every placement', () => {
    const r = rule('year_restriction', ['a', 'b'], { years: [2], from_semester: 4 });
    expect(evaluate(r, { placements: [at('a', 4), at('b', 3)] }).status).toBe('fail');
    expect(evaluate(r, { placements: [at('a', 4), at('unknown', 1)] }).status).toBe('pass');
    expect(evaluate(r, { placements: [at('a', 4), at('a', 1)] }).status).toBe('fail');
  });

  test.each(['min_average', 'admission_interview', 'future_condition'])('unmodeled %s never becomes a timing pass', key => {
    const r = rule('year_restriction', ['a'], { years: [4], [key]: true });
    expect(evaluate(r, { placements: [at('a', 7)] }).status).toBe('needs_review');
    expect(evaluate(r, { placements: [at('a', 6)] }).status).toBe('fail');
  });

  test('enforces the EE offering-window course cap without counting duplicate ids', () => {
    const r = rule('offering_window', ['a', 'b'], { semesters: [2, 3], max_courses: 1 });
    expect(evaluate(r, { placements: [at('a', 2), at('a', 3)] }).status).toBe('pass');
    expect(evaluate(r, { placements: [at('a', 2), at('b', 3)] }).status).toBe('fail');
  });

  test('missing or unrecognized timing evidence requires review; definite violations still fail', () => {
    const r = rule('year_restriction', ['a', 'b'], { years: [4] });
    expect(evaluate(r, { completedCourseIds: ['a'] }).status).toBe('needs_review');
    expect(evaluate(r, { currentCourseIds: ['a'] }).status).toBe('needs_review');
    expect(evaluate(r, { placements: [at('a', 'semester_a')] }).status).toBe('needs_review');
    expect(evaluate(r, { placements: [at('a', 0)] }).status).toBe('needs_review');
    expect(evaluate(r, { completedCourseIds: ['a'], placements: [at('b', 1)] }).status).toBe('fail');
    expect(evaluate(r).status).toBe('pass'); // Restriction does not require taking an optional course.
  });

  test.each([
    ['year_restriction', [], { years: [4] }],
    ['year_restriction', ['a'], { years: [] }],
    ['year_restriction', ['a'], { from_semester: '3' }],
    ['offering_window', ['a'], { semesters: [0] }],
    ['offering_window', ['a'], {}],
  ] as const)('malformed or global timing rule is unresolved: %s %j %j', (kind, ids, params) => {
    expect(evaluate(rule(kind, [...ids], params), { placements: [at('a', 4)] }).status).toBe('needs_review');
  });

  test('consumes actual EE spec rules without server imports or fabricated enforcement', () => {
    const results = evaluateDegreeRules(eeSpec.course_rules, { placements: [at('0509-4010', 7)] });
    const byId = Object.fromEntries(results.map(r => [r.rule_id, r.status]));
    expect(results).toHaveLength(eeSpec.course_rules.length);
    expect(byId['core-four-distinct-tracks']).toBe('fail');
    expect(byId['labs-two-distinct-tracks']).toBe('needs_review');
    expect(byId['excl-0512-4506-as-printed']).toBe('needs_review');
    expect(byId['year-0509-4010']).toBe('needs_review');
    expect(byId['english-two-courses']).toBe('needs_review');
  });
});
