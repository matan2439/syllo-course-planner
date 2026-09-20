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
