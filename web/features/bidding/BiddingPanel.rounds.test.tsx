import { useState } from 'react'
import { fireEvent, render, screen, within, waitFor, act } from '@testing-library/react'
import { BiddingPanel } from './BiddingPanel'
import { createEmptyBiddingDraft, type BiddingDraft, type BiddingHistory } from '../../../shared/planner/bidding'
import type { BiddingRoundSnapshot, BiddingRoundTransition } from '../../../shared/planner/bidding-rounds'
jest.mock('../locale/LocaleProvider', () => ({ useLocale: () => ({ locale: 'en', dir: 'ltr', t: (_he: string, en: string) => en }) }))
const original: BiddingDraft = { ...createEmptyBiddingDraft(2027), budget: 100, rulesConfirmed: true, entries: [
  { id: 'pending', kind: 'course', courseId: 'C1', label: 'Pending course', group: '01', points: 30, priority: 1, outcome: 'pending', members: [] },
  { id: 'accepted', kind: 'course', courseId: 'C2', label: 'Accepted course', group: '02', points: 20, priority: 2, outcome: 'accepted', members: [] },
] }
const emptyHistory: BiddingHistory = { summaries: [], minimumContributors: 5, generatedAt: '' }
const saveRound = jest.fn(), transition = jest.fn()
function Harness({ initial = original, loadHistory = async () => emptyHistory }: { initial?: BiddingDraft; loadHistory?: (draft: BiddingDraft) => Promise<BiddingHistory> }) {
  const [draft, setDraft] = useState(initial), [snapshots, setSnapshots] = useState<BiddingRoundSnapshot[]>([])
  const advance = (result: BiddingRoundTransition) => { transition(result); setSnapshots((previous) => [...previous, result.snapshot]); setDraft(result.nextDraft) }
  return <BiddingPanel programId="p" courseOptions={[]} draft={draft} onChange={setDraft} loadHistory={loadHistory} onShare={async () => {}} roundSnapshots={snapshots} onRoundSnapshot={(snapshot) => { saveRound(snapshot); setSnapshots((previous) => [...previous, snapshot]) }} onRoundTransition={advance} />
}
beforeEach(() => jest.clearAllMocks())
test('preparing next round explicitly preserves pending outcomes, resets budget and retains an immutable reported acceptance summary', async () => {
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Prepare next round' }))
  const advance = screen.getByRole('button', { name: 'Archive and open round 2' })
  expect(advance).toBeDisabled()
  fireEvent.click(screen.getByLabelText('Keep pending choices as unconfirmed in the next round'))
  fireEvent.click(advance)
  expect(transition).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('Round')).toHaveValue(2)
  expect(screen.getByLabelText('Personal points budget')).toHaveValue(0)
  expect(screen.getByText('Reported acceptances from previous rounds')).toBeInTheDocument()
  expect(screen.queryByRole('group', { name: '2. Accepted course' })).not.toBeInTheDocument()
  const summary = screen.getByRole('region', { name: 'Reported acceptances from previous rounds' })
  expect(summary).toHaveTextContent('Accepted course')
  expect(within(summary).queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Copy manual-entry draft' })).toBeDisabled()
})
test('saving and loading history copies only the draft with an explicit action', () => {
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Save round snapshot' }))
  expect(saveRound).toHaveBeenCalledTimes(1)
  fireEvent.change(screen.getByLabelText('Personal points budget'), { target: { value: '200' } })
  fireEvent.click(screen.getByText('Round history (1)'))
  fireEvent.click(screen.getByRole('button', { name: 'Copy archived round 1 into draft' }))
  expect(screen.getByLabelText('Personal points budget')).toHaveValue(100)
  expect(saveRound.mock.calls[0][0].draft.budget).toBe(100)
})
test('advancing a round discards a late historical aggregate response from the previous round', async () => {
  let finish!: (history: BiddingHistory) => void
  render(<Harness loadHistory={() => new Promise((resolve) => { finish = resolve })} />)
  fireEvent.click(screen.getByRole('button', { name: 'Load historical summaries' }))
  fireEvent.click(screen.getByRole('button', { name: 'Prepare next round' }))
  fireEvent.click(screen.getByLabelText('Keep pending choices as unconfirmed in the next round'))
  fireEvent.click(screen.getByRole('button', { name: 'Archive and open round 2' }))
  await act(async () => { finish(emptyHistory) })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Load historical summaries' })).toBeEnabled())
  expect(screen.queryByText(/No sufficiently aggregated earlier results/)).not.toBeInTheDocument()
})
test('round twenty cannot open an unsupported next round', () => {
  render(<Harness initial={{ ...original, round: 20 }} />)
  expect(screen.getByRole('button', { name: 'Prepare next round' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Save round snapshot' })).toBeEnabled()
})
