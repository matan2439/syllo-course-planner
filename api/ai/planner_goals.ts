/**
 * The prioritized goal stack and the single ranking mechanism shared by the
 * Planner Worker and both orchestrators.
 *
 * Goals, highest priority first:
 *   1. degree_completion   — reach the required degree hours (e.g. 185).
 *   2. requirements        — place all mandatory courses + satisfy all categories.
 *   3. legality            — no semester over the hard cap / over the user cap.
 *   4a. balance (peak)     — minimize the heaviest semester's load (minimum user
 *                            burden); opening a lighter/empty semester to lower
 *                            the peak is preferred over consolidating onto a
 *                            heavy one.
 *   4b. balance (spread)   — secondary: among equal-peak plans, prefer a tighter
 *                            distribution across non-empty semesters (never a
 *                            reason to open an empty semester on its own).
 *   5. preferences         — place the courses the user wants.
 *   6. difficulty_comfort  — lower total difficulty (pure tiebreaker; never a
 *                            reason to skip a required course).
 *
 * `scorePlan` returns a lexicographic vector (higher is better at every
 * position); `compareScore` orders two such vectors. A lower goal can never
 * outrank a strictly-better higher goal. `scoreAction` is the marginal of this
 * same vector for a tentative action.
 */

import {
  type ConstraintModel,
  type PlanState,
  type PlannerMutation,
  cloneState,
  placedCourseIds,
} from './planner_types';
import { ABSOLUTE_MAX_REASONABLE } from './load_constants';
import { getLegalSemesters, type CourseLegalityInfo } from './completion_analysis';

export const GOAL_STACK = [
  'degree_completion',
  'requirements_mandatory',
  'requirements_category',
  'legality',
  'balance_peak',
  'balance_spread',
  'preferences',
  'unwanted_avoidance',
  'interest_fit',
  'difficulty_comfort',
] as const;
export type Goal = (typeof GOAL_STACK)[number];

/**
 * Total weekly hours placed, deduplicating:
 *  - a single is_annual course id occupying more than one semester slot (the
 *    atomic multi-semester placement this file's is_annual handling produces
 *    — same course id, multiple `state.semesters` entries; must count once)
 *  - the older annual-pair scheme of two distinct course ids sharing a
 *    `root_course_id` with `count_hours_once` set.
 */
export function placedHours(state: PlanState, model: ConstraintModel): number {
  const seenIds = new Set<string>();
  const seenRoots = new Set<string>();
  let sum = 0;
  for (const cid of placedCourseIds(state)) {
    if (seenIds.has(cid)) continue;
    seenIds.add(cid);
    const p = model.profiles.get(cid);
    if (!p) continue;
    if (p.count_hours_once && p.root_course_id) {
      if (seenRoots.has(p.root_course_id)) continue;
      seenRoots.add(p.root_course_id);
    }
    sum += p.hours ?? 0;
  }
  return sum;
}

/** Degree hours achieved: prior progress + placed hours. */
export function degreeHours(state: PlanState, model: ConstraintModel): number {
  return model.priorHours + placedHours(state, model);
}

function semesterLoads(state: PlanState, model: ConstraintModel): number[] {
  return Object.values(state.semesters).map(list =>
    list.reduce((s, cid) => s + (model.profiles.get(cid)?.hours ?? 0), 0),
  );
}

/**
 * The semester set an `is_annual` course must occupy to count as fully
 * placed: its own `spans_semesters` when the board declares them, otherwise
 * `getLegalSemesters`'s result when it is CONFIDENT (this year's actual
 * effective/program offering) — the same confident-only fallback
 * `addCourseActionsFor` (planner_actions.ts) uses when generating the atomic
 * add action. Returns `null` when neither is known: with no confident
 * legality data at all, we can't say how many semesters the course really
 * spans, so completeness falls back to "placed anywhere," the same safe
 * default this codebase used before atomic bundling existed (mirrors
 * `plan_validation.ts`'s `annualSpansFor`, which stays silent for the same
 * reason). Duplicated here rather than imported from planner_actions.ts,
 * which itself imports `isFullyPlaced` from this module — importing back
 * would be a circular dependency.
 */
function effectiveAnnualSpans(model: ConstraintModel, p: NonNullable<ReturnType<ConstraintModel['profiles']['get']>>): string[] | null {
  if (p.spans_semesters?.length) return p.spans_semesters;
  const legal = getLegalSemesters(p as CourseLegalityInfo, model.knownSemesterIds);
  return legal.confident ? legal.semesters : null;
}

/**
 * Whether a course counts as "placed" for completion/requirement purposes.
 * An `is_annual` course only counts once it occupies EVERY one of its
 * effective spans (see `effectiveAnnualSpans`) — being present in just one
 * (e.g. a legacy/stale plan saved before annual courses were handled
 * atomically, or any other partial placement) is not complete, even though
 * `placedCourseIds` already contains its id. Every other course counts as
 * placed by presence anywhere, as before. `placed` is the caller's
 * precomputed `Set(placedCourseIds(state))` for efficiency across repeated
 * calls.
 */
export function isFullyPlaced(state: PlanState, model: ConstraintModel, placed: Set<string>, id: string): boolean {
  if (!placed.has(id)) return false;
  const p = model.profiles.get(id);
  if (p?.is_annual) {
    const spans = effectiveAnnualSpans(model, p);
    if (spans && spans.length) return spans.every(sem => (state.semesters[sem] ?? []).includes(id));
  }
  return true;
}

/**
 * Whether `id` is hard-excluded — the same test `planner_actions.ts`'s
 * `isExcluded` applies (a user avoid or a profile-level exclusion), which
 * `enumerateActions` already uses to keep an excluded course out of every
 * candidate action. Duplicated for the same circular-import reason
 * documented on `isMandatoryCourseReachable`, below.
 */
function isCourseExcluded(model: ConstraintModel, id: string): boolean {
  return model.disallowedCourseIds.has(id) || model.profiles.get(id)?.excluded === true;
}

/**
 * The effective per-semester hour cap: `hardCap`, unless the user has
 * already confirmed an overload (`overloadAccepted` + `overloadConfirmedAt`),
 * in which case `validatePlanState` (Phase 2C policy) legalizes loads up to
 * `absoluteMaxReasonable` instead — the same policy `assessCompleteness`'s
 * `overCapSemesters` already applies, duplicated here rather than shared
 * because it's two lines and pulling in the rest of that function's
 * signature would be more coupling than the logic is worth.
 */
function effectiveHardCap(model: ConstraintModel): number {
  const overloadConfirmed = model.overloadAccepted === true && !!model.overloadConfirmedAt;
  if (!overloadConfirmed) return model.hardCap;
  return model.absoluteMaxReasonable ?? ABSOLUTE_MAX_REASONABLE;
}

/**
 * The RAW legal-semester list `getLegalSemesters` returns for `id` — NOT
 * filtered to `model.knownSemesterIds` and NOT defaulted to
 * `knownSemesterIds` when empty. Callers that need to distinguish "no
 * legality data at all" (ambiguous — every semester is implicitly allowed)
 * from "has declared semester(s), but none of them are on this board"
 * (definitively unreachable) need this raw form; `legalSemestersOnBoard`,
 * below, collapses that distinction (defaults + filters to known semesters)
 * and is only safe to use once a caller has already established `id` itself
 * is reachable.
 */
function rawLegalSemesters(model: ConstraintModel, id: string): string[] {
  const p = model.profiles.get(id);
  if (!p) return [];
  return getLegalSemesters(p as CourseLegalityInfo, model.knownSemesterIds).semesters;
}

/** `id`'s legal semesters, defaulted (no data → every known semester) and filtered to `model.knownSemesterIds`. */
function legalSemestersOnBoard(model: ConstraintModel, id: string): string[] {
  const raw = rawLegalSemesters(model, id);
  return (raw.length ? raw : model.knownSemesterIds).filter(sem => model.knownSemesterIds.includes(sem));
}

/**
 * Whether relocating `id` (currently on the board, somewhere) to `sem` would
 * satisfy `validatePlanProposal`'s strict-timing rule — in BOTH directions:
 *
 *  - `id`'s OWN prerequisites (unless completed/currently-taking) must stay
 *    strictly before `sem` — mirrors `isMandatoryCourseReachable`'s own
 *    already-placed-prerequisite check (line ~410 above), just evaluated
 *    against a hypothetical destination instead of a fresh placement.
 *  - every course ALREADY ON THE BOARD that lists `id` as ITS OWN
 *    prerequisite must stay strictly AFTER `sem` — the direction the
 *    reachability mechanism had never checked before this fix: moving a
 *    blocker LATER can just as easily break a dependent already relying on
 *    it being early, as moving it too-early can break `id`'s own upstream
 *    ordering.
 *
 * A prerequisite/dependent with no resolvable placement on the board is
 * treated as not-yet-constraining (bias toward "legal," same as every other
 * ambiguous case in this file) — this function only rejects a destination it
 * can affirmatively prove would violate strict timing against a placement
 * that's actually on the board right now.
 */
function wouldRelocationBeOrderingLegal(state: PlanState, model: ConstraintModel, id: string, sem: string): boolean {
  const semIdx = model.knownSemesterIds.indexOf(sem);
  if (semIdx < 0) return false;

  const p = model.profiles.get(id);
  for (const prereqId of p?.prerequisites ?? []) {
    if (model.completedCourseIds.has(prereqId)) continue;
    if (model.currentlyPlannedCourseIds?.has(prereqId)) continue;
    const prereqIndices = Object.entries(state.semesters)
      .filter(([, ids]) => ids.includes(prereqId))
      .map(([s]) => model.knownSemesterIds.indexOf(s))
      .filter(i => i >= 0);
    if (prereqIndices.length && Math.max(...prereqIndices) >= semIdx) return false;
  }

  for (const [otherSem, ids] of Object.entries(state.semesters)) {
    const otherIdx = model.knownSemesterIds.indexOf(otherSem);
    if (otherIdx < 0 || semIdx < otherIdx) continue;
    for (const otherId of ids) {
      if (otherId === id) continue;
      if (model.profiles.get(otherId)?.prerequisites?.includes(id)) return false;
    }
  }
  return true;
}

/**
 * Whether `id`, currently placed in `currentSem`, could NOT actually be
 * relocated away by a MOVE action — pinned, `is_annual` (never split/moved,
 * same rule `planner_actions.ts`'s `isMovable` enforces), `placement_policy
 * === 'fixed'`, OR (not fixed/pinned/annual, but) it has NO legal semester
 * other than `currentSem` to move to. `enumerateActions` only ever generates
 * `MOVE_COURSE` targets among a course's own legal semesters, so a course
 * that's technically "movable" by policy but has nowhere else legal to go
 * is just as permanently stuck as a pinned one — an earlier version only
 * checked the policy flags and treated any non-fixed/pinned/annual occupant
 * as freely relocatable, which wrongly ignored this real, permanent
 * crowding. A second earlier version added the "has another legal semester"
 * check but didn't verify that alternate semester actually has room — a
 * third earlier version (this PR's round 24 Codex finding) checked room but
 * not prerequisite-ordering LEGALITY of that room: a semester with capacity
 * to spare is still not a real destination if relocating there would break
 * `id`'s own prerequisite ordering or a dependent course already on the
 * board (`wouldRelocationBeOrderingLegal`, above) — enumerateActions would
 * never actually generate that MOVE, since `planner_actions.ts` only
 * proposes legal-semester targets and downstream validation would reject
 * it, so treating it as a real destination wrongly excluded the occupant's
 * hours from crowding. Still deliberately one-hop, not a recursive "could a
 * CHAIN of moves free up room" analysis — this codebase already has a
 * heavier, purpose-built mechanism for that kind of question
 * (`planner_worker.ts`'s Codex-round-22 redesign, `canRecoverMoreHours`, a
 * bounded best-first rollout) and duplicating it inside a function
 * `scorePlan` calls this often would be a real performance cost for a
 * marginal precision gain; a false "might be movable" here only costs a
 * little unused g1 headroom in a rare edge case, same bias every other
 * check in this function already accepts. Used to decide which occupants of
 * a legal semester represent REAL, permanent crowding versus a course the
 * search could relocate to make room. Duplicated (not imported) for the
 * same circular-import reason documented on `isMandatoryCourseReachable`,
 * below.
 */
function isImmovableOccupant(state: PlanState, model: ConstraintModel, id: string, currentSem: string): boolean {
  if (model.pinnedCourseIds.has(id)) return true;
  const p = model.profiles.get(id);
  if (!p) return true;
  if (p.is_annual === true || p.placement_policy === 'fixed') return true;
  const hours = p.hours ?? 0;
  const cap = effectiveHardCap(model);
  const hasRealDestination = legalSemestersOnBoard(model, id).some(sem => {
    if (sem === currentSem) return false;
    const load = (state.semesters[sem] ?? []).reduce((s, cid) => s + (model.profiles.get(cid)?.hours ?? 0), 0);
    if (load + hours > cap) return false;
    return wouldRelocationBeOrderingLegal(state, model, id, sem);
  });
  return !hasRealDestination;
}

/**
 * Whether `id` can, in principle, ever be legally placed — combining every
 * way a mandatory course can be permanently unreachable, so
 * `remainingMandatoryHours` (below) never reserves g1 budget for something
 * that will never occupy it:
 *
 *  - hard-excluded (`isCourseExcluded`) — `enumerateActions` never proposes it.
 *  - no legal semester has room under the EFFECTIVE cap (`effectiveHardCap`,
 *    which honors a confirmed overload the same way `validatePlanState` does
 *    — an earlier version of this check used the raw `hardCap` unconditionally
 *    and wrongly called a legally-overloadable course unreachable), counting
 *    only IMMOVABLE occupants (`isImmovableOccupant`) toward that room — a
 *    semester crowded only by movable/replaceable courses isn't permanently
 *    full, the search can relocate them; an earlier version counted every
 *    occupant and wrongly called a course unreachable (and stopped reserving
 *    its hours) whenever its semester was merely temporarily busy, which
 *    could discourage the very MOVE the search needed on score-only paths
 *    (no lookahead) that can't see past one step to recognize the move was
 *    worth it.
 *  - its only legal semester isn't one of `model.knownSemesterIds` at all
 *    (`state.semesters` only has entries for known semesters — `emptyState`
 *    — so `applyMutation`'s ADD_COURSE would reject an off-board target).
 *  - `is_annual`: EVERY one of its effective spans (`effectiveAnnualSpans`,
 *    the same span set `isFullyPlaced`/`addCourseActionsFor` use) must fit
 *    simultaneously, not just one — an earlier version used the same
 *    "any one legal semester has room" check as a normal course, but an
 *    annual course is placed atomically across all its spans at once; if
 *    even one span is permanently crowded, the whole add is illegal.
 *  - a prerequisite-ordering deadlock: every direct prerequisite must have
 *    some legal semester strictly before one of `id`'s own legal semesters
 *    — or, when `id` is `is_annual`, strictly before its EARLIEST required
 *    span, since an annual course occupies every span at once and
 *    `validatePlanProposal`'s strict-timing rule checks the prerequisite
 *    against each occurrence independently (an earlier version compared
 *    against `id`'s single latest legal semester even for annual courses,
 *    wrongly treating a prerequisite placed in — or after — the FIRST span
 *    as early enough, when the add would actually be rejected for that
 *    occurrence)
 *    (or already be completed/currently-taking) — AND that prerequisite must
 *    itself be reachable, recursively (an earlier version only checked
 *    ordering, not the prerequisite's own placeability — e.g. a hard-excluded
 *    prerequisite has a perfectly fine earlier offering semester on paper,
 *    but can never actually be added, so the course depending on it can't
 *    either). A prerequisite whose only declared semester is off-board is
 *    treated as definitively unreachable here too, not as "no data" (an
 *    earlier version used `legalSemesterIndices`, which defaults an
 *    all-off-board result to `knownSemesterIds` — the right fallback for a
 *    course with NO legality data at all, but wrong for one that HAS
 *    declared semester(s) that just aren't on this board; `rawLegalSemesters`
 *    lets this distinguish the two). A prerequisite that's ALREADY placed on
 *    the board is treated as satisfied without recursing into it at all —
 *    an earlier version recursed anyway, which re-ran the prerequisite's OWN
 *    fitsSemester check as if it still needed to be added, double-counting
 *    its already-placed hours against its own semester's cap.
 *
 * `visiting` guards recursion against a prerequisite cycle (a data problem
 * this function isn't responsible for diagnosing) — a course already on the
 * current recursion stack is treated as reachable rather than looping
 * forever, the same "bias toward reachable when uncertain" the rest of this
 * function follows: a false "might be reachable" only costs a little unused
 * g1 headroom in a rare edge case; a false "definitely unreachable" would
 * reintroduce the exact regression class Codex found repeatedly on this PR
 * (a mandatory course's hours withheld from g1 forever, needlessly starving
 * electives that could otherwise fill the plan, even though the course's
 * absence is separately and honestly reported via `missingMandatory`).
 *
 * This is a reachability APPROXIMATION, not a full `validatePlanState`-grade
 * analysis (still no duplicate-placement/co-requisite reasoning) — reusing
 * that validator directly isn't possible without a circular import
 * (`planner_validate.ts` already imports `assessCompleteness` from this
 * module) or a real performance cost (`scorePlan`, which calls this, runs
 * very often during a search). `hasFittingLegalSemester`/`projectFeasibility`
 * elsewhere in this codebase make the identical tradeoff.
 */
/**
 * The latest semester index `id` could still be placed at while satisfying a
 * `beforeIndex` constraint inherited from a dependent course (or unbounded,
 * when `beforeIndex` is omitted) — the same computation `isMandatoryCourseReachable`
 * and `requiredCourseSemesterBoundaries` (below) both need: for a normal
 * course, the LATEST legal semester that also actually FITS under the
 * effective cap (the most permissive bias-reachable comparison point among
 * genuinely usable options, since the course could be placed at any ONE of
 * several) — an earlier version used the latest LEGAL semester regardless of
 * fit, so a course legal in an early-fitting semester and a later, legal-
 * but-permanently-full one reported a boundary at the later (unusable) one;
 * a dependent-of-a-dependent chain could then be offered "room" up to a
 * placement `id` itself could never actually occupy. For an `is_annual`
 * course, the EARLIEST of its required spans (it occupies every span at
 * once, so the first one is the binding constraint) — `fits` already
 * confirmed by the caller (`isMandatoryCourseReachable`'s own `fits` check,
 * before this is ever called) that EVERY span has room, so no additional
 * fit-filtering is needed here for the annual branch. Returns `undefined`
 * when there's no eligible (legal AND fitting) semester at all — callers
 * treat that as "no boundary data, bias reachable/unconstrained," never as
 * "definitely unreachable."
 */
function boundaryFor(state: PlanState, model: ConstraintModel, id: string, annualSpans: string[] | null, beforeIndex?: number): number | undefined {
  if (annualSpans && annualSpans.length) {
    const annualSpanIndices = annualSpans.map(sem => model.knownSemesterIds.indexOf(sem)).filter(i => i >= 0);
    return annualSpanIndices.length ? Math.min(...annualSpanIndices) : undefined;
  }
  const p = model.profiles.get(id);
  if (!p) return undefined;
  const cap = effectiveHardCap(model);
  const hours = p.hours ?? 0;
  const fitsSemester = (sem: string) => {
    const load = (state.semesters[sem] ?? [])
      .filter(cid => isImmovableOccupant(state, model, cid, sem))
      .reduce((s, cid) => s + (model.profiles.get(cid)?.hours ?? 0), 0);
    return load + hours <= cap;
  };
  const fittingIndices = legalSemestersOnBoard(model, id)
    .filter(sem => fitsSemester(sem) && (beforeIndex === undefined || model.knownSemesterIds.indexOf(sem) < beforeIndex))
    .map(sem => model.knownSemesterIds.indexOf(sem));
  return fittingIndices.length ? Math.max(...fittingIndices) : undefined;
}

function isMandatoryCourseReachable(
  state: PlanState,
  model: ConstraintModel,
  id: string,
  visiting: Set<string> = new Set(),
  /**
   * When set, `id` itself must be placeable strictly BEFORE this semester
   * index — the boundary a dependent course further up the recursion needs
   * `id` (as ITS prerequisite) satisfied by. An earlier version had no such
   * constraint: recursing into a not-yet-placed prerequisite only checked
   * that prerequisite's own unconstrained reachability (any legal semester
   * with room, anywhere), which could succeed via a LATER legal semester
   * even when every semester before the dependent course's own boundary was
   * permanently full — reachable in general, but not usably so for this
   * particular ordering requirement.
   */
  beforeIndex?: number,
): boolean {
  if (visiting.has(id)) return true;
  const p = model.profiles.get(id);
  if (!p) return true;
  if (isCourseExcluded(model, id)) return false;

  const cap = effectiveHardCap(model);
  const hours = p.hours ?? 0;
  const fitsSemester = (sem: string) => {
    const load = (state.semesters[sem] ?? [])
      .filter(cid => isImmovableOccupant(state, model, cid, sem))
      .reduce((s, cid) => s + (model.profiles.get(cid)?.hours ?? 0), 0);
    return load + hours <= cap;
  };
  const beforeOk = (sem: string) => beforeIndex === undefined || model.knownSemesterIds.indexOf(sem) < beforeIndex;

  const annualSpans = p.is_annual ? effectiveAnnualSpans(model, p) : null;
  const fits = annualSpans && annualSpans.length
    ? annualSpans.every(sem => model.knownSemesterIds.includes(sem) && beforeOk(sem) && fitsSemester(sem))
    : legalSemestersOnBoard(model, id).filter(beforeOk).some(fitsSemester);
  if (!fits) return false;

  if (!p.prerequisites?.length) return true;
  // For a normal course, id could be placed at ANY of its legal semesters, so
  // the latest one is the most permissive (bias-reachable) valid comparison
  // point — a prereq before it means SOME legal placement works. An
  // is_annual course has no such choice: it occupies EVERY one of its
  // annualSpans simultaneously (validatePlanProposal's strict-timing rule
  // checks each occurrence independently), including the EARLIEST one — an
  // earlier version compared against the latest legal semester even for
  // annual courses, which wrongly treated a prerequisite placed in (or
  // after) the course's own first span as "earlier enough," when
  // validatePlanState would reject that add outright (same-or-later semester
  // as the first occurrence).
  const idBoundary = boundaryFor(state, model, id, annualSpans, beforeIndex);
  if (idBoundary === undefined) return true; // fits already confirmed an eligible slot exists; bias reachable on any mismatch
  const nextVisiting = new Set(visiting);
  nextVisiting.add(id);
  const placedIds = new Set(placedCourseIds(state));
  return p.prerequisites.every(prereqId => {
    if (model.completedCourseIds.has(prereqId)) return true;
    if (model.currentlyPlannedCourseIds?.has(prereqId)) return true;
    // Already scheduled on the board — recursing into
    // isMandatoryCourseReachable here (an earlier version did) re-runs its
    // OWN fitsSemester check on prereqId as if it still needed to be ADDED,
    // double-counting its already-placed hours against its own semester's
    // cap (it's both the occupant being summed AND the course being
    // checked for room) — a real course can look permanently unreachable
    // simply because it's already legally sitting exactly where it is. But
    // "already placed" alone isn't "satisfied" — validatePlanState's strict-
    // timing rule still requires the placement to be strictly EARLIER than
    // the dependent course's own placement (an earlier version skipped this
    // check entirely once placed, which could reserve budget for a
    // mandatory course whose own prerequisite sits in the SAME or a LATER
    // semester — an add validatePlanState will always reject regardless).
    if (isFullyPlaced(state, model, placedIds, prereqId)) {
      const placedIndices = Object.entries(state.semesters)
        .filter(([, ids]) => ids.includes(prereqId))
        .map(([sem]) => model.knownSemesterIds.indexOf(sem))
        .filter(i => i >= 0);
      if (!placedIndices.length) return true; // shouldn't happen; bias reachable
      return Math.max(...placedIndices) < idBoundary;
    }
    // Codex finding on this PR (round 24): a prerequisite id with NO PROFILE
    // at all in model.profiles (a data-integrity gap — the prerequisite
    // doesn't correspond to any known course) is definitively unreachable,
    // not merely "no legality data." rawLegalSemesters returns [] for BOTH
    // cases identically, so an earlier version's "no legality data at all —
    // ambiguous, bias reachable" fallback wrongly treated a nonexistent
    // course the same as a real course with unknown offering semesters. A
    // course that doesn't exist in the model can never actually be added
    // (every placement path needs `model.profiles.get(id)`), so biasing
    // reachable here reserves a dependent mandatory course's hours forever
    // for a prerequisite that can never be satisfied — the same
    // over-reservation bug class already fixed for excluded/no-fitting-
    // semester/prerequisite-deadlock/off-board-semester courses, just
    // triggered by missing profile data instead.
    if (!model.profiles.has(prereqId)) return false;
    const rawPrereq = rawLegalSemesters(model, prereqId);
    if (!rawPrereq.length) return true; // profile exists, but declares no legality data — ambiguous, bias reachable
    const prereqIndices = rawPrereq.map(sem => model.knownSemesterIds.indexOf(sem)).filter(i => i >= 0);
    if (!prereqIndices.length) return false; // declared semester(s) exist, none are on this board
    if (Math.min(...prereqIndices) >= idBoundary) return false;
    // The prerequisite must be reachable specifically at a semester strictly
    // before idBoundary — an earlier version recursed unconstrained here, so
    // a prerequisite whose only real room was in a LATER legal semester
    // (every earlier slot permanently full) still passed as "reachable,"
    // even though that later placement can never satisfy THIS course's
    // ordering requirement. Threading idBoundary through as the recursive
    // call's own beforeIndex closes that gap.
    return isMandatoryCourseReachable(state, model, prereqId, nextVisiting, idBoundary);
  });
}

/**
 * Every course id still needed — transitively — to complete the required
 * mandatory courses: each reachable-but-unplaced mandatory course itself,
 * plus every unplaced/uncompleted PREREQUISITE standing between here and
 * placing it. A prerequisite that's just an ordinary elective on paper
 * still has to occupy a real plan slot before its dependent mandatory
 * course can legally be added (`validatePlanState`'s strict-timing rule) —
 * so it's just as required a course as the mandatory course itself, both
 * for `remainingMandatoryHours`'s reservation (below) and for
 * `planner_actions.ts`'s `enumerateActions`, which needs this SAME set to
 * enumerate ADD actions for these prerequisites unconditionally (Codex
 * finding on this PR: `enumerateActions`'s ordinary elective-fill group only
 * runs while raw degree hours are still short of the target — an existing,
 * separate gate this PR doesn't otherwise touch — so once a client-supplied
 * initial state already meets the raw target, a required-but-ordinary
 * prerequisite was never even offered as a candidate action, regardless of
 * any scoring fix; reserving its hours here alone can't fix that, since
 * scoring only ranks candidates `enumerateActions` actually produces).
 *
 * `isMandatoryCourseReachable`'s own recursion already validates that EVERY
 * course in a reachable mandatory course's prerequisite chain is itself
 * reachable (not just its direct prerequisites) — so once a top-level id
 * passes that gate, walking its chain here doesn't need to re-check
 * reachability at each step. The returned set doubles as this walk's own
 * cycle guard and de-duplicates a prerequisite required by more than one
 * mandatory course (or a course that's itself in
 * `requiredMandatoryCourseIds` and also someone else's prerequisite).
 */
export function requiredButUnplacedCourseIds(state: PlanState, model: ConstraintModel): Set<string> {
  const placed = new Set(placedCourseIds(state));
  const seen = new Set<string>();

  const visit = (id: string): void => {
    if (seen.has(id)) return;
    if (model.completedCourseIds.has(id)) return;
    if (isFullyPlaced(state, model, placed, id)) return;
    const p = model.profiles.get(id);
    if (!p) return;
    seen.add(id);
    for (const prereqId of p.prerequisites ?? []) {
      if (model.completedCourseIds.has(prereqId)) continue;
      if (model.currentlyPlannedCourseIds?.has(prereqId)) continue;
      visit(prereqId);
    }
  };

  // Slice 18A — a HARD user inclusion is a requirement in exactly the same
  // sense: it must occupy a real plan slot, its own unplaced prerequisites are
  // structurally required stepping stones, and its hours must be reserved
  // against the degree budget so an ordinary elective can't crowd it out. Seeding
  // it here is what makes `enumerateActions`' group 1b propose it (and its
  // prerequisite chain) UNCONDITIONALLY — including once raw degree hours are
  // already met, which is exactly the case the old best-effort g5 path could
  // never recover from. Deliberately NOT extended to `wantedCourseIds`, which
  // stays a soft preference and must not distort mandatory reservation scoring
  // (see PlannerWorker.recoverUnplacedWantedCourses' own docstring).
  for (const id of [...model.requiredMandatoryCourseIds, ...(model.mustIncludeCourseIds ?? [])]) {
    if (model.completedCourseIds.has(id)) continue;
    if (model.currentlyPlannedCourseIds?.has(id)) continue;
    if (isFullyPlaced(state, model, placed, id)) continue;
    if (!isMandatoryCourseReachable(state, model, id)) continue;
    visit(id);
  }
  return seen;
}

/**
 * For every course in `requiredButUnplacedCourseIds`'s set that is a
 * PREREQUISITE (not itself a top-level required-mandatory course), the
 * latest semester index it can still occupy while remaining useful to at
 * least one reachable dependent that needs it — Codex finding on this PR:
 * `enumerateActions`' unconditional prerequisite-add group (planner_actions.ts)
 * proposed an ADD action for a required prerequisite at EVERY one of its
 * legal semesters, including ones that could never satisfy any dependent's
 * strict-timing ordering (e.g. a prerequisite legal in both an early and a
 * late semester, where only the early one precedes the mandatory course that
 * needs it) — the search could then place it in a semester that "completes"
 * the ADD action but leaves the dependent mandatory course just as
 * permanently unreachable as before, having spent hours on a placement that
 * could never have helped.
 *
 * Mirrors `isMandatoryCourseReachable`'s own `beforeIndex` threading (via
 * the shared `boundaryFor` helper) so a course's boundary always reflects
 * the SAME ordering constraint reachability itself already enforces — a
 * course this function says is "useful before index N" is, by construction,
 * exactly one `isMandatoryCourseReachable` would accept as satisfying its
 * dependent at that point in the chain. When the SAME course is needed by
 * more than one reachable dependent (a shared prerequisite), the recorded
 * boundary is the SMALLEST (strictest) one seen — Codex finding on this PR:
 * an earlier version kept the LARGEST, which could offer a placement after
 * an earlier dependent's own boundary but before a later one; the course
 * only gets placed ONCE, so landing there would satisfy the later dependent
 * while permanently blocking the earlier one (worse than not offering that
 * placement at all). Taking the minimum guarantees any offered placement
 * satisfies EVERY reachable dependent that needs this course, not just one
 * of them. An id reached via multiple dependent paths RE-DESCENDS into its
 * own prerequisites every time a visit actually tightens its recorded
 * boundary (Codex finding on this PR: an earlier version recursed into a
 * shared prerequisite's own prerequisites at most once — on the FIRST visit
 * — and merely updated the recorded boundary on every later, tightening
 * visit without re-propagating it deeper. A shared intermediate prerequisite
 * `Q` first reached via a looser dependent recorded ITS OWN prerequisite
 * `P`'s boundary from that loose context; a later, stricter dependent then
 * tightened `Q`'s own boundary but — gated on "already processed" — never
 * recomputed what that tighter timing means for `P`, leaving `P`'s boundary
 * stuck at the earlier, looser (and now-wrong) value). Termination is still
 * guaranteed without a re-visit cap: `beforeIndex` is a plan-board semester
 * index, bounded below by 0, and a visit only proceeds past the "does this
 * tighten anything" check when it strictly decreases the id's own recorded
 * value — so any single id can trigger at most `knownSemesterIds.length`
 * re-descents, regardless of how many dependent paths reach it.
 * A course reached with no computable boundary (no legality data at all) is
 * left out of the map entirely — callers must treat a missing entry as
 * "unconstrained," the same bias-toward-reachable default used everywhere
 * else here, never as "definitely unreachable."
 */
export function requiredCourseSemesterBoundaries(state: PlanState, model: ConstraintModel): Map<string, number> {
  const placed = new Set(placedCourseIds(state));
  const boundaries = new Map<string, number>();

  const recordAndRecurse = (id: string, beforeIndex: number | undefined): void => {
    if (model.completedCourseIds.has(id)) return;
    if (isFullyPlaced(state, model, placed, id)) return;
    const p = model.profiles.get(id);
    if (!p) return;
    if (beforeIndex !== undefined) {
      const existing = boundaries.get(id);
      if (existing !== undefined && beforeIndex >= existing) return; // no tighter than what's already recorded — nothing new to propagate
      boundaries.set(id, beforeIndex);
    }
    if (!p.prerequisites?.length) return;
    const annualSpans = p.is_annual ? effectiveAnnualSpans(model, p) : null;
    const ownBoundary = boundaryFor(state, model, id, annualSpans, beforeIndex);
    if (ownBoundary === undefined) return;
    for (const prereqId of p.prerequisites) {
      if (model.completedCourseIds.has(prereqId)) continue;
      if (model.currentlyPlannedCourseIds?.has(prereqId)) continue;
      recordAndRecurse(prereqId, ownBoundary);
    }
  };

  // Same seeding as requiredButUnplacedCourseIds above — a hard user inclusion's
  // prerequisites need the identical ordering boundaries.
  for (const id of [...model.requiredMandatoryCourseIds, ...(model.mustIncludeCourseIds ?? [])]) {
    if (model.completedCourseIds.has(id)) continue;
    if (model.currentlyPlannedCourseIds?.has(id)) continue;
    if (isFullyPlaced(state, model, placed, id)) continue;
    if (!isMandatoryCourseReachable(state, model, id)) continue;
    recordAndRecurse(id, undefined); // the required course itself is unconstrained; only ITS prerequisites get a boundary
  }
  return boundaries;
}

/**
 * Total weekly hours needed to eventually complete every required mandatory
 * course still outstanding (see `requiredButUnplacedCourseIds`) — the
 * mandatory courses' OWN hours, plus every unplaced/uncompleted
 * prerequisite's hours (Codex finding on this PR: an earlier version only
 * reserved the mandatory course's own hours, so once ordinary electives
 * filled `degreeRequiredHours - mandatoryHours`, adding the REQUIRED
 * prerequisite looked like zero-marginal-value on score-only (no-lookahead)
 * paths — same class of myopia lookahead/rollout exists to solve elsewhere,
 * but a no-lookahead path can't see that placing the prerequisite unlocks
 * the mandatory course two steps later). Deduplicates the same way
 * `placedHours` does (a `count_hours_once` annual pair must not
 * double-count), so this stays a fair "hours still owed" figure regardless
 * of how the course is modeled.
 */
function remainingMandatoryHours(state: PlanState, model: ConstraintModel): number {
  const seenRoots = new Set<string>();
  let sum = 0;
  for (const id of requiredButUnplacedCourseIds(state, model)) {
    const p = model.profiles.get(id);
    if (!p) continue;
    if (p.count_hours_once && p.root_course_id) {
      if (seenRoots.has(p.root_course_id)) continue;
      seenRoots.add(p.root_course_id);
    }
    sum += p.hours ?? 0;
  }
  return sum;
}

/**
 * Safe lower bound for hours still structurally owed to elective categories.
 *
 * The current Mechanical Engineering program's requiring pools are pairwise
 * disjoint (enforced by academic-progress regressions), so each unmet slot
 * needs its own course. For an overlapping future program, allocation could
 * let one course satisfy more than one predicate; until that policy is typed,
 * return zero rather than double-reserve or invent an allocation.
 *
 * This is deliberately a lower bound: it reserves only the cheapest reachable
 * course hours for each remaining slot. Prerequisite hours are not guessed
 * here. Courses already reserved as mandatory/hard-included contribute zero
 * additional hours, preventing double reservation.
 */
function remainingCategoryHoursLowerBound(state: PlanState, model: ConstraintModel): number {
  const requiring = model.categories.filter(cat => cat.required > 0);
  const claimed = new Set<string>();
  for (const cat of requiring) {
    for (const id of cat.candidateIds) {
      if (claimed.has(id)) return 0; // unresolved allocation policy: fail safe
      claimed.add(id);
    }
  }

  const placed = new Set(placedCourseIds(state));
  const alreadyReserved = requiredButUnplacedCourseIds(state, model);
  const chosen: string[] = [];
  for (const cat of requiring) {
    const got = cat.candidateIds.filter(id => isFullyPlaced(state, model, placed, id)).length;
    const remaining = Math.max(0, cat.required - got);
    if (remaining === 0) continue;

    const options = cat.candidateIds
      .filter(id => !placed.has(id))
      .filter(id => !model.completedCourseIds.has(id))
      .filter(id => !model.currentlyPlannedCourseIds?.has(id))
      .filter(id => model.profiles.has(id) && isMandatoryCourseReachable(state, model, id))
      .sort((a, b) => {
        const ah = alreadyReserved.has(a) ? 0 : (model.profiles.get(a)?.hours ?? 0);
        const bh = alreadyReserved.has(b) ? 0 : (model.profiles.get(b)?.hours ?? 0);
        return ah - bh || (a < b ? -1 : a > b ? 1 : 0);
      });
    // An impossible category must not reserve the degree budget forever; its
    // authoritative validator/gate reports the actual incompleteness.
    if (options.length < remaining) continue;
    chosen.push(...options.slice(0, remaining));
  }

  const countedRoots = new Set<string>();
  let hours = 0;
  for (const id of chosen) {
    if (alreadyReserved.has(id)) continue;
    const profile = model.profiles.get(id);
    if (!profile) continue;
    if (profile.count_hours_once && profile.root_course_id) {
      if (countedRoots.has(profile.root_course_id)) continue;
      countedRoots.add(profile.root_course_id);
    }
    hours += profile.hours ?? 0;
  }
  return hours;
}

// ── HARD inclusion (`must_include_course_ids`) ───────────────────────────────

/**
 * Slice 18A — whether a hard-included course counts as SATISFIED. Deliberately
 * broader than "placed", per product policy:
 *   - already completed  → satisfied as academic history, and must NOT be
 *     re-scheduled (rule 2a already forbids that everywhere else);
 *   - currently taking   → satisfied by the same authoritative rule that forbids
 *     re-proposing it;
 *   - present in the plan → satisfied (fully placed, so an is_annual course must
 *     occupy every one of its spans — same `isFullyPlaced` gate requirements use).
 * Anything else is missing, and `validateCandidate` rejects the plan for it.
 */
export function isMustIncludeSatisfied(
  state: PlanState,
  model: ConstraintModel,
  placed: Set<string>,
  id: string,
): boolean {
  if (model.completedCourseIds.has(id)) return true;
  if (model.currentlyPlannedCourseIds?.has(id)) return true;
  return isFullyPlaced(state, model, placed, id);
}

/** Hard-included course ids not yet satisfied — the authoritative "what's missing" list. */
export function missingMustIncludeCourseIds(state: PlanState, model: ConstraintModel): string[] {
  const ids = model.mustIncludeCourseIds;
  if (!ids || ids.size === 0) return [];
  const placed = new Set(placedCourseIds(state));
  return [...ids].filter(id => !isMustIncludeSatisfied(state, model, placed, id));
}

/** How many hard-included courses are satisfied (the g2a numerator contribution). */
export function mustIncludeSatisfiedCount(state: PlanState, model: ConstraintModel): number {
  const ids = model.mustIncludeCourseIds;
  if (!ids || ids.size === 0) return 0;
  const placed = new Set(placedCourseIds(state));
  return [...ids].filter(id => isMustIncludeSatisfied(state, model, placed, id)).length;
}

export function categoriesSatisfied(state: PlanState, model: ConstraintModel): number {
  const placed = new Set(placedCourseIds(state));
  let n = 0;
  for (const cat of model.categories) {
    const got = cat.candidateIds.filter(id => isFullyPlaced(state, model, placed, id)).length;
    if (got >= cat.required) n++;
  }
  return n;
}

export function mandatoryPlaced(state: PlanState, model: ConstraintModel): number {
  const placed = new Set(placedCourseIds(state));
  return model.requiredMandatoryCourseIds.filter(id => isFullyPlaced(state, model, placed, id)).length;
}

/**
 * Lexicographic score vector (higher = better at each position), one entry per
 * goal in GOAL_STACK order.
 */
export function scorePlan(state: PlanState, model: ConstraintModel): number[] {
  const loads = semesterLoads(state, model);

  // 1. degree completion — credit toward the requirement, capped at a budget
  //    that RESERVES hours for mandatory courses not yet placed:
  //    budget = degreeRequiredHours - remainingMandatoryHours(state).
  //
  //    Without this reservation, g1 is just min(dh, degreeRequiredHours) —
  //    every legal action's marginal credit is its raw added hours, so a
  //    step comparing "add a 4h elective" vs. "add a 2h mandatory course"
  //    always prefers the elective (bigger g1 delta), regardless of goal 2a
  //    (requirements_mandatory), because g1 outranks it lexicographically.
  //    The search can then spend the whole degree-hours budget on electives
  //    before a single pending mandatory course is placed, and once it does
  //    need to place the deferred mandatory courses, their hours land on TOP
  //    of the already-filled target — inflating the final plan beyond
  //    degreeRequiredHours (issue #25 Finding #4: 203h against a 185h
  //    target, every semester pinned near the hard cap).
  //
  //    Reserving remainingMandatoryHours fixes this at the source: an
  //    elective's marginal g1 credit is clipped to whatever budget room is
  //    left once every still-unplaced mandatory course's hours are set
  //    aside, so it can never outrank placing the mandatory course itself.
  //    Once every mandatory course is placed, remainingMandatoryHours is 0
  //    and this is byte-identical to the original formula — so a fully-built
  //    valid plan's score (and every test that only scores DONE states) is
  //    completely unaffected; only mid-search ranking among partial states
  //    with a pending mandatory course changes.
  //
  //    Known, investigated limitation (Codex finding on this PR, round 23):
  //    a MOVE that repairs a misplaced prerequisite and makes a previously-
  //    UNREACHABLE mandatory course newly reachable can make g1 drop —
  //    remainingMandatoryHours only reserves for a REACHABLE course
  //    (deliberately, to avoid over-reserving for a permanently-blocked one;
  //    see remainingMandatoryHours's own docstring), so crossing that
  //    reachability threshold flips its hours from unreserved to reserved in
  //    one step, shrinking the budget with no offsetting g2a credit yet
  //    (the course is reachable now, not placed yet). In a no-lookahead/
  //    zero-rollout configuration (`PlannerWorker`'s `{ lookahead: false }`
  //    or `rolloutSteps: 0` — used only by this file's own isolated-
  //    mechanism unit tests, never by any production caller: confirmed via
  //    grep, no `generate-plan.ts`/`planner-run.ts`/`PlannerAgent` call site
  //    disables lookahead), `step()`'s immediate-score-only "does this
  //    advance" gate can reject that repair outright, leaving the mandatory
  //    course permanently missing even though the repair was available.
  //    Empirically verified this is NOT reproducible under either the bare
  //    `PlannerWorker` default (`{ topN: 8, rolloutSteps: 200 }`) OR — this
  //    matters more, since it's what real traffic actually runs — the
  //    ACTUAL production configuration every caller constructs explicitly:
  //    `{ topN: 6, rolloutSteps: 80 }` (`generate-plan.ts`'s primary worker
  //    and its fallback, and `planner-run.ts`'s worker — a tighter topN and
  //    a shorter rollout than the bare default, so the more adversarial
  //    configuration to verify against, not a looser one; a first pass of
  //    this investigation only checked the bare default and was corrected by
  //    a Codex finding on PR #55, the docs PR recording this fix's merge).
  //    `PlannerWorker.run()` correctly recovers and places the mandatory
  //    course under `{ topN: 6, rolloutSteps: 80 }` in both a minimal repro
  //    and an adversarial one (15 competing higher-immediate-score elective
  //    actions crowding the repair move out of the top-N truncation) — the
  //    rollout's `estimateFinalScore` still discovers that placing the
  //    mandatory course afterward yields a strictly better g2a at an
  //    equal-or-better final g1, which decides via
  //    `compareScore(x.fin, curFinal)` even though `x.imm` alone regressed.
  //    Not fixed: a general fix needs the no-lookahead greedy step itself to
  //    tolerate a strictly-necessary repair despite a local g1 dip, which is
  //    a change to the search's core accept-if-strictly-improves invariant —
  //    a materially different and riskier change than this reservation
  //    mechanism, and moot for every real caller today.
  const dh = degreeHours(state, model);
  const budget = model.degreeRequiredHours
    - remainingMandatoryHours(state, model)
    - remainingCategoryHoursLowerBound(state, model);
  const g1 = Math.min(dh, budget);

  // 2a. requirements (mandatory + HARD user inclusions) — fraction satisfied.
  //
  //     Slice 18A: a `must_include` course is a REQUIREMENT, not a preference,
  //     so it shares this slot with the degree's own mandatory courses rather
  //     than the tradeable g5 preferences slot below. This is only a SEARCH
  //     GRADIENT (it gives the greedy loop a reason to place the course);
  //     the authoritative, non-tradeable enforcement is validateCandidate's
  //     missingMustInclude gate, which rejects the plan outright no matter how
  //     high any score is. With no hard inclusions the arithmetic is
  //     byte-identical to before.
  const mandTotal = model.requiredMandatoryCourseIds.length;
  const hardIncludeTotal = model.mustIncludeCourseIds?.size ?? 0;
  const reqTotal = mandTotal + hardIncludeTotal;
  const g2a = reqTotal > 0
    ? (mandatoryPlaced(state, model) + mustIncludeSatisfiedCount(state, model)) / reqTotal
    : 1;

  // 2b. requirements (categories) — fraction of categories satisfied.
  const catTotal = model.categories.length;
  const g2b = catTotal > 0 ? categoriesSatisfied(state, model) / catTotal : 1;

  // 3. legality — penalize semesters over the hard cap and over the user cap.
  const overHard = loads.filter(h => h > model.hardCap).length;
  const overUser = loads.filter(h => h > model.maxHoursPerSemester).length;
  const g3 = -(overHard * 10 + overUser);

  // 4a. balance (peak) — minimize the heaviest semester's load (minimum user
  //     burden). Peak is taken over ALL semesters (empty ones count as 0), so a
  //     plan that opens a lighter/empty semester to reduce the busiest semester
  //     scores better than one that consolidates onto an already-heavy semester
  //     (e.g. [16,4] peak 16 beats [20,0] peak 20). Over-cap is still handled at
  //     the higher-priority g3, so this only ranks otherwise-legal plans.
  // Slice 17A — semester-distribution policy (owns g4a/g4b ONLY). 'neutral'
  // (default) and 'balanced' keep the legacy peak-then-spread preference;
  // 'compact' rewards fewer ACTIVE (non-empty) periods — an order-invariant
  // consolidation metric that never rewards an earlier period / lower index /
  // period id (activeCount is invariant under period renaming/reordering). This
  // slot sits BELOW completion (g1), requirements (g2a/g2b), and legality (g3),
  // so the policy can never override any higher-priority objective.
  const activeLs = loads.filter(h => h > 0);
  const spread = activeLs.length > 1 ? Math.max(...activeLs) - Math.min(...activeLs) : 0;
  const g4a =
    model.distributionPolicy === 'compact'
      ? -activeLs.length // fewer occupied periods preferred (consolidation)
      : (loads.length ? -Math.max(...loads) : 0); // legacy: lower peak preferred

  // 4b. balance (spread) — secondary tiebreak. Under 'balanced'/'neutral' it is
  //     the legacy spread tiebreak among equal-peak plans; under 'compact' it is
  //     the SAME deterministic spread tiebreak among equal active-count plans
  //     (a legacy tiebreak, not a compact-policy preference). Order-invariant.
  const g4b = -spread;

  // 5. preferences — wanted courses placed.
  const placed = new Set(placedCourseIds(state));
  const g5 = [...model.wantedCourseIds].filter(id => placed.has(id)).length;

  // 5b. unwanted avoidance — penalise each unwanted course placed.
  const g5b = -[...placed].filter(id => model.profiles.get(id)?.is_unwanted).length;

  // 5c. interest fit — SOFT general user-fit: total per-course fit score of the
  //     placed courses, for the requested focus area(s)/style(s). Ranked below
  //     explicit wanted/unwanted preferences and above the difficulty tiebreak,
  //     so among equally-legal, equally-complete plans it prefers the one whose
  //     ELECTIVE choices are more aligned — never overriding legality,
  //     completion, or an explicit preference. Zero (inert) when no fit map is
  //     supplied, so control plans are byte-identical to before.
  let gFit = 0;
  if (model.courseFitById) for (const cid of placed) gFit += model.courseFitById.get(cid) ?? 0;

  // 6. difficulty / comfort — lower total difficulty preferred (tiebreaker).
  let totalDifficulty = 0;
  for (const cid of placed) totalDifficulty += model.profiles.get(cid)?.difficulty_score ?? 0;
  const g6 = -totalDifficulty;

  return [g1, g2a, g2b, g3, g4a, g4b, g5, g5b, gFit, g6];
}

export interface CompletenessAssessment {
  degreeHours: number;
  degreeMet: boolean;
  /** requiredMandatoryCourseIds not yet placed (and not already completed). */
  missingMandatory: string[];
  /** category ids whose placed-candidate count is below their required count. */
  unsatisfiedCategories: string[];
  /** semester ids whose total placed hours exceed model.hardCap. */
  overCapSemesters: string[];
  /**
   * Ids of placed `is_annual` courses not yet occupying every one of their
   * effective spans. A mandatory or category-candidate annual course already
   * surfaces here indirectly (via missingMandatory/unsatisfiedCategories,
   * since isFullyPlaced backs both), but a plain-elective annual course has
   * no other completeness signal — without this, a search/loop driven only
   * by degreeMet/missingMandatory/unsatisfiedCategories/overCapSemesters
   * would consider the goal reached with the course still split.
   */
  incompleteAnnual: string[];
  /**
   * Slice 18A — hard-included (`must_include`) course ids not satisfied by
   * completion, currently-taking status, or an actual placement. A plan with a
   * non-empty list here is NEVER valid, whatever it scores.
   */
  missingMustInclude: string[];
}

/**
 * Ids of every placed `is_annual` course that doesn't yet occupy every one of
 * its effective spans (see isFullyPlaced) — a partial placement that still
 * needs repairing, regardless of whether the course is mandatory, a category
 * candidate, wanted, or a plain elective. Shared by assessCompleteness below
 * and PlannerWorker's own goal/repair logic (planner_worker.ts), so both
 * agree on exactly what counts as an unfinished annual placement.
 */
export function incompleteAnnualCourseIds(state: PlanState, model: ConstraintModel): string[] {
  const placed = new Set(placedCourseIds(state));
  const out: string[] = [];
  for (const id of placed) {
    const p = model.profiles.get(id);
    if (p?.is_annual && !isFullyPlaced(state, model, placed, id)) out.push(id);
  }
  return out;
}

/**
 * The shared degree-completion judgment — the single source of truth for
 * "what's missing" behind both TauPolicyProvider.isGoal (a boolean derived
 * from this) and validateCandidate's CandidateReport (the detailed gaps).
 * Pure: no I/O, no mutation.
 */
export function assessCompleteness(state: PlanState, model: ConstraintModel): CompletenessAssessment {
  const placed = new Set(placedCourseIds(state));

  const dh = degreeHours(state, model);
  const degreeMet = dh >= model.degreeRequiredHours;

  const missingMandatory = model.requiredMandatoryCourseIds.filter(
    id => !isFullyPlaced(state, model, placed, id) && !model.completedCourseIds.has(id),
  );

  const unsatisfiedCategories = model.categories
    .filter(cat => cat.candidateIds.filter(id => isFullyPlaced(state, model, placed, id)).length < cat.required)
    .map(cat => cat.id);

  // Phase 2C overload override — must agree with plan_validation.ts's policy:
  // hours > ABSOLUTE_MAX_REASONABLE always blocks; hours > model.hardCap only
  // blocks when the user hasn't explicitly confirmed the overload.
  const overloadConfirmed = model.overloadAccepted === true && !!model.overloadConfirmedAt;
  const absoluteMaxReasonable = model.absoluteMaxReasonable ?? ABSOLUTE_MAX_REASONABLE;
  const overCapSemesters = model.knownSemesterIds.filter(sem => {
    const hours = (state.semesters[sem] ?? []).reduce((s, c) => s + (model.profiles.get(c)?.hours ?? 0), 0);
    if (hours > absoluteMaxReasonable) return true;
    if (hours > model.hardCap && !overloadConfirmed) return true;
    return false;
  });

  const incompleteAnnual = incompleteAnnualCourseIds(state, model);
  const missingMustInclude = missingMustIncludeCourseIds(state, model);

  return { degreeHours: dh, degreeMet, missingMandatory, unsatisfiedCategories, overCapSemesters, incompleteAnnual, missingMustInclude };
}

/** Compare two score vectors lexicographically: >0 if a is better than b. */
export function compareScore(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Apply a mutation to a cloned state (no validation — the worker validates).
 * Returns the new state, or null if the mutation is structurally impossible.
 * Pure: used by scoreAction and lookahead rollouts.
 */
export function applyMutation(state: PlanState, mut: PlannerMutation): PlanState | null {
  if (mut.type === 'STOP') return cloneState(state);
  const next = cloneState(state);
  const removeEverywhere = (id: string) => {
    for (const sem of Object.keys(next.semesters)) {
      next.semesters[sem] = next.semesters[sem].filter(c => c !== id);
    }
  };
  switch (mut.type) {
    case 'ADD_COURSE': {
      const targets = [mut.semesterId, ...(mut.alsoSemesterIds ?? [])];
      if (targets.some(sem => !next.semesters[sem])) return null;
      // A course already placed OUTSIDE the target set can't legally be
      // "added" here (that would require a move, not an add). A course
      // already present in EVERY target is a true no-op. Otherwise — not
      // placed at all, or (an is_annual course with alsoSemesterIds) placed
      // in only SOME of its own targets already, e.g. stale data predating
      // atomic annual placement — fill in whichever targets are still
      // missing, without duplicating ones already there.
      const currentSems = Object.entries(next.semesters)
        .filter(([, ids]) => ids.includes(mut.courseId))
        .map(([sem]) => sem);
      if (currentSems.some(sem => !targets.includes(sem))) return null;
      if (targets.every(sem => currentSems.includes(sem))) return null;
      for (const sem of targets) {
        if (!next.semesters[sem].includes(mut.courseId)) next.semesters[sem].push(mut.courseId);
      }
      return next;
    }
    case 'REMOVE_COURSE':
      if (!placedCourseIds(next).includes(mut.courseId)) return null;
      removeEverywhere(mut.courseId);
      return next;
    case 'MOVE_COURSE': {
      if (!placedCourseIds(next).includes(mut.courseId)) return null;
      if (!next.semesters[mut.toSemester]) return null;
      removeEverywhere(mut.courseId);
      next.semesters[mut.toSemester].push(mut.courseId);
      return next;
    }
    case 'REPLACE_COURSE': {
      if (!placedCourseIds(next).includes(mut.outId)) return null;
      if (placedCourseIds(next).includes(mut.inId)) return null;
      if (!next.semesters[mut.semesterId]) return null;
      removeEverywhere(mut.outId);
      next.semesters[mut.semesterId].push(mut.inId);
      return next;
    }
  }
}

/**
 * Marginal goal-advancement of an action: the lexicographic delta between the
 * resulting plan's score and the current plan's score. Higher = more advancing.
 * (Used as the immediate term; the worker adds a downstream/lookahead term for
 * the top candidates.)
 */
export function scoreAction(mut: PlannerMutation, model: ConstraintModel, state: PlanState): number[] {
  const before = scorePlan(state, model);
  const nextState = applyMutation(state, mut);
  if (!nextState) return GOAL_STACK.map(() => -Infinity);
  const after = scorePlan(nextState, model);
  return after.map((v, i) => v - (before[i] ?? 0));
}
