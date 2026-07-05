import handler, { preferencesSchema, priorHoursFromContext, buildModel } from '../../api/ai/generate-plan';
import { LlmExplainer } from '../../api/ai/llm_explainer';
import type { ExplanationCapability } from '../../api/ai/planner_capabilities';
import { randomUUID } from 'crypto';
import { KNOWN_SEMESTER_IDS } from '../../api/ai/plan_validation';

// ── Backward-compatibility: response contract (run via dev bypass — no DB/model) ──

const PLAN_CONTEXT = {
  program_name: 'בדיקה',
  semesters: [
    { id: 'year_3_semester_a', label: "שנה ג׳ א׳", total_hours: 4, courses: [
      { course_id: 'MAND', name_he: 'חובה', hours: 4, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'] },
    ] },
    { id: 'year_3_semester_b', label: "שנה ג׳ ב׳", total_hours: 0, courses: [] },
    { id: 'year_4_semester_a', label: "שנה ד׳ א׳", total_hours: 0, courses: [] },
    { id: 'year_4_semester_b', label: "שנה ד׳ ב׳", total_hours: 0, courses: [] },
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

const REQ_BODY = {
  program_id: 'test_program_2027',
  plan_context: PLAN_CONTEXT,
  preferences: {},
  session_token: randomUUID(),
};

describe('generate-plan response contract (backward compatibility)', () => {
  beforeEach(() => {
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
  });
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
  });

  it('returns the exact contract keys with correct types (+ additive trace)', async () => {
    const res = makeRes();
    await handler(makeReq(REQ_BODY), res);
    expect(res.statusCode).toBe(200);
    const b = res._body;
    expect(Array.isArray(b.semesters)).toBe(true);
    expect(Array.isArray(b.moves)).toBe(true);
    expect(Array.isArray(b.warnings_he)).toBe(true);
    expect(typeof b.rationale_he).toBe('string');
    expect(Array.isArray(b.requirements_status)).toBe(true);
    expect(Array.isArray(b.errors)).toBe(true);
    expect(typeof b.blocked).toBe('boolean');
    expect(Array.isArray(b.trace)).toBe(true); // additive
  });

  it('every semester_id is canonical and no course is placed twice', async () => {
    const res = makeRes();
    await handler(makeReq(REQ_BODY), res);
    const b = res._body;
    const seen = new Set<string>();
    for (const sem of b.semesters) {
      expect(KNOWN_SEMESTER_IDS).toContain(sem.semester_id);
      for (const cid of sem.course_ids) {
        expect(seen.has(cid)).toBe(false);
        seen.add(cid);
      }
    }
  });

  it('requirements_status rows have the {name,required,placed,satisfied} shape', async () => {
    const res = makeRes();
    await handler(makeReq(REQ_BODY), res);
    for (const row of res._body.requirements_status) {
      expect(typeof row.name).toBe('string');
      expect(typeof row.required).toBe('number');
      expect(typeof row.placed).toBe('number');
      expect(typeof row.satisfied).toBe('boolean');
    }
  });

  it('blocked === (errors.length > 0)', async () => {
    const res = makeRes();
    await handler(makeReq(REQ_BODY), res);
    const b = res._body;
    expect(b.blocked).toBe(b.errors.length > 0);
  });

  it('the response minus trace is still a valid current-shape object (client can ignore trace)', async () => {
    const res = makeRes();
    await handler(makeReq(REQ_BODY), res);
    const { trace, ...legacy } = res._body;
    expect(Object.keys(legacy).sort()).toEqual(
      ['blocked', 'errors', 'moves', 'rationale_he', 'requirements_status', 'semesters', 'warnings_he'].sort(),
    );
  });
});

describe('priorHoursFromContext — formula spec', () => {
  it('returns known_completed_hours only, ignores currently_planned_hours', () => {
    expect(priorHoursFromContext({
      total_hours_progress: { known_completed_hours: 100, currently_planned_hours: 20 },
    })).toBe(100);
  });

  it('prefers manual_completed_degree_hours over known_completed_hours', () => {
    expect(priorHoursFromContext({
      total_hours_progress: { manual_completed_degree_hours: 150, known_completed_hours: 100, currently_planned_hours: 20 },
    })).toBe(150);
  });

  it('returns 0 when total_hours_progress absent', () => {
    expect(priorHoursFromContext({})).toBe(0);
    expect(priorHoursFromContext(null)).toBe(0);
  });
});

describe('buildModel — overload-override threading', () => {
  it('threads preferences.overload_accepted/overload_confirmed_at into the model', () => {
    const confirmedAt = Date.now();
    const model = buildModel(PLAN_CONTEXT as any, PLAN_CONTEXT, {
      overload_accepted: true,
      overload_confirmed_at: confirmedAt,
    } as any);
    expect(model.overloadAccepted).toBe(true);
    expect(model.overloadConfirmedAt).toBe(confirmedAt);
  });

  it('leaves the model override unset when preferences omit it (no behavior change)', () => {
    const model = buildModel(PLAN_CONTEXT as any, PLAN_CONTEXT, {} as any);
    expect(model.overloadAccepted).toBeUndefined();
    expect(model.overloadConfirmedAt).toBeUndefined();
  });
});

describe('buildModel — program identity threading (Phase 0)', () => {
  it('derives programId/catalogYear from the request program_id already parsed by this file', () => {
    const model = buildModel(PLAN_CONTEXT as any, PLAN_CONTEXT, {} as any, 'mechanical_engineering_2027');
    expect(model.programId).toBe('mechanical_engineering');
    expect(model.catalogYear).toBe(2027);
    expect(model.institutionId).toBeUndefined(); // never fabricated
  });

  it('leaves identity fields unset when program_id is omitted or malformed (no behavior change)', () => {
    const noId = buildModel(PLAN_CONTEXT as any, PLAN_CONTEXT, {} as any);
    expect(noId.programId).toBeUndefined();
    expect(noId.catalogYear).toBeUndefined();

    const malformed = buildModel(PLAN_CONTEXT as any, PLAN_CONTEXT, {} as any, 'not-a-valid-id');
    expect(malformed.programId).toBeUndefined();
    expect(malformed.catalogYear).toBeUndefined();
  });
});

// ── Phase 5: PlannerAgent path ────────────────────────────────────────────────

describe('generate-plan PlannerAgent path (Phase 5)', () => {
  beforeEach(() => {
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
    process.env.AI_USE_AGENTIC_PLANNER = 'true';
  });
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
    delete process.env.AI_USE_AGENTIC_PLANNER;
  });

  // 1 — response contract shape unchanged
  it('(PlannerAgent) returns exact contract keys with correct types', async () => {
    const res = makeRes();
    await handler(makeReq(REQ_BODY), res);
    expect(res.statusCode).toBe(200);
    const b = res._body;
    expect(Array.isArray(b.semesters)).toBe(true);
    expect(Array.isArray(b.moves)).toBe(true);
    expect(Array.isArray(b.warnings_he)).toBe(true);
    expect(typeof b.rationale_he).toBe('string');
    expect(Array.isArray(b.requirements_status)).toBe(true);
    expect(Array.isArray(b.errors)).toBe(true);
    expect(typeof b.blocked).toBe('boolean');
    expect(Array.isArray(b.trace)).toBe(true);
  });

  // 2 — valid requirements_status shape
  it('(PlannerAgent) requirements_status rows have the {name,required,placed,satisfied} shape', async () => {
    const res = makeRes();
    await handler(makeReq(REQ_BODY), res);
    expect(res.statusCode).toBe(200);
    for (const row of res._body.requirements_status) {
      expect(typeof row.name).toBe('string');
      expect(typeof row.required).toBe('number');
      expect(typeof row.placed).toBe('number');
      expect(typeof row.satisfied).toBe('boolean');
    }
  });

  // 2b — blocked invariant
  it('(PlannerAgent) blocked === (errors.length > 0)', async () => {
    const res = makeRes();
    await handler(makeReq(REQ_BODY), res);
    const b = res._body;
    expect(b.blocked).toBe(b.errors.length > 0);
  });

  // 3 — LLM explanation fallback: dev mode → no LlmExplainer → deterministic rationale_he
  it('(PlannerAgent) rationale_he is a non-empty string when LLM unavailable (dev mode)', async () => {
    const res = makeRes();
    await handler(makeReq(REQ_BODY), res);
    expect(typeof res._body.rationale_he).toBe('string');
    expect(res._body.rationale_he.length).toBeGreaterThan(0);
  });

  // 4 — LLM is not called in dev mode (succeeds without any AI_MODEL)
  it('(PlannerAgent) succeeds without AI_MODEL configured in dev mode', async () => {
    const saved = process.env.AI_MODEL;
    delete process.env.AI_MODEL;
    try {
      const res = makeRes();
      await handler(makeReq(REQ_BODY), res);
      expect(res.statusCode).toBe(200);
    } finally {
      if (saved !== undefined) process.env.AI_MODEL = saved;
    }
  });

  // 5 — No step-selection LLM: trace field is an array (beam search is deterministic)
  it('(PlannerAgent) trace field is an array produced by deterministic beam search', async () => {
    const res = makeRes();
    await handler(makeReq(REQ_BODY), res);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res._body.trace)).toBe(true);
    // Trace from PlannerAgent is PlannerMutation[] (not PlannerAction[])
    // — additive field, clients ignore shape they don't understand
  });

  // 5b — response minus trace is still the exact legacy shape
  it('(PlannerAgent) response minus trace is the exact legacy shape', async () => {
    const res = makeRes();
    await handler(makeReq(REQ_BODY), res);
    const { trace, ...legacy } = res._body;
    expect(Object.keys(legacy).sort()).toEqual(
      ['blocked', 'errors', 'moves', 'rationale_he', 'requirements_status', 'semesters', 'warnings_he'].sort(),
    );
  });
});

// 6 — LlmExplainer interface shape
describe('LlmExplainer (Phase 5)', () => {
  // LlmExplainer takes a LanguageModel; use {} as unknown cast for unit tests
  const mockModel = {} as import('ai').LanguageModel;

  it('implements ExplanationCapability and returns a string', async () => {
    const explainer: ExplanationCapability = new LlmExplainer(mockModel);
    const result = await explainer.explain([]);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('produces a non-empty string for a single ADD_COURSE mutation', async () => {
    const explainer = new LlmExplainer(mockModel);
    const trace = [{ type: 'ADD_COURSE', courseId: 'c1', semesterId: 's1' }];
    const result = await explainer.explain(trace);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('generate-plan preferencesSchema', () => {
  it('accepts a valid action_type', () => {
    for (const action_type of ['full_plan', 'balance_load', 'add_electives', 'fix_prerequisites', 'minimal_changes']) {
      const result = preferencesSchema.safeParse({ action_type });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an invalid action_type', () => {
    const result = preferencesSchema.safeParse({ action_type: 'rebuild_everything' });
    expect(result.success).toBe(false);
  });

  it('accepts pinned_course_ids alongside other preferences', () => {
    const result = preferencesSchema.safeParse({
      balance_load: true,
      action_type: 'balance_load',
      pinned_course_ids: ['0542-4120', '0542-4221'],
    });
    expect(result.success).toBe(true);
    expect(result.data?.pinned_course_ids).toEqual(['0542-4120', '0542-4221']);
  });

  it('defaults to no action_type / pinned_course_ids', () => {
    const result = preferencesSchema.parse({});
    expect(result.action_type).toBeUndefined();
    expect(result.pinned_course_ids).toBeUndefined();
  });
});
