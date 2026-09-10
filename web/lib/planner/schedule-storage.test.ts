import {
  loadWeeklyScheduleState,
  saveWeeklyScheduleState,
  selectionKey,
  type WeeklyScheduleState,
} from './schedule-storage';
import type { SemesterTerm } from '../../../shared/planner/schedule';

const DEFAULT_MAPPING: Record<string, SemesterTerm> = {
  year_3_semester_a: { year: 2026, semester: 1 },
};

beforeEach(() => window.localStorage.clear());

describe('selectionKey', () => {
  test('combines course id and term', () => {
    expect(selectionKey('0542-2400', { year: 2026, semester: 1 })).toBe('0542-2400:2026:1');
  });
});

describe('loadWeeklyScheduleState', () => {
  test('returns the default mapping and empty selections when nothing is stored', () => {
    const state = loadWeeklyScheduleState('mechanical_engineering_2027', DEFAULT_MAPPING);
    expect(state).toEqual({ termMapping: DEFAULT_MAPPING, selections: {} });
  });

  test('round-trips through save/load, merging the default mapping under any missing keys', () => {
    const state: WeeklyScheduleState = {
      termMapping: { year_3_semester_a: { year: 2030, semester: 2 } },
      selections: { '0542-2400:2030:2': ['01', '02'] },
    };
    saveWeeklyScheduleState('mechanical_engineering_2027', state);
    const loaded = loadWeeklyScheduleState('mechanical_engineering_2027', DEFAULT_MAPPING);
    expect(loaded).toEqual(state);
  });

  test("a different programId does not see another program's stored state", () => {
    saveWeeklyScheduleState('program_a', {
      termMapping: DEFAULT_MAPPING,
      selections: { x: ['01'] },
    });
    const loaded = loadWeeklyScheduleState('program_b', DEFAULT_MAPPING);
    expect(loaded.selections).toEqual({});
  });

  test('corrupt stored JSON falls back to defaults instead of throwing', () => {
    window.localStorage.setItem('tau_weekly_schedule:mechanical_engineering_2027', '{not json');
    const state = loadWeeklyScheduleState('mechanical_engineering_2027', DEFAULT_MAPPING);
    expect(state).toEqual({ termMapping: DEFAULT_MAPPING, selections: {} });
  });
});
