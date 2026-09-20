/** Regression coverage for topic follow-ups in the unified agent surface. */
import { render, screen, waitFor } from '@testing-library/react'
import NativePlannerJourney from './NativePlannerJourney'
import { boardResponseToModel } from '../../../shared/planner/adapters'

const BOARD = {
  metadata: { board_data_version: 'rev-1', program_repository_courses: [] },
  semesters: [
    { semester_id: 'year_3_semester_a', courses: [{ course_id: 'X-1', name_he: 'קורס בסיס X', weekly_hours: 3, course_type: 'mandatory', is_mandatory: true }] },
    { semester_id: 'year_3_semester_b', courses: [] },
  ],
}

test('topic preference is not rendered as a second journey questionnaire', async () => {
  render(
    <NativePlannerJourney
      programId="mechanical_engineering_2027"
      getBoardFn={async () => boardResponseToModel(BOARD)}
      planningContextFn={async () => null}
      useAcademicDecisionAgent
      sendConversationFn={jest.fn()}
    />,
  )

  await waitFor(() => expect(screen.getByText('קורס בסיס X')).toBeInTheDocument())
  const agent = screen.getByTestId('academic-agent-conversation')
  expect(agent).toBeInTheDocument()
  expect(screen.queryByText(/יש תחום תוכן שמעניין אותך במיוחד/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'רובוטיקה' })).not.toBeInTheDocument()
})
