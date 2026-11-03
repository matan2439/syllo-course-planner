import type { RepositoryVM, RepoCategoryVM } from './repository'
import { filterRepository } from '../features/courses/components/RepositoryExplorer'

// The existing two-argument API remains usable while the third argument adds discovery.
const filter = filterRepository as (repo: RepositoryVM, query: string, options?: Record<string, unknown>) => RepoCategoryVM[]
const repo = {
  totalCourses: 5,
  categories: [
    { id: 'fluids', title: 'זורמים', courses: [
      { id: 'F1', name: 'זרימה מתקדמת', weeklyHours: 4, offered: ['A'], difficulty: null, syllabusUrl: null,
        assessment: { kind: 'exam', text: 'בחינה סופית', sourceUrl: null }, gradeSummary: { mean: 82, students: 140, terms: 3, sources: [] } },
      { id: 'F2', name: 'מעבדת זרימה', weeklyHours: 2, offered: ['B'], difficulty: null, syllabusUrl: null,
        assessment: { kind: 'lab', text: 'דוח מעבדה', sourceUrl: null }, gradeSummary: { mean: 91, students: 40, terms: 1, sources: [] } },
      { id: 'F3', name: 'זרימה ללא נתונים', weeklyHours: null, offered: [], difficulty: null, syllabusUrl: null },
    ] },
    { id: 'solids', title: 'מוצקים', courses: [
      { id: 'S1', name: 'מכניקת מוצקים', weeklyHours: 3, offered: ['year_3_semester_a'], difficulty: null, syllabusUrl: null,
        assessment: { kind: 'exam', text: 'Final Exam', sourceUrl: null }, gradeSummary: { mean: 76, students: 80, terms: 2, sources: [] } },
      { id: 'S2', name: 'פרויקט תכן', weeklyHours: 3, offered: ['A'], difficulty: null, syllabusUrl: null,
        assessment: { kind: 'project', text: 'פרויקט', sourceUrl: null } },
    ] },
  ],
} as RepositoryVM
const ids = (categories: RepoCategoryVM[]) => categories.flatMap((category) => category.courses.map((course) => course.id))

test('combines category alternatives with semester, assessment and inclusive grade bounds', () => {
  expect(ids(filter(repo, '', { categoryIds: ['fluids', 'solids'], semesters: ['a'], assessments: ['exam'], minGrade: 76, maxGrade: 82 })))
    .toEqual(['F1', 'S1'])
  expect(ids(filter(repo, '', { categoryIds: ['fluids'], semesters: ['a'], assessments: ['exam'], minGrade: 83 })))
    .toEqual([])
})

test('missing grade, offering and assessment remain unknown instead of becoming zero or exam-free', () => {
  expect(ids(filter(repo, '', { minGrade: 0, maxGrade: 100 }))).toEqual(['F1', 'F2', 'S1'])
  expect(ids(filter(repo, '', { minGrade: 80, includeUnknownGrades: true }))).toEqual(['F1', 'F2', 'F3', 'S2'])
  expect(ids(filter(repo, '', { assessments: ['unknown'] }))).toEqual(['F3'])
  expect(ids(filter(repo, '', { semesters: ['unknown'] }))).toEqual(['F3'])
  expect(ids(filter(repo, '', { assessments: ['project', 'lab'] }))).toEqual(['F2', 'S2'])
})

test('favorites intersect other filters and grade sorting puts missing values last', () => {
  expect(ids(filter(repo, '', { favoriteIds: ['F2', 'S1'], favoritesOnly: true, semesters: ['a'] }))).toEqual(['S1'])
  const sorted = filter(repo, '', { sort: 'grade-desc' })
  expect(sorted[0].courses.map((course) => course.id)).toEqual(['F2', 'F1', 'F3'])
})

test('keeps fuzzy name, id, category search and original order when no filters are active', () => {
  expect(filter(repo, '')).toBe(repo.categories)
  expect(ids(filter(repo, 'מוצקים', { semesters: ['a'] }))).toEqual(['S1', 'S2'])
  expect(ids(filter(repo, 'F2'))).toEqual(['F2'])
  expect(ids(filter(repo, 'מעבדת זרימה'))).toEqual(['F2'])
})
