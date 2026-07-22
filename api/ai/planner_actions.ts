/**
 * Pure, model-driven helpers for the planning action space: legality of
 * semesters for a course, best-fit semester selection, movability/exclusion,
 * and the enumeration of all reasonable next actions given a state. Shared by
 * the worker (Reason step) and the lookahead rollout so both explore the same
 * goal-relevant action space.
 */

import { getLegalSemesters, type CourseLegalityInfo } from './completion_analysis';
import {
  degreeHours as computeDegreeHours,
  scorePlan,
  compareScore,
  isFullyPlaced,
  requiredButUnplacedCourseIds,
  requiredCourseSemesterBoundaries,
} from './planner_goals';
import {
  type ConstraintModel,
  type PlanState,
  type PlannerMutation,
  placedCourseIds,
  semesterOf,
} from './planner_types';

function preferenceScore(model: ConstraintModel, id: string): number {
  const p = model.profiles.get(id);
  if (!p) return 0;
  if (p.is_wanted) return 1;
  if (p.is_unwanted) return -1;
  return 0;
}

export function isExcluded(model: ConstraintModel, id: string): boolean {
  return model.disallowedCourseIds.has(id) || model.profiles.get(id)?.excluded === true;
}

export function isMovable(model: ConstraintModel, id: string): boolean {
  if (model.pinnedCourseIds.has(id)) return false;
  const p = model.profiles.get(id);
  if (!p) return false;
  // Annual (year-long) courses occupy every spanned semester together and are
  // never split — moving or replacing them out of one semester only would
  // break that pairing, contradicting the placement this same course's
  // profile already asserts elsewhere (course_profile.ts's "לא ניתן
  // להזזה/פיצול" LLM-facing note).
  if (p.is_annual) return false;
  return p.placement_policy !== 'fixed';
}

export function legalSemestersFor(model: ConstraintModel, id: string): string[] {
  const p = model.profiles.get(id);
  if (!p) return model.knownSemesterIds;
  const { semesters } = getLegalSemesters(p as CourseLegalityInfo, model.knownSemesterIds);
  return semesters.length ? semesters : model.knownSemesterIds;
}

/**
 * ADD_COURSE action(s) for a candidate course. An `is_annual` course spans
 * multiple semesters together (e.g. a year-long lab meeting in both
 * halves) and must be placed in all of them atomically as a single action —
 * treating each spanned semester as a separate, mutually-exclusive
 * alternative (the default below) would let the search place it in only
 * one, silently under-reporting the true weekly load of the other. Every
 * other course keeps the prior one-action-per-legal-semester behavior.
 *
 * The atomic bundle only ever targets a CONFIDENT span set — the course's
 * own declared `spans_semesters`, or `getLegalSemesters`'s result when it
 * says `confident: true` (this year's actual effective/program offering).
 * When neither is known (an annual flag with no other legality data at
 * all), we can't guess how many semesters the course really spans — bundling
 * it into every known semester on the board would silently overload/
 * misrepresent the plan. Falling through to the single-semester-per-legal-
 * semester behavior below (same as any other course) is the same safe
 * default this codebase used for `is_annual` courses before atomic bundling
 * existed, and matches `isFullyPlaced`'s (planner_goals.ts) identical
 * confident-or-fall-through rule and `plan_validation.ts`'s
 * `annualSpansFor`'s "stay silent when not confident" rule.
 */
export function addCourseActionsFor(model: ConstraintModel, id: string): PlannerMutation[] {
  const p = model.profiles.get(id);
  if (p?.is_annual) {
    let spans: string[] | null = p.spans_semesters?.length ? p.spans_semesters : null;
    if (!spans) {
      const legal = getLegalSemesters(p as CourseLegalityInfo, model.knownSemesterIds);
      if (legal.confident) spans = legal.semesters;
    }
    if (spans) {
      const filtered = spans.filter(sem => model.knownSemesterIds.includes(sem));
      if (!filtered.length) return [];
      const [semesterId, ...alsoSemesterIds] = filtered;
      return [{ type: 'ADD_COURSE', courseId: id, semesterId, ...(alsoSemesterIds.length ? { alsoSemesterIds } : {}) }];
    }
    // No confident span data — fall through to the per-legal-semester
    // behavior below, same as a non-annual course.
  }
  return legalSemestersFor(model, id).map(sem => ({ type: 'ADD_COURSE', courseId: id, semesterId: sem }));
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
  // An is_annual course only counts as "placed" (and so excluded from
  // further consideration) once it occupies EVERY one of its
  // spans_semesters — a partial placement (e.g. stale data predating atomic
  // annual handling, or any other split) must still be repairable.
  const consider = (id: string) =>
    !isFullyPlaced(state, model, placed, id) && !model.completedCourseIds.has(id) && !isExcluded(model, id);

  // 0. annual-elective-completeness repair — unconditional, independent of
  // degree-hour fill (group 4). A partially-placed is_annual course that is
  // NOT mandatory, NOT a category candidate, and NOT wanted (a plain
  // elective) is only otherwise reachable through group 4, which only runs
  // while degree hours are short; but placedHours already counts the
  // partial placement's full hours once it's in `placed` at all, so once
  // the hour target is met that gate never re-opens, leaving the course
  // permanently stuck half-placed and flagged invalid by validation with no
  // way to ever repair it. Mandatory/category/wanted annual courses already
  // get this for free below via `consider` — skipping them here avoids
  // proposing the same atomic action twice.
  const classifiedElsewhere = (id: string) =>
    model.requiredMandatoryCourseIds.includes(id) ||
    model.wantedCourseIds.has(id) ||
    model.categories.some(cat => cat.candidateIds.includes(id));
  for (const [id, p] of model.profiles) {
    if (!p.is_annual || !placed.has(id) || isFullyPlaced(state, model, placed, id)) continue;
    if (classifiedElsewhere(id)) continue;
    actions.push(...addCourseActionsFor(model, id));
  }

  // 1. required mandatory still unplaced — every legal semester.
  for (const id of model.requiredMandatoryCourseIds) {
    if (!consider(id)) continue;
    actions.push(...addCourseActionsFor(model, id));
  }

  // 1b. unplaced PREREQUISITES of a reachable-but-unplaced mandatory course
  // — unconditional, like group 1, NOT gated on group 4's "degree-hour fill,
  // only while short" condition. A prerequisite that's just an ordinary
  // elective on paper is still a structurally required stepping stone (the
  // mandatory course it unlocks can't be legally added until it's placed),
  // not a discretionary filler — Codex finding on this PR: gating it behind
  // group 4 meant a client-supplied initial state that already meets the
  // raw degree-hour target (a real, reachable case — an existing board with
  // enough elective hours but a missing mandatory course) would never even
  // offer this prerequisite as a candidate ADD action, permanently stuck.
  // requiredButUnplacedCourseIds (planner_goals.ts) already includes the
  // mandatory course ids themselves — skip those, group 1 already covers
  // them via every legal semester (this set only carries ONE legality
  // reading per course, whichever `isMandatoryCourseReachable` used).
  //
  // Codex finding on this PR: proposing EVERY legal semester for a required
  // prerequisite (unfiltered) let the search place it at a semester that
  // could never actually satisfy the strict-timing ordering its dependent
  // mandatory course needs — e.g. a prerequisite legal in both an early and
  // a late semester, where only the early one precedes the mandatory course.
  // requiredCourseSemesterBoundaries (planner_goals.ts, mirrors
  // isMandatoryCourseReachable's own beforeIndex logic) gives the latest
  // USEFUL semester index per prerequisite; a missing entry means no
  // boundary data was computable, so — same bias-toward-reachable default
  // this whole mechanism already follows — every legal semester stays
  // offered rather than being wrongly filtered to nothing.
  const boundaries = requiredCourseSemesterBoundaries(state, model);
  const withinBoundary = (a: PlannerMutation, boundary: number | undefined): boolean => {
    if (boundary === undefined || a.type !== 'ADD_COURSE') return true;
    return [a.semesterId, ...(a.alsoSemesterIds ?? [])]
      .every(sem => model.knownSemesterIds.indexOf(sem) < boundary);
  };
  for (const id of requiredButUnplacedCourseIds(state, model)) {
    if (model.requiredMandatoryCourseIds.includes(id)) continue;
    if (!consider(id)) continue;
    const boundary = boundaries.get(id);
    actions.push(...addCourseActionsFor(model, id).filter(a => withinBoundary(a, boundary)));
  }

  // 2. candidates for not-yet-satisfied categories — every legal semester.
  for (const cat of model.categories) {
    const got = cat.candidateIds.filter(id => isFullyPlaced(state, model, placed, id)).length;
    if (got >= cat.required) continue;
    for (const id of cat.candidateIds) {
      if (!consider(id)) continue;
      actions.push(...addCourseActionsFor(model, id));
    }
  }

  // 3. wanted courses — every legal semester.
  for (const id of model.wantedCourseIds) {
    if (!consider(id)) continue;
    actions.push(...addCourseActionsFor(model, id));
  }

  // 4. degree-hour fill — only while short; each elective at its best semester.
  if (computeDegreeHours(state, model) < model.degreeRequiredHours) {
    for (const [id, p] of model.profiles) {
      if (!consider(id) || p.is_mandatory || p.hours == null || p.hours === 0 || p.is_unwanted) continue;
      if (p.is_annual) { actions.push(...addCourseActionsFor(model, id)); continue; }
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

  // 6. replace — swap a low-preference placed course for a higher-preference unplaced one.
  //    Only for the top-3 worst-scoring placed movable courses; top-3 replacements each.
  const scoredPlaced = [...placed]
    .filter(id => isMovable(model, id))
    .map(id => ({ id, pref: preferenceScore(model, id) }))
    .sort((a, b) => a.pref - b.pref)  // worst first
    .slice(0, 3);

  for (const { id: outId, pref: outPref } of scoredPlaced) {
    const sem = semesterOf(state, outId);
    if (!sem) continue;
    const candidates = [...model.profiles.entries()]
      .filter(([inId, p]) =>
        !placed.has(inId) &&
        !model.completedCourseIds.has(inId) &&
        !isExcluded(model, inId) &&
        preferenceScore(model, inId) > outPref &&
        legalSemestersFor(model, inId).includes(sem),
      )
      .sort((a, b) => preferenceScore(model, b[0]) - preferenceScore(model, a[0]))
      .slice(0, 3);

    for (const [inId] of candidates) {
      actions.push({ type: 'REPLACE_COURSE', outId, inId, semesterId: sem });
    }
  }

  return actions;
}
