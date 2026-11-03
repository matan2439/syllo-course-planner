import { act, renderHook, waitFor } from '@testing-library/react'
import { useAcademicContext } from './use-academic-context'
import { buildGeneratePlanRequest } from '../lib/build-plan-request'
import { boardResponseToModel } from '../../../../shared/planner/adapters'

const PROGRAM = 'mechanical_engineering_2027'
const taking = [{ course_id: '0542-4422', semester_id: 'year_3_semester_a', hours: 4 }]
const planned = [{ course_id: '0542-4455', semester_id: 'year_3_semester_b', hours: 4 }]

test('editing completed courses preserves saved enrollments for context sync and Apply', async () => {
  const planningContextFn = async () => ({
    academicStatusDigest: 'as_saved', preferenceDigest: 'pref_saved', preferences: {},
    personalStatus: { completed: [{ course_id: '0542-1510' }], currently_taking: taking, planned, completed_knowledge: { status: 'known' } },
  })
  const sendConversationFn = jest.fn()
  const { result } = renderHook(() => useAcademicContext({ programId: PROGRAM, planningContextFn, sendConversationFn }))
  await waitFor(() => expect(result.current.academicContextPhase).toBe('ready'))
  act(() => result.current.updateAcademicStatus({ statuses: { '0509-1821': 'completed' }, electiveIds: [], confirmed: true }))
  expect(result.current.applyAcademicStatus()).toEqual(expect.objectContaining({
    completed: [{ course_id: '0509-1821' }], currently_taking: taking, planned,
  }))
})

test('a request built for manual context sync does not replace saved planned courses with an empty list', () => {
  const academic = { completed: [], currently_taking: taking, planned }
  const request = buildGeneratePlanRequest(boardResponseToModel({
    metadata: { board_data_version: 'rev-1' }, semesters: [{ semester_id: 'year_3_semester_a', courses: [] }],
  }), undefined, {
    programId: PROGRAM, maxHours: '', priorHours: '', wantIds: [], excludeIds: [], exclusionsNoneConfirmed: false,
    academicStatus: { statuses: {}, electiveIds: [], confirmed: false }, catalogHoursById: {}, applyAcademicStatus: () => academic,
  })
  expect((request.plan_context as Record<string, unknown>).personal_status).toEqual(academic)
})
