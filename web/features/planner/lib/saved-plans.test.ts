import { captureSavedPlan, compareSavedPlans } from './saved-plans';
import type { SavedWeeklySchedule } from '../../../../shared/planner/student-workspace';
const snapshot = { version: null, catalogVersion: 'v1', semesters: [{ semesterId: 'A', courseIds: ['C1'] }], courseNames: { C1: 'One' }, courseHours: { C1: 3 } };
const weekly: SavedWeeklySchedule = { termMapping: {}, selections: { 'C1:2026:1': ['01'] }, freeDays: ['ו'] };
test('saved alternatives own independent copies of placements and weekly choices', () => {
  const a = captureSavedPlan('plan_11111111', 'A', snapshot, weekly, undefined, 10);
  const b = captureSavedPlan('plan_22222222', 'B', snapshot, weekly, undefined, 20);
  a.semesters[0].courseIds.push('C2'); a.weeklySchedule.selections['C1:2026:1'][0] = '02';
  expect(b.semesters[0].courseIds).toEqual(['C1']);
  expect(b.weeklySchedule.selections['C1:2026:1']).toEqual(['01']);
  expect(weekly.selections['C1:2026:1']).toEqual(['01']);
});
test('comparison reports added/removed/moved courses and distinct weekly groups', () => {
  const a = captureSavedPlan('plan_11111111', 'A', snapshot, weekly, undefined, 10);
  const b = captureSavedPlan('plan_22222222', 'B', { ...snapshot, semesters: [{ semesterId: 'B', courseIds: ['C1', 'C2'] }] }, { ...weekly, selections: { 'C1:2026:1': ['02'] } }, undefined, 20);
  expect(compareSavedPlans(a, b)).toEqual({ added: ['C2'], removed: [], moved: ['C1'], changedGroups: ['C1:2026:1'] });
});
