/**
 * Tests for GET /api/board/[programId]
 *
 * The postgres module is mocked — no real database connection is required.
 * Tests cover parsing, happy path, all error branches, and fixture counts.
 */

// ── postgres mock (must be declared before any import that uses it) ───────────

const mockEnd = jest.fn().mockResolvedValue(undefined);
const mockSql  = Object.assign(
  jest.fn().mockResolvedValue([]),  // default: empty result set
  { end: mockEnd },
);
jest.mock('postgres', () => jest.fn().mockReturnValue(mockSql));

// ── imports ───────────────────────────────────────────────────────────────────

import handler, {
  parseProgramVersionId,
  queryBoardJson,
} from '../../api/board/[programId]';

// ── Board fixture with exact expected counts ──────────────────────────────────

const REPO_COURSES = Array.from({ length: 56 }, (_, i) => ({
  course_id: `0542-${4000 + i}`,
  name_he: `קורס ${i + 1}`,
  weekly_hours: 3,
}));

const MANDATORY_IDS = [
  '0512-1204', '0542-2400', '0542-2500', '0542-3243',
  '0542-3620', '0542-3780', '0542-4000', '0542-4001',
  '0542-4100', '0542-4200', '0542-4300', '0542-4400',
];

const MOCK_BOARD = {
  semesters: [
    {
      semester_id: 'year_3_semester_a',
      display_name: "שנה ג׳ — סמסטר א׳",
      courses: MANDATORY_IDS.slice(0, 6).map(id => ({
        course_id: id, course_type: 'mandatory', name_he: id,
      })),
    },
    {
      semester_id: 'year_3_semester_b',
      display_name: "שנה ג׳ — סמסטר ב׳",
      courses: MANDATORY_IDS.slice(6).map(id => ({
        course_id: id, course_type: 'mandatory', name_he: id,
      })),
    },
  ],
  metadata: {
    program_repository_courses: REPO_COURSES,
    program_requirements_categories: [],
  },
  warnings: [],
  summary: { total_placed: 12 },
};

// ── Request / response helpers ────────────────────────────────────────────────

function makeReq(programId: string, method = 'GET') {
  return { method, query: { programId } } as unknown as import('@vercel/node').VercelRequest;
}

function makeRes() {
  const res = {} as any;
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res as import('@vercel/node').VercelResponse;
}

// ── parseProgramVersionId ─────────────────────────────────────────────────────

describe('parseProgramVersionId', () => {
  it('parses mechanical_engineering_2027', () => {
    expect(parseProgramVersionId('mechanical_engineering_2027')).toEqual({
      base: 'mechanical_engineering',
      year: 2027,
    });
  });

  it('parses computer_science_2028', () => {
    expect(parseProgramVersionId('computer_science_2028')).toEqual({
      base: 'computer_science',
      year: 2028,
    });
  });

  it('returns null when no year suffix', () => {
    expect(parseProgramVersionId('mechanical_engineering')).toBeNull();
  });

  it('returns null for non-4-digit year', () => {
    expect(parseProgramVersionId('prog_27')).toBeNull();
    expect(parseProgramVersionId('prog_202')).toBeNull();
    expect(parseProgramVersionId('prog_20270')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseProgramVersionId('')).toBeNull();
  });
});

// ── handler ───────────────────────────────────────────────────────────────────

describe('GET /api/board/[programId] handler', () => {
  const VALID_DB_URL = 'postgresql://test:test@localhost/testdb';

  beforeEach(() => {
    jest.clearAllMocks();
    mockSql.mockResolvedValue([]);
    process.env.DATABASE_URL = VALID_DB_URL;
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  // ── 400 bad request ──────────────────────────────────────────────────────

  it('returns 400 for programId without year suffix', async () => {
    const res = makeRes();
    await handler(makeReq('no-year-here'), res);
    expect((res.status as jest.Mock).mock.calls[0][0]).toBe(400);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.code).toBe('INVALID_PROGRAM_ID');
  });

  it('returns 400 for empty programId', async () => {
    const res = makeRes();
    await handler(makeReq(''), res);
    expect((res.status as jest.Mock).mock.calls[0][0]).toBe(400);
  });

  // ── 503 no database ──────────────────────────────────────────────────────

  it('returns 503 with NO_DATABASE_URL when DATABASE_URL is absent', async () => {
    delete process.env.DATABASE_URL;
    const res = makeRes();
    await handler(makeReq('mechanical_engineering_2027'), res);
    expect((res.status as jest.Mock).mock.calls[0][0]).toBe(503);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.code).toBe('NO_DATABASE_URL');
  });

  it('returns 503 with DB_ERROR on database exception', async () => {
    mockSql.mockRejectedValueOnce(new Error('Connection refused'));
    const res = makeRes();
    await handler(makeReq('mechanical_engineering_2027'), res);
    expect((res.status as jest.Mock).mock.calls[0][0]).toBe(503);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.code).toBe('DB_ERROR');
  });

  // ── 404 not found ────────────────────────────────────────────────────────

  it('returns 404 when no rows are returned from DB', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = makeRes();
    await handler(makeReq('unknown_program_9999'), res);
    expect((res.status as jest.Mock).mock.calls[0][0]).toBe(404);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 404 when board_json column is null', async () => {
    mockSql.mockResolvedValueOnce([{ board_json: null }]);
    const res = makeRes();
    await handler(makeReq('mechanical_engineering_2027'), res);
    expect((res.status as jest.Mock).mock.calls[0][0]).toBe(404);
  });

  // ── 200 happy path ───────────────────────────────────────────────────────

  it('returns 200 with board JSON when found', async () => {
    mockSql.mockResolvedValueOnce([{ board_json: MOCK_BOARD }]);
    const res = makeRes();
    await handler(makeReq('mechanical_engineering_2027'), res);
    expect((res.status as jest.Mock).mock.calls[0][0]).toBe(200);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body).toHaveProperty('semesters');
    expect(body).toHaveProperty('metadata');
    expect(body).toHaveProperty('warnings');
  });

  it('repository count is 56 in returned board fixture', async () => {
    mockSql.mockResolvedValueOnce([{ board_json: MOCK_BOARD }]);
    const res = makeRes();
    await handler(makeReq('mechanical_engineering_2027'), res);
    const body = (res.json as jest.Mock).mock.calls[0][0] as typeof MOCK_BOARD;
    expect(body.metadata.program_repository_courses).toHaveLength(56);
  });

  it('mandatory courses count is 12 in returned board fixture', async () => {
    mockSql.mockResolvedValueOnce([{ board_json: MOCK_BOARD }]);
    const res = makeRes();
    await handler(makeReq('mechanical_engineering_2027'), res);
    const body = (res.json as jest.Mock).mock.calls[0][0] as typeof MOCK_BOARD;
    const mandatory = body.semesters.flatMap(s =>
      s.courses.filter(c => c.course_type === 'mandatory'),
    );
    expect(mandatory).toHaveLength(12);
  });

  it('does not expose DATABASE_URL in response body', async () => {
    mockSql.mockResolvedValueOnce([{ board_json: MOCK_BOARD }]);
    const res = makeRes();
    await handler(makeReq('mechanical_engineering_2027'), res);
    const bodyStr = JSON.stringify((res.json as jest.Mock).mock.calls[0][0]);
    expect(bodyStr).not.toContain('DATABASE_URL');
    expect(bodyStr).not.toContain('postgresql://');
  });

  // ── 405 wrong method ─────────────────────────────────────────────────────

  it('returns 405 for non-GET requests', async () => {
    const res = makeRes();
    await handler(makeReq('mechanical_engineering_2027', 'POST'), res);
    expect((res.status as jest.Mock).mock.calls[0][0]).toBe(405);
  });
});
