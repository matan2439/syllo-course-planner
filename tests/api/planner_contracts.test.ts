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
  normalizeCourseId,
  boardResponseToModel,
  generatePlanResponseToModel,
  getBoard,
  generatePlan,
  sendConversation,
  catalogRevision,
  proposalBaseRevision,
  localWorkspaceRevision,
  isCatalogStale,
  workspaceSchema,
  CONTRACT_VERSION,
} from '../../shared/planner';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

  test('sendConversation validates the available response and sends the typed transcript', async () => {
    const fetchImpl = jest.fn(makeFetch(200, {
      outcome: 'conversation', message_he: 'אני בודק את הלוח.', events: [],
    }));
    const result = await sendConversation({ fetchImpl, baseUrl: '' }, {
      program_id: 'mechanical_engineering_2027',
      session_token: '00000000-0000-4000-8000-000000000000',
      board_version: null,
      academic_status_digest: 'as_1',
      preference_digest: 'pref_1',
      transcript: [{ role: 'user', text: 'בנה לי חלופות' }],
    });
    expect(result.outcome).toBe('conversation');
    expect(fetchImpl).toHaveBeenCalledWith('/api/ai/conversation', expect.objectContaining({
      method: 'POST', credentials: 'same-origin',
    }));
    const requestInit = (fetchImpl as jest.Mock).mock.calls[0][1] as { body: string };
    expect(JSON.parse(requestInit.body).transcript).toHaveLength(1);
  });

  test('sendConversation preserves a typed unavailable response from HTTP 503', async () => {
    const result = await sendConversation({ fetchImpl: makeFetch(503, {
      outcome: 'assistant_unavailable', message_he: 'העוזר האקדמי אינו זמין כרגע.',
      events: [{ type: 'assistant_unavailable', message_he: 'העוזר האקדמי אינו זמין כרגע.' }],
    }), baseUrl: '' }, {
      program_id: 'mechanical_engineering_2027',
      session_token: '00000000-0000-4000-8000-000000000000',
      board_version: null,
      academic_status_digest: 'as_1',
      preference_digest: 'pref_1',
      transcript: [{ role: 'user', text: 'בדיקה' }],
    });
    expect(result.outcome).toBe('assistant_unavailable');
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

// ── Slice 2: courseCatalog (full display universe from the existing payload) ───
// Provenance: the real /api/board payload (verified this session) carries the full
// course universe across TWO places — semesters[].courses[] (placed) and
// metadata.program_repository_courses[] (electives). Real overlap between the two
// is 0 and repo entries lack `course_type`; these fixtures exercise the merge rule
// deterministically without claiming a real overlap exists.
describe('boardResponseToModel courseCatalog (placed ∪ program_repository_courses)', () => {
  const withRepo = {
    metadata: {
      board_data_version: 'cat-rev-1',
      program_repository_courses: [
        { course_id: '0542-4220', name_he: 'קורס מאגר', weekly_hours: 2.5, is_mandatory: false },
      ],
    },
    semesters: [
      {
        semester_id: 'year_3_semester_a',
        courses: [{ course_id: '0542-3243', name_he: 'קורס מוצב', weekly_hours: 3.5, course_type: 'mandatory', is_mandatory: true }],
      },
    ],
  }

  test('normalizeCourseId trims and rejects non-strings (matches the canonical policy)', () => {
    expect(normalizeCourseId('  0542-1  ')).toBe('0542-1')
    expect(normalizeCourseId(123 as unknown as string)).toBe('')
  })

  test('catalog includes a placed-only course and a repository-only course', () => {
    const { courseCatalog } = boardResponseToModel(withRepo)
    expect(courseCatalog['0542-3243'].nameHe).toBe('קורס מוצב') // placed
    expect(courseCatalog['0542-4220'].nameHe).toBe('קורס מאגר') // repository-only
    expect(courseCatalog['0542-4220'].halfHours).toBe(5) // 2.5h exact
  })

  test('semester placements are NOT reinterpreted as the whole universe (repo id absent from placements)', () => {
    const model = boardResponseToModel(withRepo)
    const placedIds = model.semesters.flatMap((s) => s.courses.map((c) => c.courseId))
    expect(placedIds).toContain('0542-3243')
    expect(placedIds).not.toContain('0542-4220') // repo course is in the catalog, not a placement
  })

  test('overlapping id: repository is authoritative for shared fields, placement-only course_type retained', () => {
    const both = {
      metadata: {
        board_data_version: 'r',
        program_repository_courses: [{ course_id: 'X-1', name_he: 'ממאגר', weekly_hours: 2.0, is_mandatory: false }],
      },
      semesters: [
        { semester_id: 'year_3_semester_a', courses: [{ course_id: 'X-1', name_he: 'מוצב', weekly_hours: 3.0, course_type: 'elective', is_mandatory: true }] },
      ],
    }
    const { courseCatalog } = boardResponseToModel(both)
    expect(courseCatalog['X-1'].nameHe).toBe('ממאגר') // repo authoritative
    expect(courseCatalog['X-1'].halfHours).toBe(4) // repo 2.0h
    expect(courseCatalog['X-1'].isMandatory).toBe(false) // repo authoritative
    expect(courseCatalog['X-1'].courseType).toBe('elective') // placement-only field retained (repo has none)
  })

  test('duplicate ids within a source after normalization resolve deterministically (last wins)', () => {
    const dup = {
      metadata: {
        board_data_version: 'r',
        program_repository_courses: [
          { course_id: 'D-1', name_he: 'first', weekly_hours: 1.0, is_mandatory: false },
          { course_id: ' D-1 ', name_he: 'second', weekly_hours: 1.5, is_mandatory: false },
        ],
      },
      semesters: [],
    }
    const { courseCatalog } = boardResponseToModel(dup)
    expect(courseCatalog['D-1'].nameHe).toBe('second')
    expect(courseCatalog['D-1'].halfHours).toBe(3) // 1.5h
  })

  test('does not mutate the input payload', () => {
    const input = JSON.parse(JSON.stringify(withRepo))
    const snapshot = JSON.stringify(input)
    boardResponseToModel(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})

// ── Slice 2 regression: the REAL Mechanical 2027 board payload at the boundary ──
// Binds the generic canonical adapter to the actual repository fixture (loaded,
// not copied). Regression check only — generic union/normalization/resolution
// behavior stays covered by the inline unit fixtures above. If the real payload's
// counts, overlap, or 0542-4220 metadata contradict the recorded discovery facts,
// this fails loudly rather than being weakened.
describe('boardResponseToModel — real mechanical_engineering_2027 payload (13 entries / 12 unique placed, 56 repository)', () => {
  const REAL = JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', 'data', 'parsed_json', 'mechanical_semester_board_2027.json'),
      'utf8',
    ),
  );
  const placedEntryIds = (): string[] =>
    REAL.semesters.flatMap((s: { courses: Array<{ course_id: string }> }) =>
      s.courses.map((c) => normalizeCourseId(c.course_id)),
    );
  const repoIds = (): string[] =>
    (REAL.metadata.program_repository_courses ?? []).map((c: { course_id: string }) =>
      normalizeCourseId(c.course_id),
    );

  test('counts: 13 placed entries, 12 unique placed ids, 56 repository, 0 overlap, catalog size 68', () => {
    const entries = placedEntryIds();
    const uniquePlaced = new Set(entries);
    const repo = new Set(repoIds());
    expect(entries.length).toBe(13); // ENTRIES (an annual course is placed twice)
    expect(uniquePlaced.size).toBe(12); // unique normalized placed ids
    expect(repoIds().length).toBe(56);
    expect([...uniquePlaced].filter((id) => repo.has(id))).toEqual([]); // zero normalized overlap

    const { courseCatalog } = boardResponseToModel(REAL);
    expect(Object.keys(courseCatalog).length).toBe(68); // 12 unique placed ∪ 56 repository
    expect(new Set(Object.keys(courseCatalog))).toEqual(new Set([...uniquePlaced, ...repo]));
    for (const id of uniquePlaced) expect(courseCatalog[id]).toBeDefined();
    for (const id of repo) expect(courseCatalog[id]).toBeDefined();
  });

  test('annual 0542-3792 spans {year_3_semester_a, year_3_semester_b} yet is ONE catalog entry', () => {
    const id = normalizeCourseId('0542-3792');
    const { semesters, courseCatalog } = boardResponseToModel(REAL);
    const placedIn = semesters.filter((s) => s.courses.some((c) => c.courseId === id)).map((s) => s.semesterId);
    expect(new Set(placedIn)).toEqual(new Set(['year_3_semester_a', 'year_3_semester_b']));
    expect(Object.keys(courseCatalog).filter((k) => k === id).length).toBe(1); // single catalog entry
  });

  test('repository-only 0542-4220 resolves with its exact fixture name and halfHours=8 (4h)', () => {
    const id = normalizeCourseId('0542-4220');
    const repoEntry = (REAL.metadata.program_repository_courses as Array<{ course_id: string; name_he: string; weekly_hours: number }>).find(
      (c) => normalizeCourseId(c.course_id) === id,
    )!;
    expect(new Set(placedEntryIds()).has(id)).toBe(false); // repository-only
    const { courseCatalog } = boardResponseToModel(REAL);
    expect(courseCatalog[id].nameHe).toBe(repoEntry.name_he); // fixture-derived, not hardcoded
    expect(courseCatalog[id].halfHours).toBe(8);
  });

  test('adapting the real payload does not mutate it', () => {
    const snapshot = JSON.stringify(REAL);
    boardResponseToModel(REAL);
    expect(JSON.stringify(REAL)).toBe(snapshot);
  });
});
