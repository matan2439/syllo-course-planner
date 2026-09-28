import { fireEvent, render, screen } from '@testing-library/react'
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
