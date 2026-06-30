/**
 * Pure, model-driven helpers for the planning action space: legality of
 * semesters for a course, best-fit semester selection, movability/exclusion,
 * and the enumeration of all reasonable next actions given a state. Shared by
 * the worker (Reason step) and the lookahead rollout so both explore the same
 * goal-relevant action space.
 */

import { getLegalSemesters, type CourseLegalityInfo } from './completion_analysis';
import { degreeHours as computeDegreeHours } from './planner_goals';
import {
  type ConstraintModel,
  type PlanState,
  type PlannerMutation,
  placedCourseIds,
  semesterOf,
} from './planner_types';

export function isExcluded(model: ConstraintModel, id: string): boolean {
  return model.disallowedCourseIds.has(id) || model.profiles.get(id)?.excluded === true;
}

export function isMovable(model: ConstraintModel, id: string): boolean {
  if (model.pinnedCourseIds.has(id)) return false;
  const p = model.profiles.get(id);
  if (!p) return false;
  return p.placement_policy !== 'fixed';
}

export function legalSemestersFor(model: ConstraintModel, id: string): string[] {
  const p = model.profiles.get(id);
  if (!p) return model.knownSemesterIds;
  const { semesters } = getLegalSemesters(p as CourseLegalityInfo, model.knownSemesterIds);
  return semesters.length ? semesters : model.knownSemesterIds;
}

function loadOf(state: PlanState, model: ConstraintModel, sem: string): number {
  return (state.semesters[sem] ?? []).reduce((s, c) => s + (model.profiles.get(c)?.hours ?? 0), 0);
}

/** Best legal semester for a fresh placement: lowest resulting load that stays under the hard cap. */
export function bestLegalSemester(state: PlanState, model: ConstraintModel, id: string): string | null {
  const legal = legalSemestersFor(model, id);
  if (!legal.length) return null;
  const hours = model.profiles.get(id)?.hours ?? 0;
  const ranked = [...legal].sort((a, b) => loadOf(state, model, a) - loadOf(state, model, b));
  const fitting = ranked.find(sem => loadOf(state, model, sem) + hours <= model.hardCap);
  return fitting ?? ranked[0];
}

/**
 * All reasonable next actions, goal-relevant and bounded: place required
 * mandatory, fill unmet categories, place wanted courses, fill degree hours
 * (while short), and move movable courses for balance. Illegality is judged
 * later by validation — this only filters out already-placed/completed/excluded
 * courses.
 */
export function enumerateActions(state: PlanState, model: ConstraintModel): PlannerMutation[] {
  const placed = new Set(placedCourseIds(state));
  const actions: PlannerMutation[] = [];
  const consider = (id: string) =>
    !placed.has(id) && !model.completedCourseIds.has(id) && !isExcluded(model, id);

  // 1. required mandatory still unplaced — every legal semester.
  for (const id of model.requiredMandatoryCourseIds) {
    if (!consider(id)) continue;
    for (const sem of legalSemestersFor(model, id)) actions.push({ type: 'ADD_COURSE', courseId: id, semesterId: sem });
  }

  // 2. candidates for not-yet-satisfied categories — every legal semester.
  for (const cat of model.categories) {
    const got = cat.candidateIds.filter(id => placed.has(id)).length;
    if (got >= cat.required) continue;
    for (const id of cat.candidateIds) {
      if (!consider(id)) continue;
      for (const sem of legalSemestersFor(model, id)) actions.push({ type: 'ADD_COURSE', courseId: id, semesterId: sem });
    }
  }

  // 3. wanted courses — every legal semester.
  for (const id of model.wantedCourseIds) {
    if (!consider(id)) continue;
    for (const sem of legalSemestersFor(model, id)) actions.push({ type: 'ADD_COURSE', courseId: id, semesterId: sem });
  }

  // 4. degree-hour fill — only while short; each elective at its best semester.
  if (computeDegreeHours(state, model) < model.degreeRequiredHours) {
    for (const [id, p] of model.profiles) {
      if (!consider(id) || p.is_mandatory || p.hours == null || p.hours === 0) continue;
      const sem = bestLegalSemester(state, model, id);
      if (sem) actions.push({ type: 'ADD_COURSE', courseId: id, semesterId: sem });
    }
  }

  // 5. balance — move a movable placed course to another legal semester.
  for (const id of placed) {
    if (!isMovable(model, id)) continue;
    const here = semesterOf(state, id);
    for (const sem of legalSemestersFor(model, id)) {
      if (sem !== here) actions.push({ type: 'MOVE_COURSE', courseId: id, toSemester: sem });
    }
  }

  return actions;
}
