import { savedCourseSearchSchema } from '../../shared/planner/catalog-searches'

const search = { id: 'search_example', name: '  Semester A projects  ', query: '  thermo ', filters: {
  categoryIds: ['energy'], semesters: ['a'], assessments: ['project'], minGrade: 75, maxGrade: 95,
  includeUnknownGrades: true, favoritesOnly: true, sort: 'grade-desc',
} }

test('preserves exact query and valid filter criteria while normalizing the display name', () => {
  const saved = savedCourseSearchSchema.parse(search)
  expect(saved).toEqual({ ...search, name: 'Semester A projects' })
  expect(savedCourseSearchSchema.parse(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
})

test('rejects favorite id payloads and unknown fields instead of persisting another account data', () => {
  expect(savedCourseSearchSchema.safeParse({ ...search, filters: { ...search.filters, favoriteIds: ['private-course'] } }).success).toBe(false)
  expect(savedCourseSearchSchema.safeParse({ ...search, owner: 'other-account' }).success).toBe(false)
})

test.each([
  { minGrade: 101 }, { maxGrade: -1 }, { minGrade: Number.NaN }, { maxGrade: Number.POSITIVE_INFINITY },
  { minGrade: 85, maxGrade: 80 }, { semesters: ['invalid'] }, { assessments: ['invalid'] },
  { sort: 'invalid' }, { semesters: ['a', 'a'] }, { categoryIds: ['energy', 'energy'] },
  { categoryIds: Array.from({ length: 101 }, (_, i) => `category_${i}`) }, { favoritesOnly: 'yes' },
])('rejects corrupt or unbounded saved filter criteria: %p', (filters) => {
  expect(savedCourseSearchSchema.safeParse({ ...search, filters }).success).toBe(false)
})

test('bounds ids, names and queries without coercing corrupt input', () => {
  for (const patch of [{ id: '../bad-id' }, { name: ' ' }, { name: 'x'.repeat(81) }, { query: 'x'.repeat(301) }, { query: null }]) {
    expect(savedCourseSearchSchema.safeParse({ ...search, ...patch }).success).toBe(false)
  }
  expect(savedCourseSearchSchema.safeParse({ id: 'search_empty', name: 'All courses', query: '', filters: {} }).success).toBe(true)
})
