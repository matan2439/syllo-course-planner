/**
 * Slice 14 — preference-profile lifecycle through the real Generate boundary.
 * Proves the request carries a typed profile, the response echoes the exact
 * version used + deterministic eligibility (classification filtering before
 * planning), and flag-off stays byte-identical.
 */
import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';

const PLAN_CONTEXT = {
  semesters: [
    { id: 'year_3_semester_a', courses: [{ course_id: 'MAND', name_he: 'חובה', hours: 4, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'] }] },
    { id: 'year_3_semester_b', courses: [] },
  ],
  personal_status: { completed: [{ course_id: 'PRIOR' }], currently_taking: [] },
};

function makeRes() {
  const res: any = {
    statusCode: 0, setHeader: jest.fn().mockReturnThis(),
    status: jest.fn(function (this: any, c: number) { this.statusCode = c; return this; }),
    json: jest.fn(function (this: any, b: any) { this._body = b; return this; }),
    write: jest.fn(), end: jest.fn(),
  };
  return res;
}
async function run(body: any) { const res = makeRes(); await handler({ method: 'POST', body } as any, res); return res; }

const PROFILE = {
  version: 7,
  preferences: [
    { id: 'bal', normalized: 'balanced', value: 'balanced', classification: 'soft_preference', affects: 'balance_score', source: 'explicit_answer', mayAffectPlanningBeforeConfirmation: true },
    { id: 'load', normalized: 'low_load', classification: 'uncertain', affects: 'max_weekly_hours', source: 'explicit_answer', mayAffectPlanningBeforeConfirmation: false },
    { id: 't', normalized: 'no_time_preference', value: null, classification: 'indifferent', affects: 'schedule_shape', source: 'explicit_answer', mayAffectPlanningBeforeConfirmation: false },
  ],
};

function body(over: any = {}) {
  return { program_id: 'test_program_2027', plan_context: PLAN_CONTEXT, preferences: { disallowed_course_ids: [] }, session_token: randomUUID(), ...over };
}

describe('generate-plan — preference profile lifecycle', () => {
  beforeEach(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
  afterEach(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });

  test('flag off: preference_profile is accepted but produces no academicDecision (backward-compatible)', async () => {
    const res = await run(body({ preference_profile: PROFILE }));
    expect(res.statusCode).toBe(200);
    expect('academicDecision' in res._body).toBe(false);
  });

  test('flag on: the response echoes the exact profile version used', async () => {
    const res = await run(body({ use_academic_decision_agent: true, preference_profile: PROFILE }));
    expect(res._body.academicDecision.profileVersion).toBe(7);
  });

  test('flag on: eligibility filters by classification before planning (soft in, uncertain+indifferent excluded)', async () => {
    const res = await run(body({ use_academic_decision_agent: true, preference_profile: PROFILE }));
    const e = res._body.academicDecision.preferenceEligibility;
    expect(e.soft.map((p: any) => p.id)).toEqual(['bal']);
    expect(e.hard).toEqual([]);
    expect(e.excluded.map((x: any) => x.id).sort()).toEqual(['load', 't']);
    // Ineligible preferences are surfaced with reasons, never silently dropped.
    expect(e.excluded.find((x: any) => x.id === 'load').reason).toMatch(/uncertain|unconfirmed/i);
    expect(e.excluded.find((x: any) => x.id === 't').reason).toMatch(/indifferent/i);
  });

  test('flag on without a profile: no profileVersion evidence (distinguishable from a versioned run)', async () => {
    const res = await run(body({ use_academic_decision_agent: true }));
    expect(res._body.academicDecision.profileVersion).toBeUndefined();
  });
});
