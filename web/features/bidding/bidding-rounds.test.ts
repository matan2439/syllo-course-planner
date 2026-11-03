import { archiveBiddingRound, prepareNextBiddingRound } from '../../../shared/planner/bidding-rounds'
import { createEmptyBiddingDraft, type BiddingDraft, type BiddingEntry } from '../../../shared/planner/bidding'
const entry = (id: string, outcome: BiddingEntry['outcome'], priority: number): BiddingEntry => ({ id, outcome, priority, label: id, kind: 'bundle', group: id, points: 20, effectivePoints: 35, rejectionReason: 'points', transferTo: 'pending', members: [{ courseId: id, group: '01' }] })
const draft = (): BiddingDraft => ({ ...createEmptyBiddingDraft(2027), budget: 150, minimumBid: 7, rulesConfirmed: true, rulesSource: 'faculty 2027', transferMode: 'manual', entries: [entry('accepted', 'accepted', 1), entry('rejected', 'rejected', 2), entry('other', 'other_group', 3), entry('canceled', 'canceled', 4), entry('pending', 'pending', 5)] })
const metadata = { id: 'round_12345678', savedAt: 123 }

test('archived rounds deep freeze a complete independent copy without freezing the current draft', () => {
  const source = draft(), snapshot = archiveBiddingRound(source, metadata)
  expect(snapshot).toEqual({ ...metadata, draft: source })
  source.entries[0].members[0].group = '02'
  expect(snapshot.draft.entries[0].members[0].group).toBe('01')
  expect(Object.isFrozen(snapshot.draft.entries[0].members[0])).toBe(true)
  expect(Object.isFrozen(snapshot)).toBe(true)
  expect(Object.isFrozen(source)).toBe(false)
})

test('next round archives results and carries only rejected and pending choices without scores or transfer links', () => {
  const source = draft(), before = JSON.stringify(source)
  const result = prepareNextBiddingRound(source, metadata)
  expect(JSON.stringify(source)).toBe(before)
  expect(result.snapshot.draft.entries.map((item) => item.outcome)).toEqual(['accepted', 'rejected', 'other_group', 'canceled', 'pending'])
  expect(result.nextDraft).toMatchObject({ round: 2, academicYear: 2027, semester: 1, budget: 0, minimumBid: 7, transferMode: 'manual', rulesConfirmed: false, rulesSource: '' })
  expect(result.nextDraft.entries.map((item) => [item.id, item.priority, item.points, item.outcome])).toEqual([['rejected', 1, 0, 'pending'], ['pending', 2, 0, 'pending']])
  expect(result.nextDraft.entries[0]).not.toHaveProperty('effectivePoints')
  expect(result.nextDraft.entries[0]).not.toHaveProperty('rejectionReason')
  expect(result.nextDraft.entries[0].transferTo).toBeNull()
  result.nextDraft.entries[0].members[0].group = '03'
  expect(result.snapshot.draft.entries[1].members[0].group).toBe('01')
  expect(source.entries[1].members[0].group).toBe('01')
})

test('round twenty can be archived but cannot advance beyond the supported cap', () => {
  const final = { ...draft(), round: 20 }
  expect(archiveBiddingRound(final, metadata).draft.round).toBe(20)
  expect(() => prepareNextBiddingRound(final, metadata)).toThrow('ROUND_LIMIT_REACHED')
})
