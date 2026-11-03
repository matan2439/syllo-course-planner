import { checkTimetable } from '../../shared/planner/timetable';
import type { ScheduleCourse, TimeSlot } from '../../shared/planner/schedule';

const courses: ScheduleCourse[] = [{
  courseId: 'C1', nameHe: 'Course', cYear: 2026, found: true, incompleteData: false,
  groups: [
    { groupId: '01', havura: '01', kind: 'lecture', teachingMode: 'lecture', lecturer: null, room: null, slots: [{ day: 'א', start: '10:00', end: '12:00' }] },
    { groupId: '02', havura: '02', kind: 'lecture', teachingMode: 'lecture', lecturer: null, room: null, slots: [{ day: 'ב', start: '10:00', end: '12:00' }] },
  ],
}];
const solve = (items: ScheduleCourse[], busy: TimeSlot[]) => Reflect.apply(checkTimetable, undefined, [items, [], {}, busy]);

test('personal busy time rules out an overlapping alternative while a touching boundary stays valid', () => {
  expect(solve(courses, [{ day: 'א', start: '11:00', end: '13:00' }]).selection[0].groupId).toBe('02');
  expect(solve(courses, [{ day: 'א', start: '12:00', end: '13:00' }]).selection[0].groupId).toBe('01');
});

test('a course with all timed options blocked is infeasible, not reclassified as missing data', () => {
  const result = solve(courses, [{ day: 'א', start: '09:00', end: '13:00' }, { day: 'ב', start: '09:00', end: '13:00' }]);
  expect(result.feasible).toBe(false);
  expect(result.unknownCourseIds).toEqual([]);
});

test('an untimed required choice still reports missing data when busy constraints are present', () => {
  const result = solve([{ ...courses[0], groups: [{ ...courses[0].groups[0], slots: [] }] }], [{ day: 'א', start: '09:00', end: '13:00' }]);
  expect(result.unknownCourseIds).toEqual(['C1']);
});
