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
