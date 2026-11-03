import {
  biddingDraftSchema, createEmptyBiddingDraft, validateBiddingDraft, simulateBiddingTransfers,
  proposeBiddingAllocation, applyBiddingAllocation, exportBiddingDraft, getBiddingContextHistory, biddingBundleSignature,
  type BiddingDraft, type BiddingEntry, type BiddingHistory,
} from '../../../shared/planner/bidding'

const entry = (id: string, points: number, extra: Partial<BiddingEntry> = {}): BiddingEntry => ({
  id, label: id, kind: 'course', courseId: id, group: '01', points,
  priority: Number(id.replace(/\D/g, '')) || 1, outcome: 'pending', members: [], ...extra,
})
const draft = (entries: BiddingEntry[], extra: Partial<BiddingDraft> = {}): BiddingDraft => ({
  ...createEmptyBiddingDraft(2027), budget: 100, rulesConfirmed: true, entries, ...extra,
})
const emptyHistory: BiddingHistory = { summaries: [], generatedAt: '2026-10-29T00:00:00Z', minimumContributors: 5 }

test('draft schema rejects negative, fractional and unsafe point budgets', () => {
  for (const budget of [-1, 2.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(biddingDraftSchema.safeParse(draft([], { budget })).success).toBe(false)
  }
  expect(biddingDraftSchema.parse(draft([], { budget: 0 })).budget).toBe(0)
})

test('minimum bid permits a zero alternative and counts only initial points once', () => {
  const d = draft([entry('e1', 95, { transferTo: 'e2' }), entry('e2', 0)], { transferMode: 'manual' })
  expect(validateBiddingDraft(d)).toMatchObject({ valid: true, allocated: 95, remaining: 5 })
  expect(validateBiddingDraft(draft([entry('e1', 4)] )).issues.map((i) => i.code)).toContain('below_minimum')
  expect(validateBiddingDraft(draft([entry('e1', 101)])).issues.map((i) => i.code)).toContain('over_budget')
})

test('validation finds missing/self transfer targets, cycles and duplicated course groups', () => {
  for (const entries of [
    [entry('e1', 5, { transferTo: 'missing' })],
    [entry('e1', 5, { transferTo: 'e1' })],
    [entry('e1', 5, { transferTo: 'e2' }), entry('e2', 5, { transferTo: 'e1' })],
  ]) expect(validateBiddingDraft(draft(entries, { transferMode: 'manual' })).valid).toBe(false)
  expect(validateBiddingDraft(draft([entry('e1', 5), entry('e2', 5, { courseId: 'e1' })])).issues.map((i) => i.code)).toContain('duplicate_target')
})

test('rejected bids cascade without creating or double counting points and preserve actual results', () => {
  const d = draft([entry('e1', 50), entry('e2', 30), entry('e3', 20, { outcome: 'accepted' })])
  const before = JSON.stringify(d)
  const result = simulateBiddingTransfers(d, { e1: 'rejected', e2: 'rejected' })
  expect(result.valid).toBe(true)
  expect(result.entries.map((e) => e.effectivePoints)).toEqual([0, 0, 100])
  expect(result.transfers.map((e) => e.points)).toEqual([50, 80])
  expect(result.totalInitial).toBe(100)
  expect(result.unallocated).toBe(0)
  expect(result.entries.reduce((sum, e) => sum + e.effectivePoints, result.unallocated)).toBe(100)
  expect(JSON.stringify(d)).toBe(before)
})

test('designated transfers follow graph order even when priority is reversed; canceled points stay unallocated', () => {
  const d = draft([
    entry('e1', 30, { outcome: 'pending' }),
    entry('e2', 40, { outcome: 'rejected', transferTo: 'e1' }),
    entry('e3', 20, { outcome: 'rejected', transferTo: 'e2' }),
    entry('e4', 10, { outcome: 'canceled', transferTo: 'e1' }),
  ], { transferMode: 'manual' })
  const result = simulateBiddingTransfers(d)
  expect(result.entries.map((e) => e.effectivePoints)).toEqual([90, 0, 0, 0])
  expect(result.unallocated).toBe(10)
})

test('priority proposals are deterministic and within budget; applying only changes pending allocations', () => {
  const d = draft([entry('e1', 5), entry('e2', 5), entry('e3', 25, { outcome: 'accepted' }), entry('e4', 0)])
  const proposal = proposeBiddingAllocation(d, emptyHistory)
  expect(proposal).toEqual(proposeBiddingAllocation(d, emptyHistory))
  expect(proposal.method).toBe('priority')
  expect(proposal.feasible).toBe(true)
  const applied = applyBiddingAllocation(d, proposal)
  expect(applied.entries.reduce((sum, e) => sum + e.points, 0)).toBeLessThanOrEqual(100)
  expect(applied.entries[0].points).toBeGreaterThan(applied.entries[1].points)
  expect(applied.entries[2]).toEqual(d.entries[2])
  expect(applied.entries[3].points).toBe(0)
  expect(applied.entries.map((e) => e.outcome)).toEqual(d.entries.map((e) => e.outcome))
  expect(d.entries[0].points).toBe(5)
})

test('insufficient, mismatched, current and future history never supplies predictive evidence', () => {
  const sample: BiddingHistory['summaries'][number] = {
    kind: 'course', courseId: 'e1', group: '01', academicYear: 2026, semester: 1, round: 1,
    contributors: 7, acceptedCount: 5, rejectedCount: 2, acceptedBidMedian: 20, acceptedBidP75: 30, source: 'Consented community reports',
  }
  const d = draft([entry('e1', 5), entry('e2', 5)])
  for (const patch of [{ contributors: 4 }, { acceptedCount: 1 }, { academicYear: 2027 }, { academicYear: 2028 }, { semester: 2 as const }, { group: '02' }, { round: 2 }, { acceptedCount: 0, acceptedBidMedian: null, acceptedBidP75: null }]) {
    const proposal = proposeBiddingAllocation(d, { ...emptyHistory, summaries: [{ ...sample, ...patch }] })
    expect(proposal.method).toBe('priority')
    expect(proposal.evidence).toEqual([])
  }
  expect(proposeBiddingAllocation(d, { ...emptyHistory, summaries: [sample] }).method).toBe('history_and_priority')
})

test('packet score evidence requires matching member composition rather than a reused packet label', () => {
  const d = draft([entry('p1', 5, { kind: 'bundle', courseId: undefined, group: 'Packet 1', members: [{ courseId: '1234', group: '01' }] })])
  const summary = { kind: 'bundle' as const, group: 'Packet 1', academicYear: 2026, semester: 1 as const, round: 1,
    contributors: 7, acceptedCount: 5, rejectedCount: 2, acceptedBidMedian: 20, acceptedBidP75: 30,
    source: 'Consented reports', bundleSignature: JSON.stringify([['9999', '01']]) }
  expect(proposeBiddingAllocation(d, { ...emptyHistory, summaries: [summary] }).evidence).toEqual([])
  expect(proposeBiddingAllocation(d, { ...emptyHistory, summaries: [{ ...summary, bundleSignature: JSON.stringify([['1234', '01']]) }] }).method).toBe('history_and_priority')
})

test('context summaries retain counts but suppress accepted scores for a small accepted subgroup', () => {
  const d = draft([entry('e1', 5)])
  const history = { ...emptyHistory, summaries: [{ kind: 'course' as const, courseId: 'e1', group: '01', academicYear: 2026,
    semester: 1 as const, round: 1, contributors: 5, acceptedCount: 1, rejectedCount: 4,
    acceptedBidMedian: 87, acceptedBidP75: 87, source: 'Consented reports' }] }
  expect(getBiddingContextHistory(d, history)[0].summary).toMatchObject({ acceptedCount: 1, rejectedCount: 4, acceptedBidMedian: null, acceptedBidP75: null })
  expect(biddingBundleSignature([{ courseId: 'b', group: ' 02 ' }, { courseId: 'a', group: '01' }])).toBe('[["a","01"],["b","02"]]')
})

test('history for a settled result does not pretend to guide unrelated pending allocations', () => {
  const d = draft([entry('e1', 20, { outcome: 'accepted' }), entry('e2', 5)])
  const history = { ...emptyHistory, summaries: [{ kind: 'course' as const, courseId: 'e1', group: '01', academicYear: 2026,
    semester: 1 as const, round: 1, contributors: 5, acceptedCount: 5, rejectedCount: 0,
    acceptedBidMedian: 87, acceptedBidP75: 90, source: 'Consented reports' }] }
  expect(proposeBiddingAllocation(d, history).method).toBe('priority')
})

test('export rejects unreviewed invalid drafts rather than presenting them as ready for entry', () => {
  expect(() => exportBiddingDraft(draft([entry('e1', 150)]), 'en')).toThrow()
})

test('a proposal cannot claim to fix invalid points on a settled result', () => {
  const d = draft([entry('e1', 4, { outcome: 'accepted' }), entry('e2', 5)])
  expect(proposeBiddingAllocation(d, emptyHistory).feasible).toBe(false)
})

test('export identifies actual transfer targets, including no next priority, and readable result reasons', () => {
  const d = draft([entry('e1', 20, { outcome: 'rejected', rejectionReason: 'closed_group' }), entry('e2', 10)])
  const lines = exportBiddingDraft(d, 'en').split('\n')
  expect(lines.find((line) => line.startsWith('1.'))).toContain('Transfer target: e2')
  expect(lines.find((line) => line.startsWith('1.'))).toContain('Reason: Closed group')
  expect(lines.find((line) => line.startsWith('2.'))).toContain('Transfer target: —')
})

test('insufficient budget leaves proposal infeasible and stale proposals cannot overwrite later edits', () => {
  expect(proposeBiddingAllocation(draft([entry('e1', 5), entry('e2', 5)], { budget: 5 }), emptyHistory).feasible).toBe(false)
  const d = draft([entry('e1', 5)])
  const proposal = proposeBiddingAllocation(d, emptyHistory)
  expect(() => applyBiddingAllocation({ ...d, budget: 200 }, proposal)).toThrow(/changed/)
})

test('bundle export includes members, initial points and student-reported outcome without claiming submission', () => {
  const d = draft([entry('p1', 30, { kind: 'bundle', courseId: undefined, label: 'Packet A', group: 'P1', members: [{ courseId: '1234', group: '02' }], outcome: 'other_group' })])
  expect(exportBiddingDraft(d, 'en')).toContain('1234 / 02')
  expect(exportBiddingDraft(d, 'en')).toContain('Student-reported')
  expect(exportBiddingDraft(d, 'en')).toContain('30')
  expect(exportBiddingDraft(d, 'en')).toContain('Manual entry')
})
