/**
 * Tests for api/ai/planner_trace.ts — the PlannerAction trace schema + tracer.
 * Every planner mutation emits a structured, schema-validated PlannerAction;
 * the tracer auto-numbers steps and accumulates the ordered trace.
 */

import {
  plannerActionSchema,
  PLANNER_ACTION_TYPES,
  PlannerTracer,
  type PlannerAction,
} from '../../api/ai/planner_trace';

describe('plannerActionSchema', () => {
  it('accepts a well-formed ADD_COURSE action', () => {
    const a: PlannerAction = {
      step: 1,
      action: 'ADD_COURSE',
      courseId: '0542-4123',
      courseName: 'תהליכי מעבר',
      semester: 'year_4_semester_b',
      reason: 'נדרש להשלמת קטגוריית זורמים',
      beforeTotal: 181,
      afterTotal: 184,
      constraintsChecked: ['degree_hours', 'category', 'prerequisites', 'semester_load'],
      validationAfterAction: 'pass',
      phase: 'CONSTRUCT_PLAN',
      by: 'greedy',
    };
    expect(() => plannerActionSchema.parse(a)).not.toThrow();
  });

  it('rejects an unknown action type', () => {
    expect(() =>
      plannerActionSchema.parse({
        step: 1,
        action: 'TELEPORT_COURSE',
        reason: 'x',
        beforeTotal: 0,
        afterTotal: 0,
        constraintsChecked: [],
        validationAfterAction: 'pass',
        phase: 'CONSTRUCT_PLAN',
        by: 'greedy',
      }),
    ).toThrow();
  });

  it('exposes all nine supported action types', () => {
    expect(PLANNER_ACTION_TYPES).toEqual([
      'ADD_COURSE',
      'REMOVE_COURSE',
      'MOVE_COURSE',
      'REPLACE_COURSE',
      'VALIDATE',
      'REPAIR',
      'SCORE',
      'REJECT_COURSE',
      'STOP',
    ]);
  });
});

describe('PlannerTracer', () => {
  it('auto-numbers steps in order and accumulates the trace', () => {
    const t = new PlannerTracer();
    const a = t.record({
      action: 'ADD_COURSE',
      courseId: 'c1',
      reason: 'r1',
      beforeTotal: 0,
      afterTotal: 3,
      validationAfterAction: 'pass',
      phase: 'CONSTRUCT_PLAN',
      by: 'greedy',
    });
    const b = t.record({
      action: 'REJECT_COURSE',
      courseId: 'c2',
      reason: 'disallowed',
      beforeTotal: 3,
      afterTotal: 3,
      validationAfterAction: 'pass',
      phase: 'CONSTRUCT_PLAN',
      by: 'greedy',
    });
    expect(a.step).toBe(1);
    expect(b.step).toBe(2);
    expect(t.getTrace()).toHaveLength(2);
    expect(t.getTrace()[1].action).toBe('REJECT_COURSE');
  });

  it('defaults constraintsChecked to an empty array when omitted', () => {
    const t = new PlannerTracer();
    const a = t.record({
      action: 'STOP',
      reason: 'goal reached',
      beforeTotal: 185,
      afterTotal: 185,
      validationAfterAction: 'pass',
      phase: 'DONE',
      by: 'worker',
    });
    expect(a.constraintsChecked).toEqual([]);
  });

  it('validates each recorded action against the schema', () => {
    const t = new PlannerTracer();
    expect(() =>
      t.record({
        // @ts-expect-error — intentionally invalid action type
        action: 'NOPE',
        reason: 'x',
        beforeTotal: 0,
        afterTotal: 0,
        validationAfterAction: 'pass',
        phase: 'CONSTRUCT_PLAN',
        by: 'greedy',
      }),
    ).toThrow();
  });
});
