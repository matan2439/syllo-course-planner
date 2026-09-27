/**
 * GET /api/ai/course-insights?course_id=0542-4010&program_id=mechanical_engineering_2027
 *
 * What the course panel shows next to the co-pilot chat: historical grade
 * statistics (configured community sources), the course's syllabus (board data
 * plus the official page), and suggestion chips derived from that data. The same
 * provider backs the co-pilot's get_course_grades / get_course_syllabus tools.
 * Read-only, no AI call, no quota.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { loadLocalBoardJson } from './board_loader';
import { buildCourseProfiles } from './course_profile';
import { loadCourseInsightConfig } from './course_insights/config';
import {
  buildCourseSuggestions,
  defaultCourseInsights,
  type CourseInsightsProvider,
} from './course_insights';
import type { CourseInsightsResponse } from './course_insights/types';

const querySchema = z.object({
  course_id: z.string().trim().min(1).max(64),
  program_id: z.string().trim().min(1).max(128).regex(/^[\w-]+$/),
});

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export async function courseInsights(
  courseId: string,
  programId: string,
  provider: CourseInsightsProvider = defaultCourseInsights(),
): Promise<CourseInsightsResponse> {
  const board = loadLocalBoardJson(programId);
  const profile = board ? buildCourseProfiles(board).get(courseId) : undefined;
  const name = profile?.name_he ?? courseId;
  const [grades, syllabus] = await Promise.all([
    provider.grades(courseId),
    profile?.syllabus_details ? provider.syllabus(courseId, profile.syllabus_details) : Promise.resolve(null),
  ]);
  return {
    course_id: courseId,
    name_he: profile?.name_he ?? null,
    grades,
    syllabus,
    suggestions_he: buildCourseSuggestions({
      name,
      grades,
      syllabus,
      hasPrerequisites: (profile?.prerequisites.length ?? 0) > 0,
    }),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const parsed = querySchema.safeParse({ course_id: first(req.query.course_id), program_id: first(req.query.program_id) });
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'INVALID_REQUEST', details: parsed.error.issues.map((i) => i.path.join('.')) });
    return;
  }
  try {
    const body = await courseInsights(parsed.data.course_id, parsed.data.program_id);
    const maxAge = loadCourseInsightConfig().insights.http_cache_max_age_seconds;
    res.setHeader('Cache-Control', `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge}`);
    res.status(200).json(body);
  } catch (error) {
    console.error('[course-insights] failed:', (error as Error)?.message);
    res.status(503).json({ error: 'לא ניתן לטעון את נתוני הקורס כרגע.', code: 'INSIGHTS_UNAVAILABLE' });
  }
}
