import type { SavedPlan, SavedWeeklySchedule } from '../../../../shared/planner/student-workspace';
import type { BiddingDraft } from '../../../../shared/planner/bidding';

export interface BoardSnapshot {
  version: string | null; catalogVersion: string | null;
  semesters: Array<{ semesterId: string; courseIds: string[] }>;
  courseNames: Record<string, string>; courseHours: Record<string, number>;
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function captureSavedPlan(id: string, name: string, snapshot: BoardSnapshot, weeklySchedule: SavedWeeklySchedule, bidding?: BiddingDraft, now = Date.now()): SavedPlan {
  return copy({ id, name: name.trim(), notes: '', catalogVersion: snapshot.catalogVersion,
    createdAt: now, updatedAt: now, semesters: snapshot.semesters, weeklySchedule, ...(bidding ? { bidding } : {}) });
}
export function compareSavedPlans(a: SavedPlan, b: SavedPlan) {
  const placements = (plan: SavedPlan) => {
    const result = new Map<string, string[]>();
    plan.semesters.forEach((semester) => semester.courseIds.forEach((id) => result.set(id, [...(result.get(id) ?? []), semester.semesterId].sort())));
    return result;
  };
  const first = placements(a), second = placements(b);
  return {
    added: [...second.keys()].filter((id) => !first.has(id)).sort(),
    removed: [...first.keys()].filter((id) => !second.has(id)).sort(),
    moved: [...second.keys()].filter((id) => first.has(id) && JSON.stringify(first.get(id)) !== JSON.stringify(second.get(id))).sort(),
    changedGroups: [...new Set([...Object.keys(a.weeklySchedule.selections), ...Object.keys(b.weeklySchedule.selections)])]
      .filter((id) => JSON.stringify([...(a.weeklySchedule.selections[id] ?? [])].sort()) !== JSON.stringify([...(b.weeklySchedule.selections[id] ?? [])].sort())).sort(),
  };
}
