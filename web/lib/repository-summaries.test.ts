import type { GradeSourceConfig } from '../../api/ai/course_insights/config'
import { summarizeRepositorySnapshots as summarize } from './repository-summaries'
const source: GradeSourceConfig = { id: 'tauplus', kind: 'tauplus_butterknife', label_he: 'TAU+', url: 'https://example.test/api', attribution_url: 'https://example.test/grades', enabled: true, ttl_seconds: 1, timeout_ms: 1 }

test('batch snapshot summaries share detail aggregation rules and retain sample, source and snapshot context', () => {
  const summaries = summarize(['0542-4120', '0542-9999'], [{ source, snapshot: {
    generated_at: '2026-09-27T00:00:00Z', courses: { '05424120': [
      { avgGrade: 75, year: 2025, semester: 1, group: 1, dueIn: 1, totalStudents: 30 },
      { avgGrade: 85, year: 2025, semester: 1, group: 2, dueIn: 1, totalStudents: 30 },
      // Another source's copy must not inflate student counts.
    ] },
  } }, { source: { ...source, id: 'copy' }, snapshot: {
    generated_at: '2026-09-28T00:00:00Z', courses: { '05424120': [{ avgGrade: 99, year: 2025, semester: 1, group: 1, dueIn: 1, totalStudents: 100 }] },
  } }], { recentTerms: 4, passingGrade: 60 })
  expect(summaries['0542-4120']).toEqual({ mean: 80, students: 60, terms: 1, years: [2025], sources: [{ label: 'TAU+', url: 'https://example.test/grades', snapshotAt: '2026-09-27T00:00:00Z' }] })
  expect(summaries['0542-9999']).toBeNull()
})
