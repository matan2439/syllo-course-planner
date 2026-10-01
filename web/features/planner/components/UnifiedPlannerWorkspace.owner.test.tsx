/**
 * The board, planning context and co-pilot digests belong to one owner. When the signed-in
 * user changes on an open page (or the server has no context for the current owner), they
 * must all be re-read, or the co-pilot sends the previous owner's digests and gets a 409.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as plannerApi from '../../../../shared/planner/api-client'
import { boardResponseToModel } from '../../../../shared/planner/adapters'
import type { AuthState } from '../../auth/AuthProvider'
import UnifiedPlannerWorkspace from './UnifiedPlannerWorkspace'

let mockAuth: Partial<AuthState>
jest.mock('../../auth/AuthProvider', () => ({
  ...jest.requireActual('../../auth/AuthProvider'),
  useAuth: () => mockAuth,
}))

const authAs = (id: string | null, loading = false): Partial<AuthState> => ({
  enabled: true, loading, user: id ? { id, email: null } : null,
  profile: { billing_exempt: true } as AuthState['profile'], creditBalance: null, hasPurchased: null,
  updateProfile: async () => {}, refreshCreditBalance: () => {},
})

beforeEach(() => {
  mockAuth = authAs('user-a')
  jest.spyOn(plannerApi, 'getBoard').mockResolvedValue(boardResponseToModel({
    metadata: { board_data_version: 'rev-owner' },
    semesters: [{ semester_id: 'year_3_semester_a', courses: [{
      course_id: '0542-2400', name_he: 'תכן מכני (1)', weekly_hours: 4,
      course_type: 'mandatory', is_mandatory: true,
    }] }],
  }))
  jest.spyOn(plannerApi, 'getCommittedBoard').mockResolvedValue(null)
  jest.spyOn(plannerApi, 'getPlanningContext').mockResolvedValue({
    academicStatusDigest: 'as_owner', preferenceDigest: 'pref_owner', personalStatus: {}, preferences: {},
  } as never)
})

afterEach(() => jest.restoreAllMocks())

const repo = { categories: [], totalCourses: 0 }
const workspace = () => <UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repo} />
const reads = () => ({
  board: (plannerApi.getBoard as jest.Mock).mock.calls.length,
  committed: (plannerApi.getCommittedBoard as jest.Mock).mock.calls.length,
  context: (plannerApi.getPlanningContext as jest.Mock).mock.calls.length,
})

test('a user change on an open page re-reads the board, committed board and planning context', async () => {
  const { rerender } = render(workspace())
  await waitFor(() => expect(reads()).toEqual({ board: 1, committed: 1, context: 1 }))

  mockAuth = authAs('user-b')
  rerender(workspace())
  await waitFor(() => expect(reads()).toEqual({ board: 2, committed: 2, context: 2 }))

  mockAuth = authAs(null) // sign-out is an owner change too
  rerender(workspace())
  await waitFor(() => expect(reads()).toEqual({ board: 3, committed: 3, context: 3 }))
})

test('restoring the session on first load does not re-read (the cookie was already sent)', async () => {
  mockAuth = authAs(null, true)
  const { rerender } = render(workspace())
  await waitFor(() => expect(reads().context).toBe(1))
  mockAuth = authAs('user-a')
  rerender(workspace())
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
  expect(reads()).toEqual({ board: 1, committed: 1, context: 1 })
})

test('a 409 ACADEMIC_CONTEXT_MISSING from the co-pilot reloads the planning context by itself', async () => {
  jest.spyOn(plannerApi, 'sendConversation').mockRejectedValue(new plannerApi.ConversationContextConflictError({
    ok: false, code: 'ACADEMIC_CONTEXT_MISSING', message_he: 'הסטטוס האקדמי השתנה או אינו זמין.',
  }))
  render(workspace())
  await waitFor(() => expect(reads().context).toBe(1))
  fireEvent.click(screen.getByRole('button', { name: 'פתח כלי תכנון' }))
  fireEvent.click(screen.getByRole('tab', { name: 'עוזר AI' }))
  fireEvent.change(await screen.findByRole('textbox', { name: 'הודעה לעוזר האקדמי' }), { target: { value: 'שלום' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'שלח לעוזר' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))
  await waitFor(() => expect(reads()).toEqual({ board: 2, committed: 2, context: 2 }))
})
