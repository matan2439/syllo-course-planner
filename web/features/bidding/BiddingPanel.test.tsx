import { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { BiddingPanel } from './BiddingPanel'
import { createEmptyBiddingDraft, type BiddingDraft, type BiddingHistory } from '../../../shared/planner/bidding'

jest.mock('../locale/LocaleProvider', () => ({ useLocale: () => ({ locale: 'en', dir: 'ltr', t: (_he: string, en: string) => en }) }))
const history: BiddingHistory = { summaries: [], minimumContributors: 5, generatedAt: '2026-10-29T00:00:00Z' }
const base = (): BiddingDraft => ({ ...createEmptyBiddingDraft(2027), budget: 100, rulesConfirmed: true, entries: [
  { id: 'a', kind: 'course', courseId: '1234', label: 'Fluid mechanics', group: '01', points: 20, priority: 1, outcome: 'pending', members: [] },
  { id: 'b', kind: 'course', courseId: '5678', label: 'Control', group: '02', points: 10, priority: 2, outcome: 'accepted', members: [] },
] })
const courseOptions = [{ id: '1234', name: 'Fluid mechanics' }, { id: '5678', name: 'Control' }]
const loadHistory = jest.fn(async () => history)
const onShare = jest.fn<Promise<void>, [BiddingDraft, boolean]>(async () => {})
const onChange = jest.fn()
function Harness({ initial = base() }: { initial?: BiddingDraft }) {
  const [draft, setDraft] = useState(initial)
  return <BiddingPanel programId="engineering" courseOptions={courseOptions} draft={draft} onChange={(next) => { onChange(next); setDraft(next) }} loadHistory={loadHistory} onShare={onShare} />
}
beforeEach(() => jest.clearAllMocks())

test('edits initial points and actual outcome, keeping final score separate', () => {
  render(<Harness />)
  const course = screen.getByRole('group', { name: '1. Fluid mechanics' })
  fireEvent.change(within(course).getByLabelText('Initial points'), { target: { value: '40' } })
  fireEvent.change(within(course).getByLabelText('Student-reported result'), { target: { value: 'rejected' } })
  fireEvent.change(within(course).getByLabelText('Reported final points (optional)'), { target: { value: '65' } })
  expect(onChange.mock.calls.at(-1)?.[0].entries[0]).toMatchObject({ points: 40, outcome: 'rejected', effectivePoints: 65 })
  expect(screen.getByText('Initial allocation: 50 / 100 · Remaining: 50')).toBeInTheDocument()
})

test('allocation is a reviewable proposal and explicit apply preserves recorded results', () => {
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Suggest allocation' }))
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.getByText(/Priority heuristic/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Apply allocation' }))
  expect(onChange.mock.calls.at(-1)?.[0].entries).toEqual([
    expect.objectContaining({ points: 90, outcome: 'pending' }),
    expect.objectContaining({ points: 10, outcome: 'accepted' }),
  ])
})

test('what-if rejects selected entries without changing the actual draft or final scores', () => {
  render(<Harness />)
  fireEvent.click(screen.getByLabelText('Assume rejection: Fluid mechanics'))
  fireEvent.click(screen.getByRole('button', { name: 'Run what-if transfers' }))
  expect(screen.getByTestId('bidding-simulation')).toHaveTextContent('Control: 30')
  expect(onChange).not.toHaveBeenCalled()
})

test('creates packets with course/group members, reorders and deletes entries', () => {
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Add packet' }))
  const packet = screen.getByRole('group', { name: '3. Packet 3' })
  fireEvent.change(within(packet).getByLabelText('Packet course'), { target: { value: '1234' } })
  fireEvent.change(within(packet).getByLabelText('Packet course group'), { target: { value: '07' } })
  fireEvent.click(within(packet).getByRole('button', { name: 'Add packet member' }))
  expect(onChange.mock.calls.at(-1)?.[0].entries[2].members).toEqual([{ courseId: '1234', group: '07' }])
  fireEvent.click(within(packet).getByRole('button', { name: 'Move up Packet 3' }))
  expect(onChange.mock.calls.at(-1)?.[0].entries[1].kind).toBe('bundle')
  fireEvent.click(screen.getByRole('button', { name: 'Delete Packet 3' }))
  expect(onChange.mock.calls.at(-1)?.[0].entries).toHaveLength(2)
})

test('sharing requires explicit consent, surfaces service errors, and withdraw is available independently', async () => {
  onShare.mockRejectedValueOnce(new Error('Sign in to share.'))
  render(<Harness />)
  const share = screen.getByRole('button', { name: 'Share completed results' })
  expect(share).toBeDisabled()
  fireEvent.click(screen.getByLabelText(/I consent to contribute/))
  fireEvent.click(share)
  await waitFor(() => expect(onShare).toHaveBeenCalledWith(expect.any(Object), true))
  expect(await screen.findByText('Sign in to share.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Withdraw shared results' }))
  await waitFor(() => expect(onShare).toHaveBeenLastCalledWith(expect.any(Object), false))
})

test('loads contextual history on demand and displays sparse evidence honestly', async () => {
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Load historical summaries' }))
  await waitFor(() => expect(loadHistory).toHaveBeenCalledWith(expect.objectContaining({ academicYear: 2027, semester: 1, round: 1 })))
  expect(await screen.findByText(/No sufficiently aggregated earlier results/)).toBeInTheDocument()
})

test('invalid allocation cannot be exported or shared', () => {
  render(<Harness initial={{ ...base(), budget: 1 }} />)
  expect(screen.getByRole('button', { name: 'Copy manual-entry draft' })).toBeDisabled()
  fireEvent.click(screen.getByLabelText(/I consent to contribute/))
  expect(screen.getByRole('button', { name: 'Share completed results' })).toBeDisabled()
})

test('a late history response cannot populate another program or registration round', async () => {
  let resolve!: (value: BiddingHistory) => void
  const delayed = jest.fn(() => new Promise<BiddingHistory>((done) => { resolve = done }))
  const props = { courseOptions, draft: base(), onChange, loadHistory: delayed, onShare }
  const view = render(<BiddingPanel {...props} programId="engineering" />)
  fireEvent.click(screen.getByRole('button', { name: 'Load historical summaries' }))
  view.rerender(<BiddingPanel {...props} programId="science" />)
  resolve(history)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Load historical summaries' })).toBeEnabled())
  expect(screen.queryByText(/No sufficiently aggregated earlier results/)).not.toBeInTheDocument()
})

test('manual export remains available as selectable text when the clipboard API is unavailable', async () => {
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Copy manual-entry draft' }))
  const text = await screen.findByLabelText('Manual-entry text')
  expect((text as HTMLTextAreaElement).value).toContain('Fluid mechanics')
  expect((text as HTMLTextAreaElement).value).toContain('Initial points: 20')
  expect(onChange).not.toHaveBeenCalled()
  expect(onShare).not.toHaveBeenCalled()
})

test('changing rules requires renewed confirmation and invalidates a previous proposal', () => {
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Suggest allocation' }))
  expect(screen.getByRole('button', { name: 'Apply allocation' })).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Personal points budget'), { target: { value: '200' } })
  expect(screen.queryByRole('button', { name: 'Apply allocation' })).not.toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: /I checked this round/ })).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Copy manual-entry draft' })).toBeDisabled()
})
