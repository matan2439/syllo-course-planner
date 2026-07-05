/**
 * Adapter contract for the Next-native read-only course-details surface.
 * `buildCourseDetails` normalizes a loose raw course into a stable view model,
 * tolerating both the Next repository VM (camelCase) and a legacy courseMap
 * entry (snake_case) so the same panel can be fed from either feeder without a
 * rewrite when the live selection bridge lands. Pure presentation mapping — no
 * selection, eligibility, scoring or board logic.
 */
import { buildCourseDetails } from '../../web/lib/course-details';

test('maps a full legacy courseMap-style (snake_case) entry', () => {
  const vm = buildCourseDetails({
    course_id: '0542-4120',
    name_he: 'מבוא לאווירודינמיקה',
    weekly_hours: 4,
    credits: 3.5,
    program_category_name_he: 'קורסי ליבה — זורמים',
    offered_semesters: ['A', 'B'],
    prerequisite_details: [
      { course_id: '0542-3001', name_he: 'מכניקה' },
      { course_id: '0542-3002', name_he: null },
    ],
    syllabus_url: 'https://example.test/syllabus',
  });
  expect(vm).toMatchObject({
    id: '0542-4120',
    name: 'מבוא לאווירודינמיקה',
    weeklyHours: 4,
    credits: 3.5,
    category: 'קורסי ליבה — זורמים',
    offered: ['A', 'B'],
    syllabusUrl: 'https://example.test/syllabus',
  });
  expect(vm.prerequisites).toEqual([
    { id: '0542-3001', name: 'מכניקה' },
    { id: '0542-3002', name: null },
  ]);
});

test('coalesces a Next repository VM-style (camelCase) entry', () => {
  const vm = buildCourseDetails({
    id: '0542-4460',
    name: 'קורס התמחות כלשהו',
    weeklyHours: 2,
    offered: ['A'],
    syllabusUrl: null,
    category: 'קורסי התמחות',
  });
  expect(vm).toMatchObject({
    id: '0542-4460',
    name: 'קורס התמחות כלשהו',
    weeklyHours: 2,
    offered: ['A'],
    category: 'קורסי התמחות',
    syllabusUrl: null,
  });
});

test('missing fields render gracefully (nulls, empty lists, name fallback)', () => {
  const vm = buildCourseDetails({ course_id: '0542-4124' });
  expect(vm.id).toBe('0542-4124');
  expect(vm.name).toBe('קורס 0542-4124'); // never an empty/null name in the UI
  expect(vm.weeklyHours).toBeNull();
  expect(vm.credits).toBeNull();
  expect(vm.category).toBeNull();
  expect(vm.offered).toEqual([]);
  expect(vm.prerequisites).toEqual([]);
  expect(vm.syllabusUrl).toBeNull();
});

test('prerequisites from a plain id string array carry ids with no name', () => {
  const vm = buildCourseDetails({
    course_id: '0542-4200',
    prerequisites: ['0542-3001', '0542-3002'],
  });
  expect(vm.prerequisites).toEqual([
    { id: '0542-3001', name: null },
    { id: '0542-3002', name: null },
  ]);
});

test('drops falsy prerequisite ids and keeps only real ones', () => {
  const vm = buildCourseDetails({
    course_id: '0542-4300',
    prerequisite_details: [
      { course_id: '0542-3001', name_he: 'מכניקה' },
      { course_id: '', name_he: 'ריק' },
      { course_id: null, name_he: null },
    ],
  });
  expect(vm.prerequisites).toEqual([{ id: '0542-3001', name: 'מכניקה' }]);
});
