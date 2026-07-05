/**
 * PlannerAction trace — the structured, schema-validated log the Planner Worker
 * emits for every mutation. The trace is the planner's observability surface:
 * it records which courses were considered, which were rejected and why, where
 * each course was placed, why a flexible A/B course was or wasn't moved, why the
 * planner stopped, the total hours after each step, and the validation result
 * after each mutation.
 */

import { z } from 'zod';

/** The nine supported planner action types (order is part of the contract). */
export const PLANNER_ACTION_TYPES = [
  'ADD_COURSE',
  'REMOVE_COURSE',
  'MOVE_COURSE',
  'REPLACE_COURSE',
  'VALIDATE',
  'REPAIR',
  'SCORE',
  'REJECT_COURSE',
  'STOP',
] as const;
export type PlannerActionType = (typeof PLANNER_ACTION_TYPES)[number];

/** Coarse progress phases — a derived observation view over the goal stack. */
export const PLANNER_PHASES = [
  'INIT',
  'LOAD_CONTEXT',
  'BUILD_COURSE_PROFILES',
  'BUILD_CONSTRAINT_MODEL',
  'CONSTRUCT_PLAN',
  'GENERATE_CANDIDATES',
  'VALIDATE',
  'REPAIR',
  'SCORE',
  'EXPLAIN',
  'DONE',
  'BLOCKED',
] as const;
export type PlannerPhase = (typeof PLANNER_PHASES)[number];

/** Who initiated the action. */
export const PLANNER_ACTORS = ['llm', 'greedy', 'repair', 'worker'] as const;
export type PlannerActor = (typeof PLANNER_ACTORS)[number];

export const plannerActionSchema = z.object({
  step: z.number().int().nonnegative(),
  action: z.enum(PLANNER_ACTION_TYPES),
  courseId: z.string().optional(),
  courseName: z.string().optional(),
  /** semester_id involved (target for ADD/MOVE; source available via `from`). */
  semester: z.string().optional(),
  from: z.string().nullable().optional(),
  reason: z.string(),
  beforeTotal: z.number(),
  afterTotal: z.number(),
  constraintsChecked: z.array(z.string()).default([]),
  validationAfterAction: z.enum(['pass', 'fail']),
  phase: z.enum(PLANNER_PHASES),
  by: z.enum(PLANNER_ACTORS),
  /** Optional scoring detail for ranked/considered actions. */
  immediateScore: z.number().optional(),
  estimatedFinalScore: z.number().optional(),
  feasible: z.boolean().optional(),
});

export type PlannerAction = z.infer<typeof plannerActionSchema>;

/** Shared result of running the deterministic validators on a plan/candidate. */
export interface ValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  constraintsChecked: string[];
}

/**
 * Accumulates an ordered, step-numbered, schema-validated planner trace.
 * `record` auto-assigns the next step number and validates the action so a
 * malformed entry fails fast at the call site instead of corrupting the trace.
 */
export class PlannerTracer {
  private steps: PlannerAction[] = [];

  record(action: Omit<PlannerAction, 'step' | 'constraintsChecked'> & { constraintsChecked?: string[] }): PlannerAction {
    const parsed = plannerActionSchema.parse({
      ...action,
      step: this.steps.length + 1,
      constraintsChecked: action.constraintsChecked ?? [],
    });
    this.steps.push(parsed);
    return parsed;
  }

  getTrace(): PlannerAction[] {
    return this.steps;
  }
}
