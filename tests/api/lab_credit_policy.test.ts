import { evaluateDegreeRules } from '../../shared/planner/degree-rules';

const rule = { rule_id: 'labs', kind: 'distinct_categories', course_ids: ['A', 'B', 'C'], params: {
  min_courses: 2, min_distinct_categories: 2, category_members: { one: ['A', 'B'], two: ['C'] },
  same_track_requires_third_lab: true, third_lab_counts_toward_theory_credits: false,
} };
const allocation = { creditedLabCourseIds: ['A', 'B'], nonTheoryLabCourseIds: ['C'], reference: 'University lab credit record' };
const evaluate = (patch: any = {}) => evaluateDegreeRules([rule], { completedCourseIds: ['A', 'B', 'C', 'T'],
  courseHours: { A: 3, B: 3, C: 4, T: 170 }, requiredDegreeHours: 179,
  evidence: { labCreditAllocations: { labs: allocation } }, ...patch,
})[0].status;

test('third lab fulfills the second-track requirement but cannot fill theory hours', () => {
  expect(evaluate()).toBe('fail'); // 180 raw hours, only 176 eligible hours.
  expect(evaluate({ courseHours: { A: 3, B: 3, C: 4, T: 173 } })).toBe('pass');
  expect(evaluate({ evidence: undefined })).toBe('needs_review');
});

test('unreferenced, overlapping or partial credit allocations cannot certify completion', () => {
  for (const report of [
    { ...allocation, reference: '' }, { ...allocation, creditedLabCourseIds: ['A', 'C'] },
    { ...allocation, nonTheoryLabCourseIds: [] }, { ...allocation, creditedLabCourseIds: ['A', 'A'] },
    { ...allocation, otherRecognizedDegreeHours: 3 },
  ]) expect(evaluate({ evidence: { labCreditAllocations: { labs: report } } })).toBe('needs_review');
  expect(evaluate({ evidence: { labCreditAllocations: { labs: { ...allocation,
    otherRecognizedDegreeHours: 3, otherCreditReference: 'Distinct university-recognized credit, excluding the additional lab',
  } } } })).toBe('pass');
});

test('ordinary two-distinct-track labs need no exceptional credit record', () => {
  expect(evaluate({ completedCourseIds: ['A', 'C'], evidence: undefined })).toBe('pass');
  expect(evaluate({ completedCourseIds: ['A', 'B'], evidence: undefined })).toBe('fail');
});
