/**
 * Slice 18A — HARD constraint policy: the typed vocabulary, the feature switch,
 * and the DETERMINISTIC infeasibility/contradiction analysis that runs BEFORE
 * planning.
 *
 * Product policy (binding):
 *   - `must_include_course_ids` — every course selected in the user-facing
 *     "wanted" picker. Hard: a plan that does not satisfy one is invalid.
 *   - `must_exclude_course_ids` — every course selected in the "avoided" picker.
 *     Hard: modelled by `ConstraintModel.disallowedCourseIds`, already enforced
 *     at enumeration AND validation.
 *   - `prefer_course_ids` / `deprioritize_course_ids` — the SOFT channels
 *     (`wantedCourseIds` / `is_unwanted`). Retained for backward compatibility;
 *     the hard pickers never feed them.
 *
 * When a hard constraint cannot be satisfied we do NOT return a degraded
 * best-effort plan. `analyzeHardConstraints` returns a typed, deterministic
 * outcome with stable reason codes, the affected course ids, the conflicting
 * constraints/facts, a concise Hebrew explanation, the safe user-resolvable
 * actions where any exist, and an authoritative/non-answerable flag — the
 * student is never asked to adjudicate which authoritative catalog fact is true.
 *
 * Pure: no I/O, no LLM, no mutation. Same model in ⇒ byte-identical outcome out.
 */

import { getLegalSemesters, type CourseLegalityInfo } from './completion_analysis';
import { ABSOLUTE_MAX_REASONABLE } from './load_constants';
import type { ConstraintModel } from './planner_types';

// ── feature switch ───────────────────────────────────────────────────────────

/**
 * Whether the user-facing wanted/avoided pickers carry HARD semantics (current
 * product policy, the default) or the LEGACY best-effort `g5` semantics.
 *
 * Flag-off contract, explicitly: `AI_HARD_WANTED_CONSTRAINTS=false` routes the
 * wanted picker back to `wantedCourseIds` (soft, tradeable, scored at g5) and
 * produces NO `mustIncludeCourseIds` — every scoring, validation and search path
 * is then byte-identical to the pre-Slice-18 behavior, because each of them is
 * gated on `mustIncludeCourseIds` being non-empty. The avoided picker is
 * unaffected either way: `must_exclude` was already hard.
 */
export function hardWantedConstraintsEnabled(): boolean {
  return process.env.AI_HARD_WANTED_CONSTRAINTS !== 'false';
}

// ── typed outcome ────────────────────────────────────────────────────────────

/** Stable, machine-readable reason codes. Never renamed once shipped. */
export const HARD_CONSTRAINT_REASON_CODES = [
  'wanted_and_avoided_conflict',
  'wanted_course_not_in_catalog',
  'wanted_course_unavailable_in_horizon',
  'wanted_prerequisite_impossible',
  'avoided_mandatory_conflict',
  'wanted_exceeds_workload_cap',
  'completed_status_contradiction',
] as const;
export type HardConstraintReasonCode = (typeof HARD_CONSTRAINT_REASON_CODES)[number];

export interface HardConstraintReason {
  code: HardConstraintReasonCode;
  /** The affected course ids, sorted — deterministic across runs. */
  courseIds: string[];
  /** Which constraints/authoritative facts collide (e.g. must_include + must_exclude). */
  conflictingConstraints: string[];
  /** Concise Hebrew explanation, factual — never a suggestion to guess. */
  messageHe: string;
  /**
   * True when the conflict is with an AUTHORITATIVE fact (catalog membership,
   * offering periods, prerequisite structure, mandatory status). The student is
   * never asked to decide which authoritative fact is true — such a reason is
   * non-answerable and carries only "change your own request" actions, if any.
   * False when the contradiction is between the user's OWN two selections.
   */
  authoritative: boolean;
  /** Safe actions the USER can take. Empty when nothing the user controls can resolve it. */
  resolvableActions: string[];
}

export interface HardConstraintOutcome {
  outcome: 'feasible' | 'infeasible';
  /** Always false for an infeasible outcome — never a degraded best-effort plan. */
  applyEligible: boolean;
  reasons: HardConstraintReason[];
}

// ── helpers ──────────────────────────────────────────────────────────────────

function nameOf(model: ConstraintModel, id: string): string {
  return model.profiles.get(id)?.name_he ?? id;
}

function effectiveCap(model: ConstraintModel): number {
  const confirmed = model.overloadAccepted === true && !!model.overloadConfirmedAt;
  return confirmed ? (model.absoluteMaxReasonable ?? ABSOLUTE_MAX_REASONABLE) : model.hardCap;
}

/**
 * The DECLARED legal semesters for `id`, unfiltered and un-defaulted — the raw
 * form needed to tell "no legality data at all" (ambiguous, every period is
 * implicitly allowed) apart from "declares periods, none of which exist on this
 * board" (definitively unavailable). Mirrors planner_goals.ts's own
 * `rawLegalSemesters`, duplicated rather than exported from there to keep this
 * pre-planning analysis free of any dependency on the scoring module.
 */
function declaredSemesters(model: ConstraintModel, id: string): string[] {
  const p = model.profiles.get(id);
  if (!p) return [];
  return getLegalSemesters(p as CourseLegalityInfo, model.knownSemesterIds).semesters;
}

/** `id`'s usable periods on THIS board, defaulted to the whole board when nothing is declared. */
function periodsOnBoard(model: ConstraintModel, id: string): string[] {
  const raw = declaredSemesters(model, id);
  return (raw.length ? raw : model.knownSemesterIds).filter(sem => model.knownSemesterIds.includes(sem));
}

function isHardExcluded(model: ConstraintModel, id: string): boolean {
  return model.disallowedCourseIds.has(id) || model.profiles.get(id)?.excluded === true;
}

/**
 * Whether `id`'s prerequisite chain can be satisfied at all within the planning
 * horizon, ignoring load (that is `wanted_exceeds_workload_cap`'s job). A
 * prerequisite is impossible when it isn't in the catalog, is hard-excluded, has
 * no period on this board, or has no period strictly before its dependent's
 * LATEST usable period (the most permissive comparison point, so this only
 * reports a chain it can affirmatively prove is unsatisfiable). Already-completed
 * and currently-taking prerequisites are satisfied outright. `visiting` guards a
 * prerequisite cycle by biasing toward possible — a data problem this analysis
 * is not responsible for diagnosing.
 */
function prerequisiteChainImpossible(
  model: ConstraintModel,
  id: string,
  visiting: Set<string> = new Set(),
  beforeIndex?: number,
): boolean {
  if (visiting.has(id)) return false;
  const p = model.profiles.get(id);
  if (!p) return true;
  const idx = periodsOnBoard(model, id)
    .map(sem => model.knownSemesterIds.indexOf(sem))
    .filter(i => i >= 0 && (beforeIndex === undefined || i < beforeIndex));
  if (!idx.length) return true;
  const latest = Math.max(...idx);

  const next = new Set(visiting);
  next.add(id);
  return (p.prerequisites ?? []).some(prereqId => {
    if (model.completedCourseIds.has(prereqId)) return false;
    if (model.currentlyPlannedCourseIds?.has(prereqId)) return false;
    if (!model.profiles.has(prereqId)) return true;
    if (isHardExcluded(model, prereqId)) return true;
    return prerequisiteChainImpossible(model, prereqId, next, latest);
  });
}

// ── analysis ─────────────────────────────────────────────────────────────────

/**
 * Deterministic pre-planning analysis of the model's HARD constraints. Reasons
 * are emitted in a fixed order (by code, then by course id) so repeated runs on
 * the same model produce a byte-identical outcome.
 *
 * Deliberately NOT reported as a conflict: an already-completed course that is
 * also hard-excluded. Exclusion governs FUTURE scheduling, and the completed
 * course is never re-scheduled, so no violation exists — while the historical
 * status stays truthful and untouched.
 */
export function analyzeHardConstraints(model: ConstraintModel): HardConstraintOutcome {
  const mustInclude = [...(model.mustIncludeCourseIds ?? [])].sort();
  const reasons: HardConstraintReason[] = [];
  const push = (r: HardConstraintReason) => reasons.push(r);

  // 1. The user's own two selections contradict each other. Not authoritative —
  //    the user can resolve it directly, and we must not silently pick a winner.
  for (const id of mustInclude) {
    if (!model.disallowedCourseIds.has(id)) continue;
    push({
      code: 'wanted_and_avoided_conflict',
      courseIds: [id],
      conflictingConstraints: ['must_include', 'must_exclude'],
      messageHe: `הקורס "${nameOf(model, id)}" מסומן גם כקורס שביקשת לשלב וגם כקורס שביקשת להימנע ממנו — לא ניתן לקיים את שתי הדרישות יחד.`,
      authoritative: false,
      resolvableActions: ['הסרת הקורס מרשימת הקורסים המבוקשים', 'הסרת הקורס מרשימת הקורסים להימנעות'],
    });
  }

  // 2-5. Authoritative catalog facts. Non-answerable: we state the fact and offer
  //      only actions over the user's OWN request, never a "which fact is true?".
  for (const id of mustInclude) {
    if (model.disallowedCourseIds.has(id)) continue; // already reported above
    if (!model.profiles.has(id)) {
      push({
        code: 'wanted_course_not_in_catalog',
        courseIds: [id],
        conflictingConstraints: ['must_include', 'catalog_membership'],
        messageHe: `הקורס "${id}" אינו קיים בקטלוג של התוכנית ולכן לא ניתן לשבצו.`,
        authoritative: true,
        resolvableActions: ['הסרת הקורס מרשימת הקורסים המבוקשים'],
      });
      continue;
    }
    // Satisfied by academic history / current registration — no scheduling needed,
    // so no availability, prerequisite or load question arises.
    if (model.completedCourseIds.has(id) || model.currentlyPlannedCourseIds?.has(id)) continue;

    // The course exists but has no SOUND catalog record (course_profile.ts
    // excludes a course missing a verified Hebrew name or a verified weekly-hours
    // credit value), so it can never be legally placed. The user-exclusion case
    // of `excluded` was already reported as a contradiction above and skipped, so
    // reaching here means a catalog-integrity gap. Reported rather than silently
    // dropped: a hard inclusion that cannot be honored must always be explained.
    const profile = model.profiles.get(id)!;
    if (profile.excluded === true) {
      push({
        code: 'wanted_course_not_in_catalog',
        courseIds: [id],
        conflictingConstraints: ['must_include', 'catalog_integrity'],
        messageHe: `לקורס "${nameOf(model, id)}" אין רשומת קטלוג תקינה ולכן לא ניתן לשבצו: ${profile.exclusion_reason ?? 'חסרים פרטי קטלוג מאומתים.'}`,
        authoritative: true,
        resolvableActions: ['הסרת הקורס מרשימת הקורסים המבוקשים'],
      });
      continue;
    }

    const periods = periodsOnBoard(model, id);
    if (!periods.length) {
      push({
        code: 'wanted_course_unavailable_in_horizon',
        courseIds: [id],
        conflictingConstraints: ['must_include', 'offering_periods'],
        messageHe: `הקורס "${nameOf(model, id)}" אינו נפתח באף אחת מהתקופות שבטווח התכנון.`,
        authoritative: true,
        resolvableActions: ['הסרת הקורס מרשימת הקורסים המבוקשים', 'הרחבת טווח התכנון'],
      });
      continue;
    }

    if (prerequisiteChainImpossible(model, id)) {
      push({
        code: 'wanted_prerequisite_impossible',
        courseIds: [id],
        conflictingConstraints: ['must_include', 'prerequisites'],
        messageHe: `לקורס "${nameOf(model, id)}" יש שרשרת קדם שלא ניתן להשלים בטווח התכנון.`,
        authoritative: true,
        resolvableActions: ['הסרת הקורס מרשימת הקורסים המבוקשים', 'הרחבת טווח התכנון'],
      });
      continue;
    }

    // Every legal placement breaches the hard load cap even on an EMPTY plan —
    // a permanent, deterministic impossibility, not a crowding accident.
    const hours = model.profiles.get(id)?.hours ?? 0;
    if (hours > effectiveCap(model)) {
      push({
        code: 'wanted_exceeds_workload_cap',
        courseIds: [id],
        conflictingConstraints: ['must_include', 'hard_workload_cap'],
        messageHe: `הקורס "${nameOf(model, id)}" דורש ${hours} ש"ש — מעל מגבלת העומס הקשיחה (${effectiveCap(model)}) בכל תקופה אפשרית.`,
        authoritative: true,
        resolvableActions: ['הסרת הקורס מרשימת הקורסים המבוקשים', 'אישור חריגה בעומס'],
      });
    }
  }

  // 6. An excluded MANDATORY course — the degree requires it, the user forbade it.
  for (const id of [...model.disallowedCourseIds].sort()) {
    if (!model.requiredMandatoryCourseIds.includes(id)) continue;
    push({
      code: 'avoided_mandatory_conflict',
      courseIds: [id],
      conflictingConstraints: ['must_exclude', 'mandatory_course'],
      messageHe: `הקורס "${nameOf(model, id)}" הוא קורס חובה בתוכנית ולכן לא ניתן להימנע ממנו ולהשלים את התואר.`,
      authoritative: true,
      resolvableActions: ['הסרת הקורס מרשימת הקורסים להימנעות'],
    });
  }

  // 7. Two supplied academic-status facts contradict each other.
  for (const id of [...(model.currentlyPlannedCourseIds ?? [])].sort()) {
    if (!model.completedCourseIds.has(id)) continue;
    push({
      code: 'completed_status_contradiction',
      courseIds: [id],
      conflictingConstraints: ['completed_status', 'currently_taking_status'],
      messageHe: `הקורס "${nameOf(model, id)}" מסומן גם כקורס שהושלם וגם כקורס שנלמד כעת — שני המצבים אינם יכולים להתקיים יחד.`,
      authoritative: false,
      resolvableActions: ['עדכון סטטוס הקורס לאחת מהאפשרויות בלבד'],
    });
  }

  reasons.sort((a, b) =>
    a.code < b.code ? -1 : a.code > b.code ? 1 : a.courseIds.join() < b.courseIds.join() ? -1 : 1,
  );

  return {
    outcome: reasons.length ? 'infeasible' : 'feasible',
    applyEligible: reasons.length === 0,
    reasons,
  };
}
