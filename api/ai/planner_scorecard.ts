/**
 * Planner Optimization Scorecard / Explanation Contract.
 *
 * A PURE, read-only helper that explains WHY a plan scores the way it does. It
 * re-exposes signals the frozen planner already computes — the `scorePlan`
 * lexicographic vector labelled by `GOAL_STACK`, per-semester loads, peak and
 * spread, over-cap breaches, and the missing/satisfied requirement gaps from
 * `assessCompleteness` — plus a few deterministic human-readable notes.
 *
 * It invents NO new scoring logic and changes NO planner decision: every number
 * here is derived from the same inputs `scorePlan`/`assessCompleteness` use, and
 * the peak/spread agree with the balance goals in the score vector. Nothing in
 * this module mutates its inputs.
 */

import {
  GOAL_STACK,
  type Goal,
  scorePlan,
  assessCompleteness,
} from './planner_goals';
import type { ConstraintModel, PlanState } from './planner_types';

export interface ScorecardGoal {
  /** Goal label from GOAL_STACK, aligned to its position in the score vector. */
  goal: Goal;
  /** The score-vector component for this goal (higher is better). */
  value: number;
}

export interface ScorecardSemesterLoad {
  semesterId: string;
  /** Total weekly hours placed in this semester. */
  hours: number;
  /** hours > model.hardCap (the absolute blocking cap). */
  overHardCap: boolean;
  /** hours > model.maxHoursPerSemester (the user's preferred cap). */
  overUserCap: boolean;
}

export interface PlannerScorecard {
  /** The exact vector `scorePlan(state, model)` returns. */
  scoreVector: number[];
  /** scoreVector zipped with GOAL_STACK labels, in order. */
  goals: ScorecardGoal[];
  /** Per-semester loads in model.knownSemesterIds (chronological) order. */
  semesterLoads: ScorecardSemesterLoad[];
  /** Heaviest semester load (the user's worst-semester burden); 0 if no semesters. */
  peakLoad: number;
  /** max-min load across NON-EMPTY semesters (matches scorePlan's balance_spread); 0 if <2 active. */
  loadSpread: number;
  /** Sum of the per-semester loads. */
  totalPlacedHours: number;
  /** knownSemesterIds whose load exceeds the hard cap. */
  overHardCapSemesters: string[];
  /** knownSemesterIds whose load exceeds the user cap. */
  overUserCapSemesters: string[];
  /** Over-cap semesters per assessCompleteness (respects the overload-confirmation policy). */
  overCapSemesters: string[];
  /** Required mandatory courses not yet placed (and not completed). */
  missingMandatory: string[];
  /** Category ids still below their required count. */
  unsatisfiedCategories: string[];
  /** Prior progress + placed degree hours. */
  degreeHours: number;
  /** Whether degreeHours meets the requirement. */
  degreeMet: boolean;
  /** Deterministic, human-readable notes explaining the load burden metrics. */
  notes: string[];
}

/**
 * Build a deterministic explanation of a plan's score. Pure: reads only, never
 * mutates `state` or `model`.
 */
export function buildPlannerScorecard(state: PlanState, model: ConstraintModel): PlannerScorecard {
  const scoreVector = scorePlan(state, model);
  const goals: ScorecardGoal[] = GOAL_STACK.map((goal, i) => ({ goal, value: scoreVector[i] ?? 0 }));

  const semesterLoads: ScorecardSemesterLoad[] = model.knownSemesterIds.map(semesterId => {
    const hours = (state.semesters[semesterId] ?? []).reduce(
      (sum, cid) => sum + (model.profiles.get(cid)?.hours ?? 0),
      0,
    );
    return {
      semesterId,
      hours,
      overHardCap: hours > model.hardCap,
      overUserCap: hours > model.maxHoursPerSemester,
    };
  });

  const loads = semesterLoads.map(l => l.hours);
  const peakLoad = loads.length ? Math.max(...loads) : 0;
  const active = loads.filter(h => h > 0);
  const loadSpread = active.length > 1 ? Math.max(...active) - Math.min(...active) : 0;
  const totalPlacedHours = loads.reduce((sum, h) => sum + h, 0);

  const overHardCapSemesters = semesterLoads.filter(l => l.overHardCap).map(l => l.semesterId);
  const overUserCapSemesters = semesterLoads.filter(l => l.overUserCap).map(l => l.semesterId);

  const completeness = assessCompleteness(state, model);

  const peakSem = semesterLoads.find(l => l.hours === peakLoad);
  const notes: string[] = [
    `Peak semester load: ${peakLoad}h${peakSem ? ` in ${peakSem.semesterId}` : ''}.`,
    `Load spread across active semesters: ${loadSpread}h.`,
    `Total placed load: ${totalPlacedHours}h across ${active.length} active semester(s).`,
  ];
  if (overHardCapSemesters.length) {
    notes.push(`${overHardCapSemesters.length} semester(s) over the hard cap (${model.hardCap}h).`);
  }
  if (overUserCapSemesters.length) {
    notes.push(`${overUserCapSemesters.length} semester(s) over the user cap (${model.maxHoursPerSemester}h).`);
  }

  return {
    scoreVector,
    goals,
    semesterLoads,
    peakLoad,
    loadSpread,
    totalPlacedHours,
    overHardCapSemesters,
    overUserCapSemesters,
    overCapSemesters: completeness.overCapSemesters,
    missingMandatory: completeness.missingMandatory,
    unsatisfiedCategories: completeness.unsatisfiedCategories,
    degreeHours: completeness.degreeHours,
    degreeMet: completeness.degreeMet,
    notes,
  };
}
