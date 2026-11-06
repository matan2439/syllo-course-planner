import { render, screen } from '@testing-library/react'
import DegreeRulesPanel, { currentCourseIdsFromStatus } from './DegreeRulesPanel'

test('current enrollment without a known semester requires review rather than passing timing', () => {
  const current = currentCourseIdsFromStatus({ currently_taking: [{ course_id: '0512-3000' }] })
  render(<DegreeRulesPanel rules={[{ rule_id: 'from-semester-three', kind: 'year_restriction',
    course_ids: ['0512-3000'], params: { from_semester: 3 } }]} semesters={[]} currentCourseIds={current} />)
  expect(screen.getByText(/נדרשת בדיקה/, { selector: 'strong' })).toBeInTheDocument()
  expect(screen.queryByText(/· תקין/)).toBeNull()
})
