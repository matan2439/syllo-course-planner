import { renderHook, waitFor, act } from '@testing-library/react'
import { useCommittedBoard } from './use-committed-board'
import { boardResponseToModel } from '../../../../shared/planner/adapters'

const catalog = boardResponseToModel({ metadata: { board_data_version: 'v1' }, semesters: [
  { semester_id: 'year_3_semester_a', courses: [] },
] })

test('failed account read never exposes catalog defaults as an editable saved board', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {})
  const getBoardFn = async () => catalog
  const committedBoardFn = async () => { throw new Error('temporarily unavailable') }
  const { result } = renderHook(() => useCommittedBoard({ programId: 'p', getBoardFn, committedBoardFn }))
  await waitFor(() => expect(result.current.boardPhase).toBe('error'))
  expect(result.current.current).toBeNull()
  log.mockRestore()
})

test('a failed resync leaves the visible board untouched', async () => {
  const getBoardFn = async () => catalog
  const committedBoardFn = jest.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('offline'))
  const log = jest.spyOn(console, 'error').mockImplementation(() => {})
  const { result } = renderHook(() => useCommittedBoard({ programId: 'p', getBoardFn, committedBoardFn }))
  await waitFor(() => expect(result.current.boardPhase).toBe('ready'))
  const before = result.current.current
  await act(() => result.current.resyncCommittedBoard())
  expect(result.current.current).toBe(before)
  log.mockRestore()
})
