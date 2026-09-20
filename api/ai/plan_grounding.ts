/**
 * plan_grounding.ts — deterministic, plan-inert academic-fact grounding over a
 * generated plan, the Knowledge-Grounding layer the AcademicDecisionAgent path
 * reasons over (invoked from academic_decision_integration.ts on the flagged
 * native Generate path). It NEVER mutates the plan, invents a fact, calls an
 * LLM, or touches I/O — it only reads the ConstraintModel the plan was built
 * from plus the user's asserted completion state, and classifies what is
 * actually known.
 *
 * Every placed course's facts are classified by epistemic status:
 *   - known       — hours and semester availability are both present, from a
 *                   confident source.
 *   - unknown     — a required fact is missing (null hours, or null semester
 *                   availability) — the grounding says so instead of guessing.
 *   - inferred    — fully specified but from a low-confidence / derived source
 *                   (data_confidence below the confident threshold).
 *   - conflicting — two sources disagree (see `conflicts`).
 *
 * Conflicts surfaced (structured, so validation/clarification can consume them):
 *   - catalog_vs_normalized_availability — the raw catalog `offered_semesters`
 *     and the normalized `effective_allowed_semesters` are both present but
 *     share no semester: the two data layers disagree about when the course is
 *     available, and the grounding must not silently pick one.
 *   - user_assertion_vs_plan — a course the user asserts they already COMPLETED
 *     is nonetheless placed in the plan: the user assertion and the plan
 *     disagree about the course's status.
 */

import type { ConstraintModel, PlanState } from './planner_types';
import { placedCourseIds } from './planner_types';
import type { CourseProfile } from './course_profile';
import { mapOfferedToKnownSemesters } from './semester_availability';

/** Below this aggregate data_confidence, a fully-specified fact is treated as inferred, not known. */
const CONFIDENT_THRESHOLD = 0.5;

export type GroundedFactStatus = 'known' | 'unknown' | 'inferred' | 'conflicting';

export type GroundingConflictKind =
  | 'catalog_vs_normalized_availability'
  | 'user_assertion_vs_plan';

export interface GroundingConflict {
  courseId: string;
  kind: GroundingConflictKind;
  detail: string;
}

export interface GroundedCourseFact {
  courseId: string;
  status: GroundedFactStatus;
  facts: {
    hours: number | null;
    /** Normalized semester availability (effective_allowed_semesters). */
    semesterAvailability: string[] | null;
    prerequisites: string[];
  };
  provenance: {
    source: string | null;
    dataQuality: string | null;
    confidence: number;
  };
  /** Human-facing reason the status is not "known" (absent for known facts). */
  note?: string;
}

export interface PlanGrounding {
  facts: GroundedCourseFact[];
  counts: Record<GroundedFactStatus, number>;
  conflicts: GroundingConflict[];
}

/** Input to the grounding stage — the Observe model + the generated plan. */
export interface GroundingInput {
  model: ConstraintModel;
  plan: PlanState;
  completedCourseIds?: Iterable<string>;
}

/**
 * Narrow capability contract for the AcademicDecisionAgent's class-native
 * Ground stage. Pure and plan-inert by contract — an implementation must never
 * mutate the plan, planner input, or semester assignments.
 */
export interface GroundingCapability {
  ground(input: GroundingInput): PlanGrounding;
}

/** Default grounding: delegates to the deterministic, plan-inert groundPlan. */
export class PlanGroundingCapability implements GroundingCapability {
  ground(input: GroundingInput): PlanGrounding {
    return groundPlan(input.model, input.plan, { completedCourseIds: input.completedCourseIds });
  }
}

/** An empty grounding — used when no plan exists (e.g. the blocked/failed path). */
export const EMPTY_GROUNDING: PlanGrounding = {
  facts: [],
  counts: { known: 0, unknown: 0, inferred: 0, conflicting: 0 },
  conflicts: [],
};

function detectConflicts(
  courseId: string,
  p: CourseProfile,
  completed: Set<string>,
): GroundingConflict[] {
  const conflicts: GroundingConflict[] = [];
  const offered = p.offered_semesters;
  const effective = p.effective_allowed_semesters;
  if (offered && offered.length > 0 && effective && effective.length > 0) {
    const normalizedOffered = mapOfferedToKnownSemesters(offered, effective);
    const overlap = normalizedOffered.some((s) => effective.includes(s));
    if (!overlap) {
      conflicts.push({
        courseId,
        kind: 'catalog_vs_normalized_availability',
        detail: `catalog offers [${offered.join(', ')}] but normalized availability is [${effective.join(', ')}] — no shared semester`,
      });
    }
  }
  if (completed.has(courseId)) {
    conflicts.push({
      courseId,
      kind: 'user_assertion_vs_plan',
      detail: 'marked completed by the student, yet placed in the generated plan',
    });
  }
  return conflicts;
}

/**
 * Ground the facts of every course PLACED in `plan`. Pure and plan-inert.
 * `opts.completedCourseIds` defaults to `model.completedCourseIds`.
 */
export function groundPlan(
  model: ConstraintModel,
  plan: PlanState,
  opts: { completedCourseIds?: Iterable<string> } = {},
): PlanGrounding {
  const completed = new Set(opts.completedCourseIds ?? model.completedCourseIds);
  const counts: Record<GroundedFactStatus, number> = { known: 0, unknown: 0, inferred: 0, conflicting: 0 };
  const facts: GroundedCourseFact[] = [];
  const conflicts: GroundingConflict[] = [];

  for (const courseId of placedCourseIds(plan)) {
    const p = model.profiles.get(courseId);
    if (!p) {
      // A placed id with no profile is itself a missing-data fact, not a fabrication.
      const fact: GroundedCourseFact = {
        courseId,
        status: 'unknown',
        facts: { hours: null, semesterAvailability: null, prerequisites: [] },
        provenance: { source: null, dataQuality: null, confidence: 0 },
        note: 'no course profile available in the model',
      };
      facts.push(fact);
      counts.unknown++;
      continue;
    }

    const courseConflicts = detectConflicts(courseId, p, completed);
    conflicts.push(...courseConflicts);

    let status: GroundedFactStatus;
    let note: string | undefined;
    if (courseConflicts.length > 0) {
      status = 'conflicting';
      note = courseConflicts.map((c) => c.detail).join('; ');
    } else if (p.hours == null) {
      status = 'unknown';
      note = 'weekly hours unknown';
    } else if (p.effective_allowed_semesters == null) {
      status = 'unknown';
      note = 'semester availability unknown';
    } else if (p.data_confidence < CONFIDENT_THRESHOLD) {
      status = 'inferred';
      note = `low data confidence (${p.data_confidence})`;
    } else {
      status = 'known';
    }

    facts.push({
      courseId,
      status,
      facts: {
        hours: p.hours ?? null,
        semesterAvailability: p.effective_allowed_semesters,
        prerequisites: p.prerequisites ?? [],
      },
      provenance: {
        source: p.provenance?.source ?? null,
        dataQuality: p.provenance?.data_quality ?? null,
        confidence: p.data_confidence,
      },
      ...(note ? { note } : {}),
    });
    counts[status]++;
  }

  return { facts, counts, conflicts };
}
