import {
  hasOverlap,
  groupsOverlap,
  defaultTermMapping,
  type TimeSlot,
  type ScheduleGroup,
} from '../../shared/planner/schedule';

describe('hasOverlap', () => {
  test('same day, overlapping ranges → true', () => {
    const a: TimeSlot = { day: 'א', start: '08:00', end: '10:00' };
    const b: TimeSlot = { day: 'א', start: '09:00', end: '11:00' };
    expect(hasOverlap(a, b)).toBe(true);
  });

  test('same day, back-to-back ranges (end == start) → false', () => {
    const a: TimeSlot = { day: 'א', start: '08:00', end: '10:00' };
    const b: TimeSlot = { day: 'א', start: '10:00', end: '12:00' };
    expect(hasOverlap(a, b)).toBe(false);
  });

  test('different days, same hours → false', () => {
    const a: TimeSlot = { day: 'א', start: '08:00', end: '10:00' };
    const b: TimeSlot = { day: 'ב', start: '08:00', end: '10:00' };
    expect(hasOverlap(a, b)).toBe(false);
  });

  test('one range fully inside another → true', () => {
    const a: TimeSlot = { day: 'ד', start: '08:00', end: '12:00' };
    const b: TimeSlot = { day: 'ד', start: '09:00', end: '10:00' };
    expect(hasOverlap(a, b)).toBe(true);
  });
});

describe('groupsOverlap', () => {
  test('true when any slot pair across two multi-slot groups overlaps', () => {
    const a: Pick<ScheduleGroup, 'slots'> = {
      slots: [
        { day: 'א', start: '10:00', end: '12:00' },
        { day: 'ד', start: '08:00', end: '10:00' },
      ],
    };
    const b: Pick<ScheduleGroup, 'slots'> = {
      slots: [{ day: 'ד', start: '09:00', end: '11:00' }],
    };
    expect(groupsOverlap(a, b)).toBe(true);
  });

  test('false when no slot pair overlaps', () => {
    const a: Pick<ScheduleGroup, 'slots'> = { slots: [{ day: 'א', start: '10:00', end: '12:00' }] };
    const b: Pick<ScheduleGroup, 'slots'> = { slots: [{ day: 'ב', start: '10:00', end: '12:00' }] };
    expect(groupsOverlap(a, b)).toBe(false);
  });
});

describe('defaultTermMapping', () => {
  test('maps 4 semester ids to 4 consecutive terms starting from the current calendar term', () => {
    const ids = ['year_3_semester_a', 'year_3_semester_b', 'year_4_semester_a', 'year_4_semester_b'];
    const mapping = defaultTermMapping(ids, new Date('2026-09-10T00:00:00Z'));
    expect(mapping).toEqual({
      year_3_semester_a: { year: 2026, semester: 1 },
      year_3_semester_b: { year: 2026, semester: 2 },
      year_4_semester_a: { year: 2027, semester: 1 },
      year_4_semester_b: { year: 2027, semester: 2 },
    });
  });

  test('a date before August maps to semester 2 of the previous calendar year', () => {
    const ids = ['year_3_semester_a', 'year_3_semester_b'];
    const mapping = defaultTermMapping(ids, new Date('2026-03-01T00:00:00Z'));
    expect(mapping).toEqual({
      year_3_semester_a: { year: 2025, semester: 2 },
      year_3_semester_b: { year: 2026, semester: 1 },
    });
  });
});
