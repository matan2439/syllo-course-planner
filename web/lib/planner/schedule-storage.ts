import type { SemesterTerm } from '../../../shared/planner/schedule';

const STORAGE_PREFIX = 'tau_weekly_schedule';

export interface WeeklyScheduleState {
  termMapping: Record<string, SemesterTerm>;
  /** key = `${courseId}:${year}:${semester}` → selected group ids for that course+term. */
  selections: Record<string, string[]>;
  /** Weekdays (א..ו) the student wants free of classes — the best-groups search avoids them. */
  freeDays: string[];
}

export function selectionKey(courseId: string, term: SemesterTerm): string {
  return `${courseId}:${term.year}:${term.semester}`;
}

function storageKey(programId: string): string {
  return `${STORAGE_PREFIX}:${programId}`;
}

export function loadWeeklyScheduleState(
  programId: string,
  defaultMapping: Record<string, SemesterTerm>,
): WeeklyScheduleState {
  try {
    const raw = window.localStorage.getItem(storageKey(programId));
    if (!raw) return { termMapping: defaultMapping, selections: {}, freeDays: [] };
    const parsed = JSON.parse(raw) as Partial<WeeklyScheduleState>;
    return {
      termMapping: { ...defaultMapping, ...(parsed.termMapping ?? {}) },
      selections: parsed.selections ?? {},
      freeDays: Array.isArray(parsed.freeDays) ? parsed.freeDays : [],
    };
  } catch {
    return { termMapping: defaultMapping, selections: {}, freeDays: [] };
  }
}

export function saveWeeklyScheduleState(programId: string, state: WeeklyScheduleState): void {
  try {
    window.localStorage.setItem(storageKey(programId), JSON.stringify(state));
  } catch {
    // localStorage can throw (private mode, quota exceeded) — persistence is best-effort.
  }
}
