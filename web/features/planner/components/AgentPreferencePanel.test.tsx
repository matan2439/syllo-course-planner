import { fireEvent, render, screen, within } from '@testing-library/react'
import AgentPreferencePanel from './AgentPreferencePanel'
import { EMPTY_ACADEMIC_STATUS } from '../../courses/components/CompletedCoursesPanel'
import { buildGeneratePlanRequest } from '../lib/build-plan-request'

const gateway = {
  id: 'shaar_ruach', title: 'שער רוח', minCourses: 3, selectedCount: 0, satisfied: false, missingCount: 3, selectedCourseIds: [],
}

test('picking a שער רוח assessment type reaches the plan request preferences', () => {
  const setGatewayAssessments = jest.fn()
  render(
    <AgentPreferencePanel
      programId="mechanical_engineering_2027" pickerCourses={[]} catalogHoursById={{}}
      academicStatus={EMPTY_ACADEMIC_STATUS} updateAcademicStatus={() => undefined}
      maxHours="" setMaxHours={() => undefined} priorHours="" setPriorHours={() => undefined}
      gatewayCategory={gateway as never}
      wantIds={[]} setWantIds={() => undefined} excludeIds={[]} setExcludeIds={() => undefined}
      gatewayAssessments={[]} setGatewayAssessments={setGatewayAssessments}
      exclusionsNoneConfirmed={false} setExclusionsNoneConfirmed={() => undefined}
      updatePreferenceVersion={() => undefined} onProfileChange={() => undefined}
      proposal={null} stale={false} alwaysOpen
    />,
  )
  fireEvent.click(screen.getByRole('checkbox', { name: 'עבודה או פרויקט' }))
  expect(setGatewayAssessments).toHaveBeenCalledWith(['paper'])

  const request = buildGeneratePlanRequest({ semesters: [] } as never, undefined, {
    maxHours: '', priorHours: '', wantIds: [], excludeIds: [], exclusionsNoneConfirmed: false,
    gatewayAssessments: ['paper'], programId: 'mechanical_engineering_2027', academicStatus: EMPTY_ACADEMIC_STATUS,
    catalogHoursById: {}, applyAcademicStatus: () => ({}),
  })
  expect(request.preferences).toEqual({ gateway_assessment_types: ['paper'] })
})

test('the profile asks for the current year in the degree (שנה א׳–ד׳) and reports it as a number', () => {
  const onCurrentDegreeYearChange = jest.fn()
  render(
    <AgentPreferencePanel
      programId="mechanical_engineering_2027" pickerCourses={[]} catalogHoursById={{}}
      academicStatus={EMPTY_ACADEMIC_STATUS} updateAcademicStatus={() => undefined}
      maxHours="" setMaxHours={() => undefined} priorHours="" setPriorHours={() => undefined}
      wantIds={[]} setWantIds={() => undefined} excludeIds={[]} setExcludeIds={() => undefined}
      exclusionsNoneConfirmed={false} setExclusionsNoneConfirmed={() => undefined}
      updatePreferenceVersion={() => undefined} onProfileChange={() => undefined}
      proposal={null} stale={false} alwaysOpen
      currentDegreeYear={null} onCurrentDegreeYearChange={onCurrentDegreeYearChange}
    />,
  )
  const group = screen.getByRole('radiogroup', { name: 'השנה שלי בתואר' })
  const options = within(group).getAllByRole('radio')
  expect(options.map((o) => o.textContent)).toEqual(['שנה א׳', 'שנה ב׳', 'שנה ג׳', 'שנה ד׳'])
  expect(options.every((o) => o.getAttribute('aria-checked') === 'false')).toBe(true)
  fireEvent.click(within(group).getByRole('radio', { name: 'שנה ג׳' }))
  expect(onCurrentDegreeYearChange).toHaveBeenCalledWith(3)
})
