import { render, screen } from '@testing-library/react'
import DegreeRulesPanel, { currentCourseIdsFromStatus } from './DegreeRulesPanel'
import { adaptRequirements } from '../../../lib/requirements'
import mechanicalBoard from '../../../../data/boards/mechanical_engineering_2027.json'

test('shows Mechanical Engineering requirements without draft rule metadata', () => {
  const requirements = adaptRequirements(mechanicalBoard)
  render(<DegreeRulesPanel rules={[]} requirements={requirements} semesters={[]} />)
  expect(screen.getByText('כללי התואר')).toBeInTheDocument()
  expect(screen.getByText(`סה״כ נדרש לתואר: ${requirements!.totalRequiredHours} ש״ס`)).toBeInTheDocument()
})

test('current enrollment without a known semester requires review rather than passing timing', () => {
  const current = currentCourseIdsFromStatus({ currently_taking: [{ course_id: '0512-3000' }] })
  render(<DegreeRulesPanel rules={[{ rule_id: 'from-semester-three', kind: 'year_restriction',
    course_ids: ['0512-3000'], params: { from_semester: 3 } }]} semesters={[]} currentCourseIds={current} />)
  expect(screen.getByText(/נדרשת בדיקה/, { selector: 'strong' })).toBeInTheDocument()
  expect(screen.queryByText(/· תקין/)).toBeNull()
})

test('published prior-year homes and credit hours reach the same evaluator as the server', () => {
  render(<DegreeRulesPanel rules={[
    { rule_id: 'progression', kind: 'year_restriction', course_ids: [], params: { require_all_prior_year_courses: true } },
    { rule_id: 'load', kind: 'load_limit', course_ids: [], params: { min_load_fraction_without_approval: 0.75 } },
  ]} semesters={[{ semesterId: 'year_3_semester_a', courseIds: ['C'] }]}
    completedCourseIds={['P']} catalogFacts={{ mandatorySemesters: { P: 'year_2_semester_a' }, courseHours: { C: 15 } }}
    evidence={{ fullTimeLoadBySemester: { year_3_semester_a: { hours: 20, reference: 'Official recommended plan' } } }} />)
  expect(screen.getAllByText(/· תקין/, { selector: 'strong' })).toHaveLength(2)
})
