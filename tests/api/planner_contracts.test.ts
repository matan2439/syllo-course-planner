/**
 * Slice 0 — canonical planner contracts (shared/planner/*).
 *
 * Fixture provenance (documented per approval constraint #7):
 *  - BOARD_FIXTURE: shape trimmed from the real repo catalog file
 *    data/parsed_json/mechanical_semester_board_2027.json (verified this session:
 *    metadata.board_data_version present; semesters[].courses[].weekly_hours is a
 *    decimal half-hour, e.g. 3.5). Values sanitized/trimmed; NOT a live capture.
 *  - GENERATE_PLAN_OK: keys captured LIVE from POST /api/ai/generate-plan
 *    (200 response this session): semesters, moves, warnings_he, errors, blocked,
 *    rationale_he, requirements_status, trace. Course ids/text sanitized.
 *  - GENERATE_PLAN_BLOCKED: SCHEMA-DERIVED (hand-authored to the response contract
 *    at api/ai/generate-plan.ts:1571-1574). NOT captured from a real blocked run.
 *  - GENERIC_PROGRAM board uses a synthetic programId + minimal synthetic structure
 *    to prove identifier-agnostic adapters. It does NOT claim a real second catalog.
 */
import {
  boardResponseSchema,
  generatePlanResponseSchema,
  validatePlanRequestSchema,
  validatePlanResponseSchema,
  toHalfHours,
  fromHalfHours,
  ContractError,
  boardResponseToModel,
  generatePlanResponseToModel,
  getBoard,
  generatePlan,
  catalogRevision,
  proposalBaseRevision,
  localWorkspaceRevision,
  isCatalogStale,
  workspaceSchema,
  CONTRACT_VERSION,
} from '../../shared/planner';

// ── Fixtures ────────────────────────────────────────────────────────────────
const BOARD_FIXTURE = {
  metadata: {
    board_data_version: '5ec3d239e9bd5567',
    start_year: 3,
    total_courses: 2,
    board_validation: { valid: true, error_count: 0, invalid_count: 0 },
    // legitimate extra passthrough fields present in the real payload:
    program_requirements_categories: [{ id: 'core', name_he: 'ליבה' }],
  },
  summary: { total_courses: 2 },
  warnings: [],
  semesters: [
    {
      semester_id: 'year_3_semester_a',
      display_name: 'Year 3 - Semester A',
      total_weekly_hours: 6.5,
      average_difficulty: 2.0,
      warnings: [],
      courses: [
        { course_id: '0542-3243', name_he: 'קורס א', weekly_hours: 3.5, course_type: 'mandatory', difficulty_level: 'medium', syllabus_url: null, is_mandatory: true },
        { course_id: '0542-2500', name_he: 'קורס ב', weekly_hours: 3.0, course_type: 'elective', difficulty_level: null, syllabus_url: null, is_mandatory: false },
      ],
    },
    { semester_id: 'year_3_semester_b', display_name: 'Year 3 - Semester B', total_weekly_hours: null, average_difficulty: null, warnings: [], courses: [] },
  ],
};

const GENERATE_PLAN_OK = {
  semesters: [
    { semester_id: 'year_3_semester_a', course_ids: ['0542-3243', '0542-2500'] },
    { semester_id: 'year_3_semester_b', course_ids: [] },
  ],
  moves: [
    { course_id: '0542-3243', from: null, to: 'year_3_semester_a' },
    { course_id: '0542-2500', from: 'year_3_semester_b', to: 'year_3_semester_a' },
  ],
  warnings_he: ['אזהרה לדוגמה'],
  errors: [],
  blocked: false,
  rationale_he: 'נימוק לדוגמה',
  requirements_status: [{ category: 'core', placed: 2, required: 2 }],
  trace: [],
};

const GENERATE_PLAN_BLOCKED = {
  ...GENERATE_PLAN_OK,
  warnings_he: [],
  errors: ['סמסטר year_3_semester_a: 28 ש"ש — חריגה מהמגבלה הקשיחה (26).'],
  blocked: true,
};

// ── wire schema: board ────────────────────────────────────────────────────────
describe('boardResponseSchema', () => {
  test('accepts the real board payload shape and preserves passthrough metadata', () => {
    const parsed = boardResponseSchema.parse(BOARD_FIXTURE);
    expect(parsed.metadata.board_data_version).toBe('5ec3d239e9bd5567');
    // passthrough: extra metadata field survives, not stripped
    expect((parsed.metadata as Record<string, unknown>).program_requirements_categories).toBeDefined();
  });

  test('rejects a course missing its identifier (structural failure not swallowed)', () => {
    const bad = JSON.parse(JSON.stringify(BOARD_FIXTURE));
    delete bad.semesters[0].courses[0].course_id;
    expect(() => boardResponseSchema.parse(bad)).toThrow();
  });

  test('rejects a semester missing semester_id', () => {
    const bad = JSON.parse(JSON.stringify(BOARD_FIXTURE));
    delete bad.semesters[0].semester_id;
    expect(() => boardResponseSchema.parse(bad)).toThrow();
  });
});

// ── wire schema: generate-plan ────────────────────────────────────────────────
describe('generatePlanResponseSchema', () => {
  test('accepts a real successful proposal', () => {
    const p = generatePlanResponseSchema.parse(GENERATE_PLAN_OK);
    expect(p.blocked).toBe(false);
    expect(p.semesters[0].semester_id).toBe('year_3_semester_a');
    expect(p.moves[0].from).toBeNull();
  });

  test('accepts a (schema-derived) blocked proposal with errors', () => {
    const p = generatePlanResponseSchema.parse(GENERATE_PLAN_BLOCKED);
    expect(p.blocked).toBe(true);
    expect(p.errors.length).toBeGreaterThan(0);
  });

  test('does NOT require future fields (runId / contractVersion / baseRevision)', () => {
    // real payload has none of these; parsing must succeed without them
    const p = generatePlanResponseSchema.parse(GENERATE_PLAN_OK);
    expect((p as Record<string, unknown>).runId).toBeUndefined();
    expect((p as Record<string, unknown>).contractVersion).toBeUndefined();
  });

  test('rejects a payload missing the blocked flag', () => {
    const bad = { ...GENERATE_PLAN_OK } as Record<string, unknown>;
    delete bad.blocked;
    expect(() => generatePlanResponseSchema.parse(bad)).toThrow();
  });
});

// ── half-hour exactness ───────────────────────────────────────────────────────
describe('half-hour conversion (exact, integer half-hour units)', () => {
  test.each([
    [0.5, 1],
    [2.5, 5],
    [186.5, 373],
    [3.0, 6],
  ])('toHalfHours(%p) === %p and round-trips losslessly', (dec, units) => {
    expect(toHalfHours(dec)).toBe(units);
    expect(fromHalfHours(units)).toBe(dec);
  });

  test('rejects unsupported precision (2.25) instead of rounding', () => {
    expect(() => toHalfHours(2.25)).toThrow(ContractError);
  });

  test('rejects NaN / non-finite', () => {
    expect(() => toHalfHours(NaN)).toThrow(ContractError);
  });
});

// ── adapters ──────────────────────────────────────────────────────────────────
describe('adapters (wire → canonical model)', () => {
  test('boardResponseToModel preserves ids and converts weekly_hours to half-hour units, null stays null', () => {
    const model = boardResponseToModel(BOARD_FIXTURE);
    expect(model.catalogRevision).toBe('5ec3d239e9bd5567');
    const sem = model.semesters[0];
    expect(sem.semesterId).toBe('year_3_semester_a');
    expect(sem.courses[0].courseId).toBe('0542-3243');
    expect(sem.courses[0].halfHours).toBe(7); // 3.5h
    expect(model.semesters[1].courses).toEqual([]);
  });

  test('generatePlanResponseToModel maps semesters/moves/flags', () => {
    const model = generatePlanResponseToModel(GENERATE_PLAN_OK);
    expect(model.blocked).toBe(false);
    expect(model.semesters[0].courseIds).toEqual(['0542-3243', '0542-2500']);
    expect(model.moves[0].to).toBe('year_3_semester_a');
  });

  test('adapters are identifier-agnostic (generic program, synthetic minimal catalog)', () => {
    const generic = {
      metadata: { board_data_version: 'gen-rev-1' },
      semesters: [
        { semester_id: 'year_1_semester_a', display_name: 'S1', total_weekly_hours: 0.5, average_difficulty: null, warnings: [], courses: [{ course_id: 'XX-1', name_he: 'x', weekly_hours: 0.5, course_type: 't', difficulty_level: null, syllabus_url: null }] },
      ],
    };
    const model = boardResponseToModel(generic);
    expect(model.semesters[0].courses[0].halfHours).toBe(1);
  });
});

// ── revisions (distinct types) ────────────────────────────────────────────────
describe('revision semantics (kept distinct)', () => {
  test('a captured proposal base revision differing from current catalog revision is stale', () => {
    const captured = proposalBaseRevision('rev-A');
    const current = catalogRevision('rev-B');
    expect(isCatalogStale(captured, current)).toBe(true);
  });
  test('matching revisions are not stale', () => {
    expect(isCatalogStale(proposalBaseRevision('rev-A'), catalogRevision('rev-A'))).toBe(false);
  });
  test('local workspace revision is its own constructor', () => {
    expect(typeof localWorkspaceRevision('w-1')).toBe('string');
  });
});

// ── runtime-neutral API client ────────────────────────────────────────────────
describe('api client (runtime-neutral, injected fetch)', () => {
  const makeFetch = (status: number, body: unknown) =>
    async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

  test('getBoard parses a board response into the model', async () => {
    const model = await getBoard({ fetchImpl: makeFetch(200, BOARD_FIXTURE), baseUrl: '' }, 'mechanical_engineering_2027');
    expect(model.catalogRevision).toBe('5ec3d239e9bd5567');
  });

  test('generatePlan parses a proposal into the model', async () => {
    const model = await generatePlan({ fetchImpl: makeFetch(200, GENERATE_PLAN_OK), baseUrl: '' }, { program_id: 'mechanical_engineering_2027', plan_context: {}, preferences: {}, session_token: '00000000-0000-4000-8000-000000000000' });
    expect(model.semesters.length).toBe(2);
  });

  test('malformed response fails truthfully with ContractError (no silent coercion)', async () => {
    await expect(
      getBoard({ fetchImpl: makeFetch(200, { semesters: 'not-an-array' }), baseUrl: '' }, 'p_2027'),
    ).rejects.toBeInstanceOf(ContractError);
  });
});

// ── local workspace schema ────────────────────────────────────────────────────
describe('workspace schema (versioned, program-scoped)', () => {
  test('parses a valid applied workspace and carries contract version + programId', () => {
    const ws = workspaceSchema.parse({
      contractVersion: CONTRACT_VERSION,
      programId: 'mechanical_engineering_2027',
      catalogRevisionAtSave: '5ec3d239e9bd5567',
      localRevision: 'w-1',
      applied: { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['0542-3243'] }] },
      draft: null,
      preferences: {},
    });
    expect(ws.programId).toBe('mechanical_engineering_2027');
    expect(ws.contractVersion).toBe(CONTRACT_VERSION);
  });

  test('rejects a workspace with the wrong contract version', () => {
    expect(() =>
      workspaceSchema.parse({ contractVersion: 999, programId: 'p', catalogRevisionAtSave: 'r', localRevision: 'w', applied: null, draft: null, preferences: {} }),
    ).toThrow();
  });
});

// ── pending validate-plan contract (defined, NOT implemented) ──────────────────
describe('validate-plan contract (PENDING — Slice 3; endpoint NOT implemented)', () => {
  test('request/response schemas exist and validate a sample shape', () => {
    const req = validatePlanRequestSchema.parse({
      program_id: 'mechanical_engineering_2027',
      session_token: '00000000-0000-4000-8000-000000000000',
      semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['0542-3243'] }],
      catalogRevision: '5ec3d239e9bd5567',
    });
    expect(req.semesters.length).toBe(1);
    const res = validatePlanResponseSchema.parse({
      applicable: true,
      blocked: false,
      violations: [],
      warnings: [],
      totals: { perSemesterHalfHours: { year_3_semester_a: 7 }, degreeHalfHours: 7 },
    });
    expect(res.blocked).toBe(false);
  });
});
