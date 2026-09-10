import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler, {
  normalizeGroupsResponse,
  normalizeSearchResponse,
  toBiditCourseId,
  toDashedCourseId,
  fetchGroupsFromBidit,
  fetchSearchFromBidit,
} from '../../api/ai/schedule-groups';

function mockRes() {
  const res: Partial<VercelResponse> & { _status?: number; _json?: unknown } = {};
  res.status = jest.fn((code: number) => { res._status = code; return res as VercelResponse; });
  res.json = jest.fn((body: unknown) => { res._json = body; return res as VercelResponse; });
  (res as { headersSent: boolean }).headersSent = false;
  return res as VercelResponse & { _status?: number; _json?: unknown };
}

describe('toBiditCourseId / toDashedCourseId', () => {
  test('strips the dash', () => {
    expect(toBiditCourseId('0542-2400')).toBe('05422400');
  });
  test('re-inserts the dash after 4 digits', () => {
    expect(toDashedCourseId('05422400')).toBe('0542-2400');
  });
});

describe('normalizeGroupsResponse', () => {
  test('a group with two weekly meetings becomes one group with two slots', () => {
    const raw = {
      coursesInfo: [{
        cName: 'תכן מכני (1)', cNum: '05422400', cYear: '2026',
        kvutzaData: [{
          gNum: '01', havura: 'A', kind: 'ראשית', ofenHoraa: 'שיעור ותרגיל',
          days: ['א', 'ד'], beginHours: ['10:00', '08:00'], endHours: ['12:00', '10:00'],
          lecturer: ["גב' אלה זמיר", "גב' אלה זמיר"], place: ['סמואלי הנדסה 001', '---'],
        }],
      }],
    };
    const result = normalizeGroupsResponse(raw, ['0542-2400'], 1, '2026-09-10T00:00:00.000Z');
    expect(result).toEqual({
      semester: 1,
      source: 'bidit',
      fetchedAt: '2026-09-10T00:00:00.000Z',
      courses: [{
        courseId: '0542-2400', nameHe: 'תכן מכני (1)', cYear: 2026,
        found: true, incompleteData: false,
        groups: [{
          groupId: '01', havura: 'A', kind: 'ראשית', teachingMode: 'שיעור ותרגיל',
          lecturer: "גב' אלה זמיר", room: 'סמואלי הנדסה 001',
          slots: [
            { day: 'א', start: '10:00', end: '12:00' },
            { day: 'ד', start: '08:00', end: '10:00' },
          ],
        }],
      }],
    });
  });

  test('a course bid-it has no record for → found: false, no crash', () => {
    const raw = { coursesInfo: [null] };
    const result = normalizeGroupsResponse(raw, ['0542-9999'], 2, '2026-09-10T00:00:00.000Z');
    expect(result.courses).toEqual([
      { courseId: '0542-9999', nameHe: null, cYear: null, found: false, incompleteData: false, groups: [] },
    ]);
  });

  test('a found course with no usable day/time is flagged incompleteData, never conflict-free by omission', () => {
    const raw = {
      coursesInfo: [{
        cName: 'קורס לדוגמה', cNum: '05121204', cYear: '2026',
        kvutzaData: [{
          gNum: '01', havura: 'A', kind: 'ראשית', ofenHoraa: 'שיעור',
          days: [], beginHours: [], endHours: [], lecturer: [], place: [],
        }],
      }],
    };
    const result = normalizeGroupsResponse(raw, ['0512-1204'], 1, '2026-09-10T00:00:00.000Z');
    expect(result.courses[0].found).toBe(true);
    expect(result.courses[0].incompleteData).toBe(true);
    expect(result.courses[0].groups[0].slots).toEqual([]);
  });

  test('one missing course inside a batch does not affect the others', () => {
    const raw = {
      coursesInfo: [
        null,
        {
          cName: 'קורס קיים', cNum: '05124266', cYear: '2026',
          kvutzaData: [{
            gNum: '01', havura: 'A', kind: 'ראשית', ofenHoraa: 'שיעור',
            days: ['ד'], beginHours: ['16:00'], endHours: ['19:00'],
            lecturer: ['ד"ר בן נשיא'], place: ['---'],
          }],
        },
      ],
    };
    const result = normalizeGroupsResponse(raw, ['0542-9999', '0512-4266'], 1, 't');
    expect(result.courses[0].found).toBe(false);
    expect(result.courses[1].found).toBe(true);
    expect(result.courses[1].nameHe).toBe('קורס קיים');
  });
});

describe('normalizeSearchResponse', () => {
  test('filters by code or name substring (case-insensitive) and converts ids', () => {
    const raw = {
      Courses: [
        { courseCode: '05422400', courseName: 'תכן מכני (1)' },
        { courseCode: '08421002', courseName: '20th Century American Composers' },
      ],
    };
    const result = normalizeSearchResponse(raw, 'תכן', 't');
    expect(result.results).toEqual([{ courseId: '0542-2400', nameHe: 'תכן מכני (1)' }]);
    expect(result.source).toBe('bidit');
  });
});

describe('handler', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; jest.restoreAllMocks(); });

  test('GET without semester or search → 400', async () => {
    const res = mockRes();
    await handler({ method: 'GET', query: {} } as unknown as VercelRequest, res);
    expect(res._status).toBe(400);
  });

  test('non-GET → 405', async () => {
    const res = mockRes();
    await handler({ method: 'POST', query: {} } as unknown as VercelRequest, res);
    expect(res._status).toBe(405);
  });

  test('groups mode: upstream success → 200 with normalized body', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ coursesInfo: [null] }),
    }) as unknown as typeof fetch;
    const res = mockRes();
    await handler(
      { method: 'GET', query: { semester: '1', courses: '0542-9999' } } as unknown as VercelRequest,
      res,
    );
    expect(res._status).toBe(200);
    expect((res._json as { courses: unknown[] }).courses).toHaveLength(1);
  });

  test('groups mode: upstream failure → 502, never throws', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    const res = mockRes();
    await handler(
      { method: 'GET', query: { semester: '1', courses: '0542-9999' } } as unknown as VercelRequest,
      res,
    );
    expect(res._status).toBe(502);
  });

  test('search mode: returns normalized results', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ Courses: [{ courseCode: '05422400', courseName: 'תכן מכני (1)' }] }),
    }) as unknown as typeof fetch;
    const res = mockRes();
    await handler(
      { method: 'GET', query: { search: 'תכן', semester: '1' } } as unknown as VercelRequest,
      res,
    );
    expect(res._status).toBe(200);
    expect((res._json as { results: unknown[] }).results).toHaveLength(1);
  });
});

describe('fetchGroupsFromBidit / fetchSearchFromBidit (DI)', () => {
  test('fetchGroupsFromBidit batches all course ids into one request with courses_list repeated', async () => {
    const calls: string[] = [];
    const fakeFetch = jest.fn(async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => ({ coursesInfo: [] }) } as unknown as Response;
    });
    await fetchGroupsFromBidit(['0542-2400', '0512-4266'], 1, fakeFetch as unknown as typeof fetch);
    expect(calls[0]).toContain('courses_list=05422400');
    expect(calls[0]).toContain('courses_list=05124266');
    expect(calls[0]).toContain('semester=1');
  });

  test('fetchSearchFromBidit throws on a non-ok upstream response', async () => {
    const fakeFetch = jest.fn(async () => ({ ok: false, status: 500 }) as unknown as Response);
    await expect(fetchSearchFromBidit(1, fakeFetch as unknown as typeof fetch)).rejects.toThrow();
  });
});
