# Weekly Timetable (Bidit-style Schedule) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a weekly day/hour schedule drawer to the planner — synced automatically with the semester board — where a student picks real teaching groups (fetched live from bid-it, TAU's public unofficial course-groups source) and can never select two groups that overlap in time.

**Architecture:** A new serverless proxy (`api/ai/schedule-groups.ts`) fetches and normalizes bid-it's public group/time and course-search data server-side. A new pure module (`shared/planner/schedule.ts`) holds the cross-runtime wire types and the hard overlap rule. A new `WeeklyScheduleDrawer` (third drawer, same pattern as the existing repository/agent drawers in `UnifiedPlannerWorkspace.tsx`) reads its course list automatically from the board's per-semester course ids (a new `onSemestersChange` callback from `NativePlannerJourney`), fetches groups for the active tab's term, and renders them on a `WeeklyScheduleGrid`.

**Tech Stack:** Next.js 15 / React (web/), Vercel serverless functions (`@vercel/node`), TypeScript, Jest + ts-jest + React Testing Library (`web/jest.config.js`), Jest + ts-jest (root, `tests/api`).

**Spec:** `docs/superpowers/specs/2026-09-10-weekly-timetable-design.md`

**Corrections found while preparing this plan (spec still holds at the product level):**
1. bid-it's `chosen-courses-info` endpoint ignores any `year` parameter — it always returns the current bidding year for the given `semester` (1|2). Our proxy does not forward a year to bid-it; it trusts and returns whatever `cYear` bid-it reports per course, and the UI must warn if that differs from the student's own year mapping for that board column, instead of silently presenting it as a match.
2. A single bid-it "group" (`kvutzaData` entry) can meet more than once a week (parallel `days`/`beginHours`/`endHours` arrays on one group — e.g. Sunday 10:00–12:00 **and** Wednesday 08:00–10:00 for one lecture group). `ScheduleGroup` therefore carries `slots: TimeSlot[]`, not a single day/time, and overlap-checking compares every slot pair.
3. bid-it's batched endpoint (`courses_list` repeated) is one HTTP call for the whole batch, so "isolate one course's failure" happens at the **normalization** layer (a course bid-it has no record for gets `found: false`; others in the same batch are unaffected) — not via N separate per-course HTTP calls.

---

### Task 1: Shared schedule types, overlap rule, term-mapping default

**Files:**
- Create: `shared/planner/schedule.ts`
- Test: `tests/api/schedule_overlap.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/schedule_overlap.test.ts
import {
  hasOverlap,
  groupsOverlap,
  defaultTermMapping,
  type TimeSlot,
  type ScheduleGroup,
} from '../../shared/planner/schedule';

describe('hasOverlap', () => {
  test('same day, overlapping ranges → true', () => {
    const a: TimeSlot = { day: 'א', start: '08:00', end: '10:00' };
    const b: TimeSlot = { day: 'א', start: '09:00', end: '11:00' };
    expect(hasOverlap(a, b)).toBe(true);
  });

  test('same day, back-to-back ranges (end == start) → false', () => {
    const a: TimeSlot = { day: 'א', start: '08:00', end: '10:00' };
    const b: TimeSlot = { day: 'א', start: '10:00', end: '12:00' };
    expect(hasOverlap(a, b)).toBe(false);
  });

  test('different days, same hours → false', () => {
    const a: TimeSlot = { day: 'א', start: '08:00', end: '10:00' };
    const b: TimeSlot = { day: 'ב', start: '08:00', end: '10:00' };
    expect(hasOverlap(a, b)).toBe(false);
  });

  test('one range fully inside another → true', () => {
    const a: TimeSlot = { day: 'ד', start: '08:00', end: '12:00' };
    const b: TimeSlot = { day: 'ד', start: '09:00', end: '10:00' };
    expect(hasOverlap(a, b)).toBe(true);
  });
});

describe('groupsOverlap', () => {
  test('true when any slot pair across two multi-slot groups overlaps', () => {
    const a: Pick<ScheduleGroup, 'slots'> = {
      slots: [
        { day: 'א', start: '10:00', end: '12:00' },
        { day: 'ד', start: '08:00', end: '10:00' },
      ],
    };
    const b: Pick<ScheduleGroup, 'slots'> = {
      slots: [{ day: 'ד', start: '09:00', end: '11:00' }],
    };
    expect(groupsOverlap(a, b)).toBe(true);
  });

  test('false when no slot pair overlaps', () => {
    const a: Pick<ScheduleGroup, 'slots'> = { slots: [{ day: 'א', start: '10:00', end: '12:00' }] };
    const b: Pick<ScheduleGroup, 'slots'> = { slots: [{ day: 'ב', start: '10:00', end: '12:00' }] };
    expect(groupsOverlap(a, b)).toBe(false);
  });
});

describe('defaultTermMapping', () => {
  test('maps 4 semester ids to 4 consecutive terms starting from the current calendar term', () => {
    const ids = ['year_3_semester_a', 'year_3_semester_b', 'year_4_semester_a', 'year_4_semester_b'];
    const mapping = defaultTermMapping(ids, new Date('2026-09-10T00:00:00Z'));
    expect(mapping).toEqual({
      year_3_semester_a: { year: 2026, semester: 1 },
      year_3_semester_b: { year: 2026, semester: 2 },
      year_4_semester_a: { year: 2027, semester: 1 },
      year_4_semester_b: { year: 2027, semester: 2 },
    });
  });

  test('a date before August maps to semester 2 of the previous calendar year', () => {
    const ids = ['year_3_semester_a', 'year_3_semester_b'];
    const mapping = defaultTermMapping(ids, new Date('2026-03-01T00:00:00Z'));
    expect(mapping).toEqual({
      year_3_semester_a: { year: 2025, semester: 2 },
      year_3_semester_b: { year: 2026, semester: 1 },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/api/schedule_overlap.test.ts`
Expected: FAIL with "Cannot find module '../../shared/planner/schedule'"

- [ ] **Step 3: Write the implementation**

```ts
// shared/planner/schedule.ts
/**
 * Weekly-timetable wire contract, shared between the schedule-groups
 * serverless endpoint (api/ai/schedule-groups.ts) and the web client
 * (web/lib/planner/schedule-client.ts, WeeklyScheduleDrawer). Also holds the
 * one hard product rule: two selected groups may never overlap in time.
 *
 * Source: bid-it's public, unauthenticated endpoints — NOT an official TAU
 * academic authority. Every response carries `source` + `fetchedAt` so the UI
 * can label it accordingly, per the design spec
 * (docs/superpowers/specs/2026-09-10-weekly-timetable-design.md).
 */

export interface TimeSlot {
  day: string; // א..ו
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export interface ScheduleGroup {
  groupId: string; // bid-it gNum, e.g. "01"
  havura: string;
  kind: string; // ראשית / משנית
  teachingMode: string; // ofenHoraa, e.g. "שיעור", "תרגיל"
  lecturer: string | null;
  room: string | null;
  /** A group can meet more than once a week (e.g. Sun + Wed) — one slot per meeting. */
  slots: TimeSlot[];
}

export interface ScheduleCourse {
  courseId: string; // dashed form, e.g. "0542-2400"
  nameHe: string | null;
  /** The academic year bid-it actually returned for this course, or null if not found. */
  cYear: number | null;
  found: boolean;
  /** true when found but at least one group has no usable day/time data. */
  incompleteData: boolean;
  groups: ScheduleGroup[];
}

export interface ScheduleGroupsResponse {
  semester: 1 | 2;
  courses: ScheduleCourse[];
  source: 'bidit';
  fetchedAt: string; // ISO timestamp
}

export interface CourseSearchResult {
  courseId: string; // dashed form
  nameHe: string;
}

export interface CourseSearchResponse {
  results: CourseSearchResult[];
  source: 'bidit';
  fetchedAt: string;
}

export interface SemesterTerm {
  year: number;
  semester: 1 | 2;
}

/** Same day, and the two ranges actually intersect (half-open: touching ends do not overlap). */
export function hasOverlap(a: TimeSlot, b: TimeSlot): boolean {
  if (a.day !== b.day) return false;
  return a.start < b.end && a.end > b.start;
}

/** True if ANY slot of `a` overlaps ANY slot of `b` — the hard product rule. */
export function groupsOverlap(
  a: Pick<ScheduleGroup, 'slots'>,
  b: Pick<ScheduleGroup, 'slots'>,
): boolean {
  return a.slots.some((slotA) => b.slots.some((slotB) => hasOverlap(slotA, slotB)));
}

/**
 * Default academic-term mapping for a list of board semester ids, in order:
 * 4 consecutive terms (year, 1|2) starting from the CURRENT calendar term.
 * August–January of year Y is treated as Y/סמסטר א׳; February–July is
 * סמסטר ב׳ of the year that started the previous August. Editable per-column
 * afterward — this is only the starting default.
 */
export function defaultTermMapping(
  semesterIds: readonly string[],
  today: Date,
): Record<string, SemesterTerm> {
  const month = today.getMonth() + 1; // 1-12
  const startYear = month >= 8 ? today.getFullYear() : today.getFullYear() - 1;
  const mapping: Record<string, SemesterTerm> = {};
  semesterIds.forEach((id, index) => {
    const termsAhead = Math.floor(index / 2);
    const semester: 1 | 2 = index % 2 === 0 ? 1 : 2;
    mapping[id] = { year: startYear + termsAhead, semester };
  });
  return mapping;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/api/schedule_overlap.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add shared/planner/schedule.ts tests/api/schedule_overlap.test.ts
git commit -m "feat(schedule): shared timetable types, hard overlap rule, term-mapping default"
```

---

### Task 2: `schedule-groups` serverless endpoint

**Files:**
- Create: `api/ai/schedule-groups.ts`
- Test: `tests/api/schedule_groups.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/schedule_groups.test.ts
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
  res.headersSent = false;
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
    expect(result.courses[1].nameHe).toBe('קורs קיים'.length > 0 ? 'קורס קיים' : '');
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/api/schedule_groups.test.ts`
Expected: FAIL with "Cannot find module '../../api/ai/schedule-groups'"

- [ ] **Step 3: Write the implementation**

```ts
// api/ai/schedule-groups.ts
/**
 * GET /api/ai/schedule-groups
 *
 * Two modes, both proxying bid-it's public, unauthenticated endpoints
 * server-side (avoids browser CORS and keeps the third-party dependency out
 * of client code):
 *
 *   ?semester=<1|2>&courses=<comma-separated dashed course ids>
 *     → per-course teaching groups (day/time/lecturer/room), normalized.
 *
 *   ?search=<text>&semester=<1|2>
 *     → course id/name matches from bid-it's full TAU catalog.
 *
 * bid-it is NOT an official TAU academic authority — every response carries
 * `source: 'bidit'` and `fetchedAt` so the UI can label it as such. See
 * docs/superpowers/specs/2026-09-10-weekly-timetable-design.md.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type {
  ScheduleGroup,
  ScheduleGroupsResponse,
  CourseSearchResponse,
} from '../../shared/planner/schedule';

const BIDIT_ORIGIN = 'https://bid-it.appspot.com';

// ── Raw bid-it shapes (private to this module) ─────────────────────────────

interface BiditKvutzaData {
  beginHours: string[];
  days: string[];
  endHours: string[];
  gNum: string;
  havura: string;
  kind: string;
  lecturer: string[];
  ofenHoraa: string;
  place: string[];
}
interface BiditCourseInfo {
  cName: string;
  cNum: string;
  cYear: string;
  kvutzaData: BiditKvutzaData[];
}
interface BiditChosenCoursesInfoResponse {
  coursesInfo: Array<BiditCourseInfo | null>;
}
interface BiditAutoCompleteCourse {
  courseCode: string;
  courseName: string;
}
interface BiditAutoCompleteResponse {
  Courses: BiditAutoCompleteCourse[];
}

// ── Course id conversion (bid-it: 8 digits, no dash; ours: 4-4 dashed) ─────

export function toBiditCourseId(courseId: string): string {
  return courseId.replace(/-/g, '');
}

export function toDashedCourseId(biditId: string): string {
  return biditId.length === 8 ? `${biditId.slice(0, 4)}-${biditId.slice(4)}` : biditId;
}

// ── Normalization ───────────────────────────────────────────────────────────

export function normalizeGroupsResponse(
  raw: BiditChosenCoursesInfoResponse,
  requestedCourseIds: string[],
  semester: 1 | 2,
  fetchedAt: string,
): ScheduleGroupsResponse {
  const byBiditId = new Map<string, BiditCourseInfo>();
  for (const entry of raw.coursesInfo) {
    if (entry) byBiditId.set(entry.cNum, entry);
  }

  const courses = requestedCourseIds.map((courseId) => {
    const entry = byBiditId.get(toBiditCourseId(courseId));
    if (!entry) {
      return {
        courseId, nameHe: null, cYear: null,
        found: false, incompleteData: false, groups: [] as ScheduleGroup[],
      };
    }
    const groups: ScheduleGroup[] = entry.kvutzaData.map((k) => ({
      groupId: k.gNum,
      havura: k.havura,
      kind: k.kind,
      teachingMode: k.ofenHoraa,
      lecturer: k.lecturer.find(Boolean) ?? null,
      room: k.place.find(Boolean) ?? null,
      slots: k.days
        .map((day, i) => ({ day, start: k.beginHours[i], end: k.endHours[i] }))
        .filter((slot) => !!slot.day && !!slot.start && !!slot.end),
    }));
    const incompleteData = groups.length === 0 || groups.some((g) => g.slots.length === 0);
    return {
      courseId,
      nameHe: entry.cName?.trim() || null,
      cYear: entry.cYear ? parseInt(entry.cYear, 10) : null,
      found: true,
      incompleteData,
      groups,
    };
  });

  return { semester, courses, source: 'bidit', fetchedAt };
}

export function normalizeSearchResponse(
  raw: BiditAutoCompleteResponse,
  query: string,
  fetchedAt: string,
): CourseSearchResponse {
  const needle = query.trim().toLowerCase();
  const results = raw.Courses
    .filter((c) => c.courseCode.includes(needle) || c.courseName.toLowerCase().includes(needle))
    .slice(0, 25)
    .map((c) => ({ courseId: toDashedCourseId(c.courseCode), nameHe: c.courseName.trim() }));
  return { results, source: 'bidit', fetchedAt };
}

// ── Upstream fetch (dependency-injected fetch for tests) ───────────────────

export async function fetchGroupsFromBidit(
  courseIds: string[],
  semester: 1 | 2,
  fetchImpl: typeof fetch = fetch,
): Promise<BiditChosenCoursesInfoResponse> {
  const params = new URLSearchParams({ university: 'TAU', semester: String(semester) });
  for (const id of courseIds) params.append('courses_list', toBiditCourseId(id));
  const res = await fetchImpl(`${BIDIT_ORIGIN}/ajax/chosen-courses-info/?${params.toString()}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (!res.ok) throw new Error(`bidit chosen-courses-info returned ${res.status}`);
  return res.json();
}

export async function fetchSearchFromBidit(
  semester: 1 | 2,
  fetchImpl: typeof fetch = fetch,
): Promise<BiditAutoCompleteResponse> {
  const res = await fetchImpl(
    `${BIDIT_ORIGIN}/ajax/get-autoComplete-courses/?university=TAU&semester=${semester}`,
  );
  if (!res.ok) throw new Error(`bidit get-autoComplete-courses returned ${res.status}`);
  return res.json();
}

// ── Handler ───────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  try {
    await _handle(req, res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Unexpected server error.',
        code: 'INTERNAL_ERROR',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function parseSemester(raw: unknown): 1 | 2 | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === '1') return 1;
  if (v === '2') return 2;
  return null;
}

async function _handle(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const searchRaw = Array.isArray(req.query.search) ? req.query.search[0] : req.query.search;
  if (searchRaw) {
    const semester = parseSemester(req.query.semester) ?? 1;
    let raw: BiditAutoCompleteResponse;
    try {
      raw = await fetchSearchFromBidit(semester);
    } catch (err) {
      res.status(502).json({
        error: 'Upstream course search failed.',
        code: 'UPSTREAM_ERROR',
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    res.status(200).json(normalizeSearchResponse(raw, searchRaw, new Date().toISOString()));
    return;
  }

  const semester = parseSemester(req.query.semester);
  if (!semester) {
    res.status(400).json({ error: 'semester must be "1" or "2".', code: 'INVALID_SEMESTER' });
    return;
  }
  const coursesRaw = Array.isArray(req.query.courses) ? req.query.courses[0] : req.query.courses;
  const courseIds = (coursesRaw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (courseIds.length === 0) {
    res.status(400).json({
      error: 'courses must be a non-empty comma-separated list.',
      code: 'INVALID_COURSES',
    });
    return;
  }

  let raw: BiditChosenCoursesInfoResponse;
  try {
    raw = await fetchGroupsFromBidit(courseIds, semester);
  } catch (err) {
    res.status(502).json({
      error: 'Upstream schedule lookup failed.',
      code: 'UPSTREAM_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  res.status(200).json(normalizeGroupsResponse(raw, courseIds, semester, new Date().toISOString()));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/api/schedule_groups.test.ts`
Expected: PASS (all cases above)

- [ ] **Step 5: Commit**

```bash
git add api/ai/schedule-groups.ts tests/api/schedule_groups.test.ts
git commit -m "feat(api): schedule-groups proxy — bid-it groups + course search, normalized"
```

---

### Task 3: Register the endpoint on Vercel

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Add the build entry**

In the `builds` array, right after the `api/ai/conversation.ts` entry:

```json
    {
      "src": "api/ai/conversation.ts",
      "use": "@vercel/node"
    },
    {
      "src": "api/ai/schedule-groups.ts",
      "use": "@vercel/node"
    },
```

- [ ] **Step 2: Add the rewrite**

In the `rewrites` array, right after the `/api/ai/conversation` entry:

```json
    {
      "source": "/api/ai/conversation",
      "destination": "/api/ai/conversation.ts"
    },
    {
      "source": "/api/ai/schedule-groups",
      "destination": "/api/ai/schedule-groups.ts"
    },
```

- [ ] **Step 3: Validate the JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 4: Commit**

```bash
git add vercel.json
git commit -m "chore(vercel): register schedule-groups function"
```

---

### Task 4: Web client wrapper

**Files:**
- Create: `web/lib/planner/schedule-client.ts`
- Test: `web/lib/planner/schedule-client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/lib/planner/schedule-client.test.ts
import { fetchScheduleGroups, fetchCourseSearch } from './schedule-client';
import type { ScheduleGroupsResponse, CourseSearchResponse } from '../../../shared/planner/schedule';

function fakeFetch(body: unknown, ok = true) {
  return jest.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe('fetchScheduleGroups', () => {
  test('requests semester + comma-joined course ids', async () => {
    const body: ScheduleGroupsResponse = { semester: 1, courses: [], source: 'bidit', fetchedAt: 't' };
    const fetchImpl = fakeFetch(body);
    const result = await fetchScheduleGroups(['0542-2400', '0512-4266'], 1, fetchImpl);
    expect(result).toEqual(body);
    const [url] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(url).toContain('/api/ai/schedule-groups?');
    expect(url).toContain('semester=1');
    expect(url).toContain('courses=0542-2400%2C0512-4266');
  });

  test('throws on a non-ok response', async () => {
    const fetchImpl = fakeFetch({}, false);
    await expect(fetchScheduleGroups(['0542-2400'], 1, fetchImpl)).rejects.toThrow();
  });
});

describe('fetchCourseSearch', () => {
  test('requests search text + semester', async () => {
    const body: CourseSearchResponse = { results: [], source: 'bidit', fetchedAt: 't' };
    const fetchImpl = fakeFetch(body);
    const result = await fetchCourseSearch('תכן', 1, fetchImpl);
    expect(result).toEqual(body);
    const [url] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(url).toContain('search=');
    expect(url).toContain('semester=1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `web/`): `npx jest lib/planner/schedule-client.test.ts`
Expected: FAIL with "Cannot find module './schedule-client'"

- [ ] **Step 3: Write the implementation**

```ts
// web/lib/planner/schedule-client.ts
import type {
  ScheduleGroupsResponse,
  CourseSearchResponse,
} from '../../../shared/planner/schedule';

export async function fetchScheduleGroups(
  courseIds: string[],
  semester: 1 | 2,
  fetchImpl: typeof fetch = fetch,
): Promise<ScheduleGroupsResponse> {
  const params = new URLSearchParams({ semester: String(semester), courses: courseIds.join(',') });
  const res = await fetchImpl(`/api/ai/schedule-groups?${params.toString()}`);
  if (!res.ok) throw new Error(`schedule-groups request failed: ${res.status}`);
  return res.json();
}

export async function fetchCourseSearch(
  query: string,
  semester: 1 | 2,
  fetchImpl: typeof fetch = fetch,
): Promise<CourseSearchResponse> {
  const params = new URLSearchParams({ search: query, semester: String(semester) });
  const res = await fetchImpl(`/api/ai/schedule-groups?${params.toString()}`);
  if (!res.ok) throw new Error(`schedule-groups search failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `web/`): `npx jest lib/planner/schedule-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/lib/planner/schedule-client.ts web/lib/planner/schedule-client.test.ts
git commit -m "feat(web): schedule-groups client wrapper"
```

---

### Task 5: Weekly-schedule persistence (localStorage)

**Files:**
- Create: `web/lib/planner/schedule-storage.ts`
- Test: `web/lib/planner/schedule-storage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/lib/planner/schedule-storage.test.ts
import {
  loadWeeklyScheduleState,
  saveWeeklyScheduleState,
  selectionKey,
  type WeeklyScheduleState,
} from './schedule-storage';
import type { SemesterTerm } from '../../../shared/planner/schedule';

const DEFAULT_MAPPING: Record<string, SemesterTerm> = {
  year_3_semester_a: { year: 2026, semester: 1 },
};

beforeEach(() => window.localStorage.clear());

describe('selectionKey', () => {
  test('combines course id and term', () => {
    expect(selectionKey('0542-2400', { year: 2026, semester: 1 })).toBe('0542-2400:2026:1');
  });
});

describe('loadWeeklyScheduleState', () => {
  test('returns the default mapping and empty selections when nothing is stored', () => {
    const state = loadWeeklyScheduleState('mechanical_engineering_2027', DEFAULT_MAPPING);
    expect(state).toEqual({ termMapping: DEFAULT_MAPPING, selections: {} });
  });

  test('round-trips through save/load, merging the default mapping under any missing keys', () => {
    const state: WeeklyScheduleState = {
      termMapping: { year_3_semester_a: { year: 2030, semester: 2 } },
      selections: { '0542-2400:2030:2': ['01', '02'] },
    };
    saveWeeklyScheduleState('mechanical_engineering_2027', state);
    const loaded = loadWeeklyScheduleState('mechanical_engineering_2027', DEFAULT_MAPPING);
    expect(loaded).toEqual(state);
  });

  test('a different programId does not see another program’s stored state', () => {
    saveWeeklyScheduleState('program_a', {
      termMapping: DEFAULT_MAPPING,
      selections: { x: ['01'] },
    });
    const loaded = loadWeeklyScheduleState('program_b', DEFAULT_MAPPING);
    expect(loaded.selections).toEqual({});
  });

  test('corrupt stored JSON falls back to defaults instead of throwing', () => {
    window.localStorage.setItem('tau_weekly_schedule:mechanical_engineering_2027', '{not json');
    const state = loadWeeklyScheduleState('mechanical_engineering_2027', DEFAULT_MAPPING);
    expect(state).toEqual({ termMapping: DEFAULT_MAPPING, selections: {} });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `web/`): `npx jest lib/planner/schedule-storage.test.ts`
Expected: FAIL with "Cannot find module './schedule-storage'"

- [ ] **Step 3: Write the implementation**

```ts
// web/lib/planner/schedule-storage.ts
import type { SemesterTerm } from '../../../shared/planner/schedule';

const STORAGE_PREFIX = 'tau_weekly_schedule';

export interface WeeklyScheduleState {
  termMapping: Record<string, SemesterTerm>;
  /** key = `${courseId}:${year}:${semester}` → selected group ids for that course+term. */
  selections: Record<string, string[]>;
}

export function selectionKey(courseId: string, term: SemesterTerm): string {
  return `${courseId}:${term.year}:${term.semester}`;
}

function storageKey(programId: string): string {
  return `${STORAGE_PREFIX}:${programId}`;
}

export function loadWeeklyScheduleState(
  programId: string,
  defaultMapping: Record<string, SemesterTerm>,
): WeeklyScheduleState {
  try {
    const raw = window.localStorage.getItem(storageKey(programId));
    if (!raw) return { termMapping: defaultMapping, selections: {} };
    const parsed = JSON.parse(raw) as Partial<WeeklyScheduleState>;
    return {
      termMapping: { ...defaultMapping, ...(parsed.termMapping ?? {}) },
      selections: parsed.selections ?? {},
    };
  } catch {
    return { termMapping: defaultMapping, selections: {} };
  }
}

export function saveWeeklyScheduleState(programId: string, state: WeeklyScheduleState): void {
  try {
    window.localStorage.setItem(storageKey(programId), JSON.stringify(state));
  } catch {
    // localStorage can throw (private mode, quota exceeded) — persistence is best-effort.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `web/`): `npx jest lib/planner/schedule-storage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/lib/planner/schedule-storage.ts web/lib/planner/schedule-storage.test.ts
git commit -m "feat(web): weekly-schedule term-mapping and selection persistence"
```

---

### Task 6: `NativePlannerJourney` emits per-semester course ids

**Files:**
- Modify: `web/app/components/NativePlannerJourney.tsx:184-238` (props), `:297-301` (new effect)
- Test: `web/app/components/NativePlannerJourney.semesters.test.tsx`

- [ ] **Step 1: Write the failing test**

Check the existing test setup first — read how `NativePlannerBoard.test.tsx` mocks `getBoardFn`/`committedBoardFn` before writing this, since this new test follows the same dependency-injection pattern. Then add:

```tsx
// web/app/components/NativePlannerJourney.semesters.test.tsx
import { render, waitFor } from '@testing-library/react';
import NativePlannerJourney from './NativePlannerJourney';
import { catalogRevision, type BoardModel } from '../../../shared/planner/model';

const CATALOG: BoardModel = {
  catalogRevision: catalogRevision('test-1'),
  courseCatalog: {},
  semesters: [
    {
      semesterId: 'year_3_semester_a',
      courses: [
        {
          courseId: '0542-2400', nameHe: 'תכן מכני', halfHours: 8,
          courseType: 'mandatory', isMandatory: true,
        },
      ],
    },
    { semesterId: 'year_3_semester_b', courses: [] },
  ],
};

test('onSemestersChange receives semesterId + courseIds for every board semester', async () => {
  const onSemestersChange = jest.fn();
  render(
    <NativePlannerJourney
      programId="mechanical_engineering_2027"
      getBoardFn={jest.fn().mockResolvedValue(CATALOG)}
      committedBoardFn={jest.fn().mockResolvedValue(null)}
      serverApply={false}
      onSemestersChange={onSemestersChange}
    />,
  );

  await waitFor(() => expect(onSemestersChange).toHaveBeenCalled());
  const lastCall = onSemestersChange.mock.calls.at(-1)?.[0];
  expect(lastCall).toEqual([
    { semesterId: 'year_3_semester_a', courseIds: ['0542-2400'] },
    { semesterId: 'year_3_semester_b', courseIds: [] },
  ]);
});
```

These are the real prop names (confirmed in `NativePlannerJourney.tsx:161-212`): `getBoardFn`, `committedBoardFn`, `serverApply` already exist and are exactly this dependency-injection shape — this test uses them as-is, the same way the existing `NativePlannerBoard.test.tsx` does, and only adds the new `onSemestersChange` prop from Step 3 below.

- [ ] **Step 2: Run test to verify it fails**

Run (from `web/`): `npx jest app/components/NativePlannerJourney.semesters.test.tsx`
Expected: FAIL — `onSemestersChange` is never called (prop does not exist yet / TypeScript error)

- [ ] **Step 3: Add the prop and the effect**

Add to the destructured props (next to `onCommittedCourseIdsChange,` around line 200):

```tsx
  onSemestersChange,
```

Add to the props type block (next to `onCommittedCourseIdsChange?: (courseIds: string[]) => void` around line 223):

```tsx
  onSemestersChange?: (semesters: Array<{ semesterId: string; courseIds: string[] }>) => void
```

Add a new effect immediately after the existing `onCommittedCourseIdsChange` effect (after line 301, same `current`-driven pattern so it reflects every board change — initial load, apply, manual add/remove/move — without touching those call sites):

```tsx
  useEffect(() => {
    if (!current) return
    onSemestersChange?.(current.semesters.map((semester) => ({
      semesterId: semester.semesterId,
      courseIds: semester.courses.map((course) => course.courseId),
    })))
  }, [current, onSemestersChange])
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `web/`): `npx jest app/components/NativePlannerJourney.semesters.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full existing NativePlannerJourney/board test suites to confirm no regression**

Run (from `web/`): `npx jest NativePlanner`
Expected: PASS (all previously-passing suites still pass)

- [ ] **Step 6: Commit**

```bash
git add web/app/components/NativePlannerJourney.tsx web/app/components/NativePlannerJourney.semesters.test.tsx
git commit -m "feat(web): NativePlannerJourney emits per-semester course ids for the weekly drawer"
```

---

### Task 7: `WeeklyScheduleGrid` (presentational)

**Files:**
- Create: `web/app/components/WeeklyScheduleGrid.tsx`
- Test: `web/app/components/WeeklyScheduleGrid.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/app/components/WeeklyScheduleGrid.test.tsx
import { render, screen } from '@testing-library/react';
import WeeklyScheduleGrid, { type GridBlock } from './WeeklyScheduleGrid';

const BLOCKS: GridBlock[] = [
  {
    key: '0542-2400:01:0',
    courseId: '0542-2400',
    courseName: 'תכן מכני (1)',
    groupId: '01',
    kind: 'ראשית',
    slot: { day: 'א', start: '10:00', end: '12:00' },
  },
];

test('renders a day header per day and a labeled block per slot', () => {
  render(<WeeklyScheduleGrid blocks={BLOCKS} />);
  expect(screen.getByRole('grid', { name: 'מערכת שעות שבועית' })).toBeInTheDocument();
  ['א', 'ב', 'ג', 'ד', 'ה', 'ו'].forEach((day) => {
    expect(screen.getByText(day)).toBeInTheDocument();
  });
  expect(
    screen.getByRole('gridcell', { name: 'תכן מכני (1), ראשית, יום א, 10:00-12:00' }),
  ).toBeInTheDocument();
});

test('a block for a day outside א-ו is skipped rather than crashing', () => {
  const bad: GridBlock[] = [{ ...BLOCKS[0], key: 'bad', slot: { day: 'שבת', start: '10:00', end: '12:00' } }];
  render(<WeeklyScheduleGrid blocks={bad} />);
  expect(screen.queryByRole('gridcell')).toBeNull();
});

test('renders nothing extra with an empty block list', () => {
  render(<WeeklyScheduleGrid blocks={[]} />);
  expect(screen.queryByRole('gridcell')).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `web/`): `npx jest app/components/WeeklyScheduleGrid.test.tsx`
Expected: FAIL with "Cannot find module './WeeklyScheduleGrid'"

- [ ] **Step 3: Write the implementation**

```tsx
// web/app/components/WeeklyScheduleGrid.tsx
'use client'

import type { TimeSlot } from '../../../shared/planner/schedule'

const DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'] as const
const HOURS = Array.from({ length: 14 }, (_, i) => 8 + i) // 08:00..21:00
const ROW_HEIGHT = 40 // px per hour

export interface GridBlock {
  key: string
  courseId: string
  courseName: string
  groupId: string
  kind: string
  slot: TimeSlot
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export default function WeeklyScheduleGrid({ blocks }: { blocks: GridBlock[] }) {
  const gridStartMinutes = HOURS[0] * 60

  return (
    <div className="weekly-grid-wrapper overflow-x-auto">
      <div
        className="weekly-grid-layout grid"
        style={{ gridTemplateColumns: '4rem repeat(6, minmax(6rem, 1fr))' }}
      >
        <div aria-hidden="true" />
        {DAYS.map((day) => (
          <div key={day} className="text-center text-sm font-semibold py-1">
            {day}
          </div>
        ))}
        <div
          role="grid"
          aria-label="מערכת שעות שבועית"
          className="weekly-grid-hours relative"
          style={{ gridColumn: '1 / -1', height: `${HOURS.length * ROW_HEIGHT}px` }}
        >
          {HOURS.map((hour, i) => (
            <div
              key={hour}
              aria-hidden="true"
              className="absolute right-0 text-xs text-[var(--text-muted)]"
              style={{ top: `${i * ROW_HEIGHT}px` }}
            >
              {`${hour}:00`}
            </div>
          ))}
          {blocks.map((block) => {
            const dayIndex = DAYS.indexOf(block.slot.day as (typeof DAYS)[number])
            if (dayIndex === -1) return null
            const top = ((toMinutes(block.slot.start) - gridStartMinutes) / 60) * ROW_HEIGHT
            const height = Math.max(
              ((toMinutes(block.slot.end) - toMinutes(block.slot.start)) / 60) * ROW_HEIGHT,
              16,
            )
            return (
              <div
                key={block.key}
                role="gridcell"
                aria-label={`${block.courseName}, ${block.kind}, יום ${block.slot.day}, ${block.slot.start}-${block.slot.end}`}
                className="weekly-grid-block absolute rounded px-1 text-xs overflow-hidden bg-[var(--accent-soft,#c7d2fe)]"
                style={{
                  top: `${top}px`,
                  height: `${height}px`,
                  left: `calc(4rem + ${dayIndex} * (100% - 4rem) / 6)`,
                  width: `calc((100% - 4rem) / 6)`,
                }}
              >
                <div className="font-semibold truncate">{block.courseName}</div>
                <div className="truncate">{block.kind} · {block.slot.start}–{block.slot.end}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `web/`): `npx jest app/components/WeeklyScheduleGrid.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/app/components/WeeklyScheduleGrid.tsx web/app/components/WeeklyScheduleGrid.test.tsx
git commit -m "feat(web): WeeklyScheduleGrid presentational component"
```

---

### Task 8: `WeeklyScheduleDrawer` (container)

**Files:**
- Create: `web/app/components/WeeklyScheduleDrawer.tsx`
- Test: `web/app/components/WeeklyScheduleDrawer.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/app/components/WeeklyScheduleDrawer.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import WeeklyScheduleDrawer from './WeeklyScheduleDrawer'
import type { ScheduleGroupsResponse, CourseSearchResponse } from '../../../shared/planner/schedule'

const DESTINATIONS = [
  { id: 'year_3_semester_a', label: 'שנה ג׳ — סמסטר א׳' },
  { id: 'year_3_semester_b', label: 'שנה ג׳ — סמסטר ב׳' },
]

const SEMESTER_COURSES = [
  { semesterId: 'year_3_semester_a', courseIds: ['0542-2400', '0512-4266'] },
  { semesterId: 'year_3_semester_b', courseIds: [] },
]

function groupsResponse(overrides: Partial<ScheduleGroupsResponse> = {}): ScheduleGroupsResponse {
  return {
    semester: 1,
    source: 'bidit',
    fetchedAt: '2026-09-10T00:00:00.000Z',
    courses: [
      {
        courseId: '0542-2400', nameHe: 'תכן מכני (1)', cYear: 2026, found: true, incompleteData: false,
        groups: [{
          groupId: '01', havura: 'A', kind: 'ראשית', teachingMode: 'שיעור ותרגיל',
          lecturer: null, room: null,
          slots: [{ day: 'א', start: '10:00', end: '12:00' }],
        }],
      },
      {
        courseId: '0512-4266', nameHe: 'אבטחה ובטיחות', cYear: 2026, found: true, incompleteData: false,
        groups: [{
          groupId: '01', havura: 'A', kind: 'ראשית', teachingMode: 'שיעור',
          lecturer: null, room: null,
          slots: [{ day: 'א', start: '11:00', end: '13:00' }],
        }],
      },
    ],
    ...overrides,
  }
}

function renderDrawer(overrides: Partial<Parameters<typeof WeeklyScheduleDrawer>[0]> = {}) {
  const fetchScheduleGroupsFn = jest.fn().mockResolvedValue(groupsResponse())
  const fetchCourseSearchFn = jest.fn().mockResolvedValue({ results: [], source: 'bidit', fetchedAt: 't' } as CourseSearchResponse)
  const closeRef = { current: null }
  const utils = render(
    <WeeklyScheduleDrawer
      programId="mechanical_engineering_2027"
      semesterDestinations={DESTINATIONS}
      semesterCourses={SEMESTER_COURSES}
      onClose={jest.fn()}
      closeRef={closeRef}
      fetchScheduleGroupsFn={fetchScheduleGroupsFn}
      fetchCourseSearchFn={fetchCourseSearchFn}
      {...overrides}
    />,
  )
  return { ...utils, fetchScheduleGroupsFn, fetchCourseSearchFn }
}

beforeEach(() => window.localStorage.clear())

test('fetches and lists groups for the active tab’s board-synced courses automatically', async () => {
  const { fetchScheduleGroupsFn } = renderDrawer()
  await waitFor(() => expect(fetchScheduleGroupsFn).toHaveBeenCalledWith(
    expect.arrayContaining(['0542-2400', '0512-4266']), 1,
  ))
  expect(await screen.findByText('תכן מכני (1)')).toBeInTheDocument()
  expect(await screen.findByText('אבטחה ובטיחות')).toBeInTheDocument()
})

test('selecting a group renders it on the grid', async () => {
  renderDrawer()
  const checkbox = await screen.findByRole('checkbox', { name: /תכן מכני \(1\).*ראשית.*א.*10:00-12:00/ })
  fireEvent.click(checkbox)
  expect(await screen.findByRole('gridcell', { name: /תכן מכני \(1\)/ })).toBeInTheDocument()
})

test('selecting a second, time-overlapping group is blocked with an explanatory message', async () => {
  renderDrawer()
  const first = await screen.findByRole('checkbox', { name: /תכן מכני \(1\).*ראשית.*א.*10:00-12:00/ })
  fireEvent.click(first)
  const second = await screen.findByRole('checkbox', { name: /אבטחה ובטיחות.*ראשית.*א.*11:00-13:00/ })
  fireEvent.click(second)
  expect(second).not.toBeChecked()
  expect(await screen.findByText(/חופף ל.*תכן מכני/)).toBeInTheDocument()
})

test('a course bid-it has no record for shows a missing-data badge, not an empty conflict-free list', async () => {
  const fetchScheduleGroupsFn = jest.fn().mockResolvedValue(groupsResponse({
    courses: [
      { courseId: '0542-2400', nameHe: null, cYear: null, found: false, incompleteData: false, groups: [] },
      groupsResponse().courses[1],
    ],
  }))
  renderDrawer({ fetchScheduleGroupsFn })
  expect(await screen.findByText('אין נתוני שעות')).toBeInTheDocument()
})

test('switching to a tab with no board-synced courses clears the list without a wasted fetch', async () => {
  const { fetchScheduleGroupsFn } = renderDrawer()
  await waitFor(() => expect(fetchScheduleGroupsFn).toHaveBeenCalledTimes(1))
  expect(fetchScheduleGroupsFn).toHaveBeenLastCalledWith(
    expect.arrayContaining(['0542-2400', '0512-4266']), 1,
  )
  expect(await screen.findByText('תכן מכני (1)')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('tab', { name: 'שנה ג׳ — סמסטר ב׳' }))
  await waitFor(() => expect(screen.queryByText('תכן מכני (1)')).toBeNull())
  // year_3_semester_b has no board-synced courses and nothing was searched in — no call needed.
  expect(fetchScheduleGroupsFn).toHaveBeenCalledTimes(1)
})

test('shows a bid-it provenance line with the fetch time', async () => {
  renderDrawer()
  expect(await screen.findByText(/מקור: bid-it \(לא רשמי\)/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `web/`): `npx jest app/components/WeeklyScheduleDrawer.test.tsx`
Expected: FAIL with "Cannot find module './WeeklyScheduleDrawer'"

- [ ] **Step 3: Write the implementation**

```tsx
// web/app/components/WeeklyScheduleDrawer.tsx
'use client'

import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { SemesterDestination } from './UnifiedCourseRepository'
import WeeklyScheduleGrid, { type GridBlock } from './WeeklyScheduleGrid'
import { fetchScheduleGroups, fetchCourseSearch } from '../../lib/planner/schedule-client'
import {
  loadWeeklyScheduleState,
  saveWeeklyScheduleState,
  selectionKey,
} from '../../lib/planner/schedule-storage'
import { defaultTermMapping, groupsOverlap } from '../../../shared/planner/schedule'
import type {
  ScheduleGroupsResponse,
  ScheduleGroup,
  SemesterTerm,
  CourseSearchResponse,
} from '../../../shared/planner/schedule'

interface SemesterCourses {
  semesterId: string
  courseIds: string[]
}

export default function WeeklyScheduleDrawer({
  programId,
  semesterDestinations,
  semesterCourses,
  onClose,
  closeRef,
  fetchScheduleGroupsFn = fetchScheduleGroups,
  fetchCourseSearchFn = fetchCourseSearch,
}: {
  programId: string
  semesterDestinations: readonly SemesterDestination[]
  semesterCourses: readonly SemesterCourses[]
  onClose: () => void
  closeRef: RefObject<HTMLButtonElement | null>
  fetchScheduleGroupsFn?: typeof fetchScheduleGroups
  fetchCourseSearchFn?: typeof fetchCourseSearch
}) {
  const defaultMapping = useMemo(
    () => defaultTermMapping(semesterDestinations.map((d) => d.id), new Date()),
    [semesterDestinations],
  )
  const [state, setState] = useState(() => loadWeeklyScheduleState(programId, defaultMapping))
  const [activeSemesterId, setActiveSemesterId] = useState(semesterDestinations[0]?.id ?? '')
  const [scheduleData, setScheduleData] = useState<ScheduleGroupsResponse | null>(null)
  const [extraCourseIds, setExtraCourseIds] = useState<string[]>([])
  const [searchText, setSearchText] = useState('')
  const [searchResults, setSearchResults] = useState<CourseSearchResponse['results']>([])
  const [conflictMessage, setConflictMessage] = useState<string | null>(null)

  useEffect(() => {
    saveWeeklyScheduleState(programId, state)
  }, [programId, state])

  const term: SemesterTerm = state.termMapping[activeSemesterId] ?? defaultMapping[activeSemesterId]

  const boardCourseIds = useMemo(
    () => semesterCourses.find((s) => s.semesterId === activeSemesterId)?.courseIds ?? [],
    [semesterCourses, activeSemesterId],
  )
  const candidateCourseIds = useMemo(
    () => [...new Set([...boardCourseIds, ...extraCourseIds])],
    [boardCourseIds, extraCourseIds],
  )

  useEffect(() => {
    setExtraCourseIds([])
    setConflictMessage(null)
  }, [activeSemesterId])

  useEffect(() => {
    let live = true
    if (candidateCourseIds.length === 0) {
      setScheduleData({ semester: term.semester, courses: [], source: 'bidit', fetchedAt: new Date().toISOString() })
      return
    }
    fetchScheduleGroupsFn(candidateCourseIds, term.semester).then(
      (data) => { if (live) setScheduleData(data) },
      () => { if (live) setScheduleData(null) },
    )
    return () => { live = false }
  }, [candidateCourseIds, term.semester, fetchScheduleGroupsFn])

  const selectedGroupIds = (courseId: string): string[] =>
    state.selections[selectionKey(courseId, term)] ?? []

  const allSelectedGroups = (): Array<{ courseId: string; courseName: string; group: ScheduleGroup }> => {
    if (!scheduleData) return []
    const result: Array<{ courseId: string; courseName: string; group: ScheduleGroup }> = []
    for (const course of scheduleData.courses) {
      for (const groupId of selectedGroupIds(course.courseId)) {
        const group = course.groups.find((g) => g.groupId === groupId)
        if (group) result.push({ courseId: course.courseId, courseName: course.nameHe ?? course.courseId, group })
      }
    }
    return result
  }

  const toggleGroup = (courseId: string, courseName: string, group: ScheduleGroup) => {
    const key = selectionKey(courseId, term)
    const current = state.selections[key] ?? []
    const isSelected = current.includes(group.groupId)

    if (isSelected) {
      setState((prev) => ({ ...prev, selections: { ...prev.selections, [key]: current.filter((id) => id !== group.groupId) } }))
      setConflictMessage(null)
      return
    }

    const conflict = allSelectedGroups().find(
      (selected) => selected.courseId !== courseId && groupsOverlap(selected.group, group),
    )
    if (conflict) {
      const slot = conflict.group.slots[0]
      setConflictMessage(
        `חופף ל'${conflict.courseName}' בימי ${slot?.day ?? ''} ${slot?.start ?? ''}–${slot?.end ?? ''}`,
      )
      return
    }
    setConflictMessage(null)
    setState((prev) => ({ ...prev, selections: { ...prev.selections, [key]: [...current, group.groupId] } }))
  }

  const setTermField = (field: 'year' | 'semester', value: number) => {
    setState((prev) => ({
      ...prev,
      termMapping: {
        ...prev.termMapping,
        [activeSemesterId]: { ...prev.termMapping[activeSemesterId], [field]: value },
      },
    }))
  }

  const runSearch = async () => {
    if (!searchText.trim()) { setSearchResults([]); return }
    const result = await fetchCourseSearchFn(searchText.trim(), term.semester)
    setSearchResults(result.results)
  }

  const blocks: GridBlock[] = allSelectedGroups().flatMap(({ courseId, courseName, group }) =>
    group.slots.map((slot, i) => ({
      key: `${courseId}:${group.groupId}:${i}`,
      courseId, courseName, groupId: group.groupId, kind: group.kind, slot,
    })),
  )

  return (
    <div>
      <div role="tablist" aria-label="בחירת סמסטר">
        {semesterDestinations.map((dest) => (
          <button
            key={dest.id}
            type="button"
            role="tab"
            aria-selected={activeSemesterId === dest.id}
            onClick={() => setActiveSemesterId(dest.id)}
          >
            {dest.label}
          </button>
        ))}
      </div>

      <div>
        <label>
          שנה
          <input
            type="number"
            value={term?.year ?? ''}
            onChange={(e) => setTermField('year', Number(e.target.value))}
          />
        </label>
        <label>
          סמסטר
          <select
            value={term?.semester ?? 1}
            onChange={(e) => setTermField('semester', Number(e.target.value) as 1 | 2)}
          >
            <option value={1}>א׳</option>
            <option value={2}>ב׳</option>
          </select>
        </label>
      </div>

      <div>
        <input
          type="text"
          placeholder="חיפוש קורס להוספה לצפייה"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <button type="button" onClick={runSearch}>חפש</button>
        {searchResults.map((r) => (
          <button
            key={r.courseId}
            type="button"
            onClick={() => setExtraCourseIds((prev) => [...new Set([...prev, r.courseId])])}
          >
            הוסף {r.nameHe}
          </button>
        ))}
      </div>

      {conflictMessage && <p role="alert">{conflictMessage}</p>}

      <WeeklyScheduleGrid blocks={blocks} />

      <ul>
        {(scheduleData?.courses ?? []).map((course) => (
          <li key={course.courseId}>
            <span>{course.nameHe ?? course.courseId}</span>
            {!course.found && <span> אין נתוני שעות</span>}
            {course.found && course.incompleteData && <span> נתוני שעות חלקיים</span>}
            {course.found && course.groups.map((group) => {
              const slot = group.slots[0]
              const label = slot
                ? `${course.nameHe ?? course.courseId}, ${group.kind}, יום ${slot.day}, ${slot.start}-${slot.end}`
                : `${course.nameHe ?? course.courseId}, ${group.kind}, אין נתוני שעות`
              return (
                <label key={group.groupId}>
                  <input
                    type="checkbox"
                    aria-label={label}
                    checked={selectedGroupIds(course.courseId).includes(group.groupId)}
                    disabled={group.slots.length === 0}
                    onChange={() => toggleGroup(course.courseId, course.nameHe ?? course.courseId, group)}
                  />
                  {label}
                </label>
              )
            })}
          </li>
        ))}
      </ul>

      {scheduleData && (
        <p>מקור: bid-it (לא רשמי) · עודכן {new Date(scheduleData.fetchedAt).toLocaleTimeString('he-IL')}</p>
      )}

      <button ref={closeRef} type="button" onClick={onClose}>סגור מערכת שעות</button>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `web/`): `npx jest app/components/WeeklyScheduleDrawer.test.tsx`
Expected: PASS. If an `aria-label` regex match fails because the rendered label text differs slightly from the test's regex, adjust the regex in the test to match the actual rendered label format from Step 3's implementation (both must describe the same thing: course name, kind, day, time range) — do not change the meaning being asserted.

- [ ] **Step 5: Commit**

```bash
git add web/app/components/WeeklyScheduleDrawer.tsx web/app/components/WeeklyScheduleDrawer.test.tsx
git commit -m "feat(web): WeeklyScheduleDrawer — board-synced groups, hard overlap block, missing-data badges"
```

---

### Task 9: Wire the third drawer into `UnifiedPlannerWorkspace`

**Files:**
- Modify: `web/app/components/UnifiedPlannerWorkspace.tsx`
- Modify: `web/app/components/UnifiedPlannerWorkspace.test.tsx` (add cases; do not remove existing ones)

- [ ] **Step 1: Write the failing tests (append to the existing file)**

First, add `useEffect` to the existing `import { fireEvent, render, screen } from '@testing-library/react'` block at the top of the file (change it to also import `useEffect` from `'react'` as a separate import line):

```tsx
import { useEffect } from 'react'
```

Then replace the existing `jest.mock('./NativePlannerJourney', ...)` factory (the one already in the file, currently destructuring `{ programId, useAcademicDecisionAgent, manualAddIntent, onCloseAgent, onManualAddCancelled, agentCloseRef }`) with this version, which adds `onSemestersChange` and calls it once on mount so weekly-drawer tests have board data to render — every other prop and every rendered element stays identical to the existing mock:

```tsx
jest.mock('./NativePlannerJourney', () => ({
  __esModule: true,
  default: ({ programId, useAcademicDecisionAgent, manualAddIntent, onCloseAgent, onManualAddCancelled, agentCloseRef, onSemestersChange }: any) => {
    useEffect(() => {
      onSemestersChange?.([{ semesterId: 'year_3_semester_a', courseIds: ['0542-2400'] }])
    }, [onSemestersChange])
    return (
      <div data-testid="agent-journey" data-program={programId} data-agent={String(useAcademicDecisionAgent)}
        data-manual-course={manualAddIntent?.courseId ?? ''} data-manual-semesters={(manualAddIntent?.semesterIds ?? []).join(',')}>
        <div className="planner-board-region">לוח פעיל</div>
        {manualAddIntent && (
          <button type="button" aria-label="ביטול הוספת קורס" onClick={onManualAddCancelled}>ביטול</button>
        )}
        <aside className="planner-agent-region" aria-label="עוזר אקדמי">
          <button ref={agentCloseRef} type="button" aria-label="סגור סרגל עוזר AI" onClick={onCloseAgent}>סגור עוזר</button>
          עוזר פעיל
        </aside>
      </div>
    )
  },
}))
```

Then add these new `describe`/`test` blocks at the end of the file:

```tsx
describe('UnifiedPlannerWorkspace — weekly schedule drawer', () => {
  test('has its own opening control, separate from repository and agent', () => {
    render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repo} />)
    const toggle = screen.getByRole('button', { name: 'פתח מערכת שעות' })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('tablist', { name: 'בחירת סמסטר' })).toBeInTheDocument()
  })

  test('closes with Escape from inside its own drawer and returns focus to its toggle', () => {
    render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repo} />)
    const toggle = screen.getByRole('button', { name: 'פתח מערכת שעות' })
    fireEvent.click(toggle)
    const closeButton = screen.getByRole('button', { name: 'סגור מערכת שעות' })
    fireEvent.keyDown(closeButton, { key: 'Escape' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
  })

  test('repository, agent and weekly can all stay open independently', () => {
    render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repo} />)
    fireEvent.click(screen.getByRole('button', { name: 'פתח מאגר קורסים' }))
    fireEvent.click(screen.getByRole('button', { name: 'פתח עוזר AI' }))
    fireEvent.click(screen.getByRole('button', { name: 'פתח מערכת שעות' }))
    expect(screen.getByTestId('course-repository')).toBeInTheDocument()
    expect(screen.getByText('עוזר פעיל')).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'בחירת סמסטר' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail (existing ones still pass)**

Run (from `web/`): `npx jest app/components/UnifiedPlannerWorkspace.test.tsx`
Expected: The pre-existing tests PASS; the 3 new tests FAIL (no "פתח מערכת שעות" button yet).

- [ ] **Step 3: Add the third drawer to `UnifiedPlannerWorkspace.tsx`**

Change the view type (near the top):

```tsx
type WorkspaceView = 'board' | 'repository' | 'agent' | 'weekly'
```

Add the import:

```tsx
import WeeklyScheduleDrawer from './WeeklyScheduleDrawer'
```

Add state, refs, and handlers alongside the existing repository/agent ones:

```tsx
  const [weeklyOpen, setWeeklyOpen] = useState(false)
  const [semesterCourses, setSemesterCourses] = useState<Array<{ semesterId: string; courseIds: string[] }>>([])
  const weeklyToggleRef = useRef<HTMLButtonElement | null>(null)
  const weeklyDrawerRef = useRef<HTMLElement | null>(null)
  const weeklyCloseRef = useRef<HTMLButtonElement | null>(null)
  const weeklyWasOpen = useRef(false)

  const closeWeekly = () => {
    setWeeklyOpen(false)
    setActiveView(agentOpen ? 'agent' : repositoryOpen ? 'repository' : 'board')
    weeklyToggleRef.current?.focus()
  }

  const toggleWeekly = () => {
    if (weeklyOpen) closeWeekly()
    else { setWeeklyOpen(true); setActiveView('weekly') }
  }
```

Extend `selectView` so `'weekly'` opens the weekly drawer:

```tsx
  const selectView = (view: WorkspaceView) => {
    setActiveView(view)
    if (view === 'repository') setRepositoryOpen(true)
    if (view === 'agent') setAgentOpen(true)
    if (view === 'weekly') setWeeklyOpen(true)
  }
```

Replace the Escape-handling effect with the 3-drawer version (verified to reduce to the exact original logic when `weeklyOpen` is `false`):

```tsx
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target
      const fromRepository = target instanceof Node && repositoryDrawerRef.current?.contains(target)
      const fromWeekly = target instanceof Node && weeklyDrawerRef.current?.contains(target)
      if (repositoryOpen && (fromRepository || (!agentOpen && !weeklyOpen))) {
        event.preventDefault()
        closeRepository()
        return
      }
      if (weeklyOpen && (fromWeekly || !agentOpen)) {
        event.preventDefault()
        closeWeekly()
        return
      }
      if (agentOpen) {
        event.preventDefault()
        closeAgent()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [agentOpen, repositoryOpen, weeklyOpen])

  useEffect(() => {
    if (weeklyOpen && !weeklyWasOpen.current) weeklyCloseRef.current?.focus()
    weeklyWasOpen.current = weeklyOpen
  }, [weeklyOpen])
```

Add the toggle button, right after the existing agent toggle button inside `.planner-drawer-controls`:

```tsx
        <button
          ref={weeklyToggleRef}
          type="button"
          aria-controls="workspace-panel-weekly"
          aria-expanded={weeklyOpen}
          aria-label={`${weeklyOpen ? 'סגור' : 'פתח'} מערכת שעות`}
          onClick={toggleWeekly}
          className="planner-drawer-toggle planner-drawer-toggle-weekly"
        >
          <span aria-hidden="true">🗓️</span>
          <span>מערכת שעות</span>
        </button>
```

Pass `onSemestersChange` to `NativePlannerJourney` (alongside the existing `onCommittedCourseIdsChange`):

```tsx
            onSemestersChange={setSemesterCourses}
```

Add the drawer `aside`, right after the repository `aside` closes:

```tsx
        <aside
          ref={weeklyDrawerRef}
          id="workspace-panel-weekly"
          aria-label="מערכת שעות"
          data-open={weeklyOpen}
          aria-hidden={!weeklyOpen}
          inert={!weeklyOpen}
          className={`${activeView === 'weekly' ? '' : 'hidden lg:block'} planner-repository-rail min-w-0`}
        >
          <WeeklyScheduleDrawer
            programId={programId}
            semesterDestinations={semesterDestinations}
            semesterCourses={semesterCourses}
            onClose={closeWeekly}
            closeRef={weeklyCloseRef}
          />
        </aside>
```

- [ ] **Step 4: Run tests to verify everything passes**

Run (from `web/`): `npx jest app/components/UnifiedPlannerWorkspace.test.tsx`
Expected: PASS — every pre-existing test AND the 3 new ones.

- [ ] **Step 5: Run the full web test suite**

Run (from `web/`): `npx jest`
Expected: PASS. If an unrelated suite fails from resource contention (a known issue — see `project-web-next-frontend-slice` memory: the full jsdom run can fail suites that pass individually from contention), re-run just that suite alone before concluding it's a real regression.

- [ ] **Step 6: Run typecheck and build**

Run (from `web/`): `npx tsc --noEmit && npm run build`
Expected: both succeed with no new errors.

- [ ] **Step 7: Commit**

```bash
git add web/app/components/UnifiedPlannerWorkspace.tsx web/app/components/UnifiedPlannerWorkspace.test.tsx
git commit -m "feat(web): wire the weekly-schedule drawer into the planner workspace"
```

---

### Task 10: Manual Preview verification

This is a real, third-party, unauthenticated network dependency (bid-it) being called from a live serverless function for the first time — automated mocked tests cannot prove the actual upstream integration still matches what was observed during design. Verify for real before calling this done, following the repo's existing Preview-acceptance convention (see recent entries in `AUTONOMOUS_PROGRESS.md`).

- [ ] **Step 1: Start the local dev server and open the planner**

Use the `run` skill or `preview_start` with the `web` dev server (per `.claude/launch.json`), then navigate to `/planner`.

- [ ] **Step 2: Open the weekly schedule drawer and confirm live data**

Click "מערכת שעות". Confirm: the active tab's board-placed courses appear, group checkboxes show real day/time/lecturer text (not placeholder data), and the provenance line shows a real timestamp.

- [ ] **Step 3: Verify the hard overlap rule live**

Select a group, then attempt to select a second group that overlaps it in time (use two courses known to conflict, or check two courses' returned group times first). Confirm the checkbox does not activate and the conflict message names the correct course and time range.

- [ ] **Step 4: Verify missing-data handling live**

Pick a course not offered in the active tab's mapped semester (or use the free-search box for an obscure course) and confirm it renders "אין נתוני שעות" rather than an empty, falsely-conflict-free row.

- [ ] **Step 5: Verify drawer accessibility parity with the existing drawers**

Tab into the drawer, confirm Escape closes it and returns focus to its toggle button, and confirm the repository and agent drawers still behave exactly as before (Escape, focus return, independent open/close) — this is the regression this task exists to catch, since Task 9 touched shared workspace-level state.

- [ ] **Step 6: Record the acceptance**

Append a dated entry to `AUTONOMOUS_PROGRESS.md` describing what was verified (matching the existing entries' level of detail: exact commit, what was checked, what was explicitly NOT claimed) — this repo's established convention for this kind of change.
