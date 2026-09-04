/**
 * Regression coverage for the unified agent surface.
 *
 * Priority is no longer a second questionnaire mounted beside the agent. The
 * agent asks any needed follow-up in its own transcript, and only its explicit
 * build action can create a proposal. The detailed follow-up mechanics live in
 * AcademicAgentConversation.test.tsx; this journey test protects the product
 * boundary that the old controls never come back.
 */
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

test('the flagged journey keeps priority clarification inside the agent and hides the old standalone questionnaire', async () => {
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
  expect(screen.getByTestId('academic-agent-conversation')).toBeInTheDocument()
  expect(screen.queryByText(/מה חשוב לך יותר כרגע/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'שבוע קל יותר' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'עומס מאוזן' })).not.toBeInTheDocument()
})
