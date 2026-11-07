import { evaluateDegreeRules } from '../../shared/planner/degree-rules';
import type { DegreeEvidence } from '../../shared/planner/degree-evidence';
import spec from '../../data/degrees/tau/electrical_engineering/2027/spec.json';

const rule = spec.course_rules.find(rule => rule.rule_id === 'optional-high-current-pathway')!;
const params = rule.params as { required_course_ids: string[]; alternative_groups: string[][]; project_course_ids: string[]; project_domain: string; optional_goal: string };
const ids = [...params.required_course_ids, ...params.alternative_groups.map(group => group[0]), ...params.project_course_ids];
const evidence: DegreeEvidence = { optionalGoals: [params.optional_goal], projectDomains:
  Object.fromEntries(params.project_course_ids.map(id => [id, { domain: params.project_domain, reference: 'University approved final project topic' }])) };
const evaluate = (selected = ids, report?: DegreeEvidence) => evaluateDegreeRules([rule], {
  completedCourseIds: selected, evidence: report,
})[0].status;

test('the licensing pathway is optional and does not impose courses on other EE students', () => {
  expect(evaluate([], undefined)).toBe('pass');
  expect(evaluate([], { optionalGoals: [] })).toBe('pass');
});

test('the chosen pathway requires every fixed course and one course from each alternative group', () => {
  expect(evaluate(ids, evidence)).toBe('pass');
  expect(evaluate(ids.filter(id => id !== params.required_course_ids[0]), evidence)).toBe('fail');
  expect(evaluate(ids.filter(id => !params.alternative_groups[0].includes(id)), evidence)).toBe('fail');
  const alternate = ids.map(id => id === params.alternative_groups[0][0] ? params.alternative_groups[0][1] : id);
  expect(evaluate(alternate, evidence)).toBe('pass');
});

test('course selection alone does not prove the final-project domain or grant a license', () => {
  expect(evaluate(ids, { optionalGoals: evidence.optionalGoals })).toBe('needs_review');
  const firstProject = params.project_course_ids[0];
  expect(evaluate(ids, { ...evidence, projectDomains: { ...evidence.projectDomains,
    [firstProject]: { domain: 'other', reference: 'University project topic' },
  } })).toBe('fail');
  expect(evaluate(ids, { ...evidence, projectDomains: { ...evidence.projectDomains,
    [firstProject]: { domain: params.project_domain, reference: '' },
  } })).toBe('needs_review');
});
