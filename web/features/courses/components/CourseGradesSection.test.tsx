import { fireEvent, render, screen } from '@testing-library/react'
import CourseGradesSection from './CourseGradesSection'
import type { CourseGradeSummary, CourseInsightsResponse, TermStats } from '../../../../api/ai/course_insights/types'
import { aggregateBins, scopeView, termLabel } from '../lib/grade-view'

const bins = (fail: number) => [
  { from: 0, to: 59, percent: fail },
  { from: 60, to: 79, percent: 50 - fail },
  { from: 80, to: 100, percent: 50 },
]
const term = (over: Partial<TermStats>): TermStats => ({
  year: 2026, term: 'a', mean: 80, median: 82, std: 10, students: 100, pass_rate: 90,
  lecturers: ['ד"ר כהן'], bins: bins(10), source: 'tauplus', ...over,
})
const summary: CourseGradeSummary = {
  course_key: '05424010',
  has_data: true,
  passing_grade: 60,
  sources: [
    { id: 'tauplus', label_he: 'TAU+', attribution_url: 'https://grades.example/compare', status: 'ok', terms: 2, snapshot_at: '2026-09-27T10:00:00Z' },
    { id: 'arazim', label_he: 'ארזים', attribution_url: null, status: 'error', terms: 0 },
  ],
  overall: { mean: 78.3, median: 80, pass_rate: 86.7, students: 300, terms: 2 },
  recent: { mean: 80, median: 82, pass_rate: 90, students: 100, terms: 1 },
  trend: { direction: 'up', recent_mean: 80, older_mean: 77.5, delta: 2.5 },
  lecturers: [{ name: 'ד"ר כהן', mean: 80, students: 100, terms: 1 }],
  terms: [term({}), term({ year: 2025, term: 'b', mean: 77.5, students: 200, pass_rate: 85, bins: bins(15), lecturers: ['פרופ\' לוי'] })],
}
const ready = (grades: CourseGradeSummary) => ({
  status: 'ready' as const,
  data: { course_id: 'C', name_he: 'קורס', grades, syllabus: null, suggestions_he: [] } satisfies CourseInsightsResponse,
})

test('all semesters: headline numbers, trend, lecturers and the sources that answered', () => {
  render(<CourseGradesSection insights={ready(summary)} />)
  expect(screen.getByText('78.3')).toBeInTheDocument()
  expect(screen.getByText('86.7%')).toBeInTheDocument()
  expect(screen.getByText(/2.5 נק׳/)).toBeInTheDocument()
  expect(screen.getByRole('img', { name: /התפלגות ציונים/ })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'TAU+' })).toHaveAttribute('href', 'https://grades.example/compare')
  expect(screen.getByText(/ארזים לא זמין כרגע/)).toBeInTheDocument()
  expect(screen.getByText(/נכון ל-27.9.2026/)).toBeInTheDocument()
})

test('choosing a semester shows that semester and its lecturers', () => {
  render(<CourseGradesSection insights={ready(summary)} />)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '2025b' } })
  expect(screen.getByText('77.5')).toBeInTheDocument()
  expect(screen.getByText("מרצים: פרופ' לוי")).toBeInTheDocument()
  expect(screen.queryByText(/נק׳/)).not.toBeInTheDocument()
})

test('loading, error and no-data states', () => {
  const { rerender } = render(<CourseGradesSection insights={{ status: 'loading', data: null }} />)
  expect(screen.getByText('טוען נתוני ציונים…')).toBeInTheDocument()
  rerender(<CourseGradesSection insights={{ status: 'error', data: null }} />)
  expect(screen.getByText('לא ניתן לטעון נתוני ציונים כרגע.')).toBeInTheDocument()
  rerender(<CourseGradesSection insights={ready({ ...summary, has_data: false, overall: null, terms: [] })} />)
  expect(screen.getByText('אין נתוני ציונים לקורס הזה במקורות הזמינים.')).toBeInTheDocument()
})

test('grade-view helpers', () => {
  expect(termLabel({ year: 2026, term: 'a' })).toBe('2026 סמ׳ א׳')
  // 100 students at 10% fail + 200 at 15% fail → student-weighted 13.33%.
  expect(aggregateBins(summary.terms)[0].percent).toBeCloseTo(13.333, 2)
  expect(aggregateBins([term({}), term({ bins: [{ from: 0, to: 100, percent: 100 }] })])[0].percent).toBe(10)
  expect(scopeView(summary, '2026a')).toEqual(expect.objectContaining({ mean: 80, terms: 1 }))
  expect(scopeView(summary, 'nope')).toBeNull()
})
