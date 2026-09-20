/**
 * generate-plan — REAL AcademicDecisionAgent class/factory integration
 * (default-off flag `use_academic_decision_agent`).
 *
 * Distinct from generate_plan_academic_decision_agent.test.ts, which exercises
 * the runtime ADAPTER (academic_decision_runtime.ts / buildAcademicDecision).
 * This suite proves the actual AcademicDecisionAgent CLASS
 * (academic_decision_agent.ts), constructed by createDefaultAcademicDecisionAgent
 * (academic_decision_factory.ts), genuinely EXECUTES on the flagged native
 * Generate route — with the STABLE planner injected as its PlanningCapability,
 * so the generated proposal is byte-identical to the default path (no
 * emptyState re-planning, no plan-shape change).
 *
 * Deterministic: dev-bypass, no DB, no paid provider — same harness as the
 * adapter suite.
 */

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';

const PLAN_CONTEXT = {
  program_name: 'בדיקה',
  semesters: [
    { id: 'year_3_semester_a', label: 'שנה ג׳ א׳', total_hours: 4, courses: [
      { course_id: 'MAND', name_he: 'חובה', hours: 4, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'] },
    ] },
    { id: 'year_3_semester_b', label: 'שנה ג׳ ב׳', total_hours: 0, courses: [] },
    { id: 'year_4_semester_a', label: 'שנה ד׳ א׳', total_hours: 0, courses: [] },
    { id: 'year_4_semester_b', label: 'שנה ד׳ ב׳', total_hours: 0, courses: [] },
  ],
  category_requirements: [
    { name: 'זורמים', category_id: 'fluids', required: 1, placed: 0, candidates: [
      { course_id: 'FLU', name_he: 'זורם', hours: 4, effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'] },
    ] },
  ],
  total_hours_progress: { known_completed_hours: 177, degree_required_hours: 185 },
  personal_status: { completed: [] },
  mandatory_unplaced: [],
};

function makeReq(body: any, method = 'POST') {
  return { method, body } as any;
}
function makeRes() {
  const res: any = {
    statusCode: 0,
    setHeader: jest.fn().mockReturnThis(),
    status: jest.fn(function (this: any, c: number) { this.statusCode = c; return this; }),
    json: jest.fn(function (this: any, b: any) { this._body = b; return this; }),
    write: jest.fn(),
    end: jest.fn(),
  };
  return res;
}

function sufficientBody(over: any = {}) {
  return {
    program_id: 'test_program_2027',
    plan_context: {
      ...PLAN_CONTEXT,
      personal_status: { completed: [{ course_id: 'PRIOR' }], currently_taking: [] },
    },
    preferences: { disallowed_course_ids: [] },
    session_token: randomUUID(),
    ...over,
  };
}

const LEGACY_KEYS = ['blocked', 'errors', 'moves', 'rationale_he', 'requirements_status', 'semesters', 'trace', 'warnings_he'].sort();

async function run(body: any) {
  const res = makeRes();
  await handler(makeReq(body), res);
  return res;
}

function placedIds(body: any): string[] {
  return (body.semesters ?? []).flatMap((s: any) => s.course_ids);
}

describe('generate-plan — real AcademicDecisionAgent class integration', () => {
  beforeEach(() => {
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
  });
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
  });

  test('flag absent → exact legacy contract, no academicDecision (default path untouched)', async () => {
    const res = await run(sufficientBody());
    expect(res.statusCode).toBe(200);
    expect('academicDecision' in res._body).toBe(false);
    expect(Object.keys(res._body).sort()).toEqual(LEGACY_KEYS);
  });

  test('flag true → the real AcademicDecisionAgent class executed (orchestration.engine)', async () => {
    const res = await run(sufficientBody({ use_academic_decision_agent: true }));
    expect(res.statusCode).toBe(200);
    // orchestration metadata is class-only evidence: the runtime adapter alone
    // never produces it. 'AcademicDecisionAgent' means the class ran to
    // completion (Observe→detectGaps→Clarify→Plan→Validate→Decide→Persist),
    // not the adapter fallback.
    expect(res._body.academicDecision.orchestration).toBeDefined();
    expect(res._body.academicDecision.orchestration.engine).toBe('AcademicDecisionAgent');
    expect(res._body.academicDecision.orchestration.planningSource).toBe('stable-planner');
    expect(res._body.academicDecision.orchestration.planned).toBe(true);
    expect(typeof res._body.academicDecision.orchestration.gapsDetected).toBe('number');
  });

  test('proposal parity: the class path leaves the stable proposal byte-identical to the default path', async () => {
    const base = sufficientBody();
    const off = await run({ ...base });
    const on = await run({ ...base, use_academic_decision_agent: true });
    expect(on._body.semesters).toEqual(off._body.semesters);
    expect(on._body.moves).toEqual(off._body.moves);
    expect(on._body.requirements_status).toEqual(off._body.requirements_status);
    expect(on._body.rationale_he).toEqual(off._body.rationale_he);
  });

  test('planning context is preserved through the class path (excluded course never placed; parity holds)', async () => {
    const on = await run(sufficientBody({
      use_academic_decision_agent: true,
      preferences: { disallowed_course_ids: ['FLU'] },
    }));
    expect(placedIds(on._body)).not.toContain('FLU');
    // The class still ran to completion around that stable plan.
    expect(on._body.academicDecision.orchestration.engine).toBe('AcademicDecisionAgent');
  });

  test('the class-produced clarification reaches the response (still asks when completion state is missing)', async () => {
    const res = await run({
      program_id: 'test_program_2027',
      plan_context: PLAN_CONTEXT,
      preferences: {},
      session_token: randomUUID(),
      use_academic_decision_agent: true,
    });
    expect(res._body.academicDecision.clarification.needsClarification).toBe(true);
    expect(res._body.academicDecision.clarification.questions.map((q: any) => q.id)).toEqual(
      expect.arrayContaining(['completed_courses', 'excluded_courses']),
    );
    // A real plan is still returned alongside (never withheld) — parity intact.
    expect(Array.isArray(res._body.semesters)).toBe(true);
  });

  test('flag true still exposes the full adapter view (validation/decision/explanation) fed by the class', async () => {
    const res = await run(sufficientBody({ use_academic_decision_agent: true }));
    expect(res._body.academicDecision.validation).toBeDefined();
    expect(res._body.academicDecision.decision).toBeDefined();
    expect(res._body.academicDecision.explanation).toBeDefined();
  });

  test('Knowledge Grounding is invoked on the flagged path — grounded facts for every placed course', async () => {
    const res = await run(sufficientBody({ use_academic_decision_agent: true }));
    const grounding = res._body.academicDecision.grounding;
    expect(grounding).toBeDefined();
    expect(Array.isArray(grounding.facts)).toBe(true);
    // Grounds exactly the placed courses — never fabricates facts about others.
    expect(grounding.facts.map((f: any) => f.courseId).sort()).toEqual(placedIds(res._body).sort());
    const { known, unknown, inferred, conflicting } = grounding.counts;
    expect(known + unknown + inferred + conflicting).toBe(placedIds(res._body).length);
    for (const f of grounding.facts) {
      expect(['known', 'unknown', 'inferred', 'conflicting']).toContain(f.status);
      expect(f.provenance).toBeDefined();
    }
    expect(Array.isArray(grounding.conflicts)).toBe(true);
  });

  test('grounding is plan-inert — the plan is byte-identical to the default path', async () => {
    const base = sufficientBody();
    const off = await run({ ...base });
    const on = await run({ ...base, use_academic_decision_agent: true });
    expect(on._body.semesters).toEqual(off._body.semesters);
    // grounding never appears on the default path
    expect('academicDecision' in off._body).toBe(false);
  });

  test('grounding is absent when the flag is off (no academicDecision at all)', async () => {
    const res = await run(sufficientBody({ use_academic_decision_agent: false }));
    expect('academicDecision' in res._body).toBe(false);
  });

  // ── Slice 4: structured agent outcomes ─────────────────────────────────────

  test('outcome=proposal + applyEligible=true for a valid, sufficient request', async () => {
    const res = await run(sufficientBody({ use_academic_decision_agent: true }));
    expect(res._body.academicDecision.outcome).toBe('proposal');
    expect(res._body.academicDecision.applyEligible).toBe(true);
  });

  test('outcome=clarification_required + applyEligible=false when a critical input is missing', async () => {
    const res = await run({
      program_id: 'test_program_2027',
      plan_context: PLAN_CONTEXT,
      preferences: {},
      session_token: randomUUID(),
      use_academic_decision_agent: true,
    });
    expect(res._body.academicDecision.outcome).toBe('clarification_required');
    // A draft still exists, but Apply must be gated until the critical input is provided.
    expect(res._body.academicDecision.applyEligible).toBe(false);
    expect(Array.isArray(res._body.semesters)).toBe(true);
    // Slice 7: the missing critical input is an ANSWERABLE structured item.
    const answerable = res._body.academicDecision.structuredClarification.items
      .find((i: any) => i.reasonCode === 'completed_courses');
    expect(answerable.kind).toBe('answerable_preference');
    expect(answerable.answerable).toBe(true);
    expect(answerable.inputKey).toBe('completedCourseIds');
  });

  // Slice 18A: excluding a MANDATORY course is now recognised as a HARD
  // CONSTRAINT CONTRADICTION before planning, so it reports the more specific
  // 'infeasible' outcome (no legal plan satisfying the request exists) rather
  // than the generic 'blocked' (the produced plan failed a gate). Both are
  // non-applyable; the response still carries the same blocking error.
  test('outcome=infeasible + applyEligible=false when a mandatory course cannot be placed (excluded)', async () => {
    const res = await run(sufficientBody({
      use_academic_decision_agent: true,
      preferences: { disallowed_course_ids: ['MAND'] },
    }));
    expect(res._body.blocked).toBe(true);
    expect(res._body.academicDecision.outcome).toBe('infeasible');
    expect(res._body.academicDecision.applyEligible).toBe(false);
    const reason = res._body.academicDecision.hardConstraints.reasons
      .find((r: any) => r.code === 'avoided_mandatory_conflict');
    expect(reason.courseIds).toContain('MAND');
    expect(reason.authoritative).toBe(true); // the course's mandatory status is an authoritative fact
  });
});
