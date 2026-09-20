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
