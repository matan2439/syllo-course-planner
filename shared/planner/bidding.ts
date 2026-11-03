import { z } from 'zod'

const pointsSchema = z.number().int().min(0).max(1_000_000_000)
export const biddingOutcomeSchema = z.enum(['pending', 'accepted', 'rejected', 'other_group', 'canceled'])
export type BiddingOutcome = z.infer<typeof biddingOutcomeSchema>

export const biddingEntrySchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().max(200),
  kind: z.enum(['course', 'bundle']),
  courseId: z.string().max(100).optional(),
  group: z.string().max(100),
  points: pointsSchema,
  priority: z.number().int().min(1).max(1000),
  transferTo: z.string().max(100).nullable().optional(),
  outcome: biddingOutcomeSchema,
  rejectionReason: z.string().max(500).optional(),
  /** Actual final score reported by the student; simulations never populate this. */
  effectivePoints: pointsSchema.optional(),
  members: z.array(z.object({ courseId: z.string().min(1).max(100), group: z.string().max(100) })).max(50).default([]),
})
export type BiddingEntry = z.infer<typeof biddingEntrySchema>

export const biddingDraftSchema = z.object({
  academicYear: z.number().int().min(2000).max(2200),
  semester: z.union([z.literal(1), z.literal(2)]),
  round: z.number().int().min(1).max(20),
  budget: pointsSchema,
  minimumBid: pointsSchema,
  transferMode: z.enum(['automatic', 'manual']),
  rulesConfirmed: z.boolean().default(false),
  rulesSource: z.string().max(1000).default(''),
  entries: z.array(biddingEntrySchema).max(200),
})
export type BiddingDraft = z.infer<typeof biddingDraftSchema>

/** Aggregate only: never add contributor identifiers or individual observations here. */
export interface BiddingHistorySummary {
  kind: 'course' | 'bundle'
  courseId?: string
  /** Sorted course/group tuples; required before packet scores can inform recommendations. */
  bundleSignature?: string
  group: string
  academicYear: number
  semester: 1 | 2
  round: number
  contributors: number
  acceptedCount: number
  rejectedCount: number
  acceptedBidMedian: number | null
  acceptedBidP75: number | null
  source: string
}
export interface BiddingHistory {
  summaries: BiddingHistorySummary[]
  generatedAt: string
  minimumContributors: number
}

export function createEmptyBiddingDraft(academicYear = new Date().getFullYear()): BiddingDraft {
  return { academicYear, semester: 1, round: 1, budget: 0, minimumBid: 5,
    transferMode: 'automatic', rulesConfirmed: false, rulesSource: '', entries: [] }
}

export interface BiddingIssue {
  code: string
  entryId?: string
  messageHe: string
  messageEn: string
}
export interface BiddingValidation { valid: boolean; allocated: number; remaining: number; issues: BiddingIssue[] }

function ordered(entries: BiddingEntry[]) {
  return [...entries].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
}

/** Initial allocations consume the budget exactly once; potential transfers consume none. */
export function validateBiddingDraft(draft: BiddingDraft): BiddingValidation {
  const parsed = biddingDraftSchema.safeParse(draft)
  if (!parsed.success) return { valid: false, allocated: 0, remaining: 0, issues: [{
    code: 'invalid_value', messageHe: 'יש להזין שנה, מקצה וניקוד שלמים ותקינים.',
    messageEn: 'Enter valid whole numbers for the year, round and points.',
  }] }
  const d = parsed.data
  const issues: BiddingIssue[] = []
  const add = (code: string, he: string, en: string, entryId?: string) => issues.push({ code, messageHe: he, messageEn: en, entryId })
  const allocated = d.entries.reduce((sum, e) => sum + e.points, 0)
  if (allocated > d.budget) add('over_budget', 'סכום ההקצאה חורג מתקציב הנקודות.', 'Initial allocations exceed the points budget.')
  if (!d.rulesConfirmed) add('rules_unconfirmed', 'יש לאשר את התקציב וכללי המקצה מול המקור הרשמי.', 'Confirm the budget and round rules against the official source.')
  const ids = new Set<string>()
  const targets = new Set<string>()
  const priorities = new Set<number>()
  for (const e of d.entries) {
    if (ids.has(e.id)) add('duplicate_id', 'מזהי הבחירות חייבים להיות ייחודיים.', 'Entry identifiers must be unique.', e.id)
    ids.add(e.id)
    if (priorities.has(e.priority)) add('duplicate_priority', 'לכל בחירה נדרש דירוג עדיפות נפרד.', 'Each entry needs a distinct priority.', e.id)
    priorities.add(e.priority)
    if (!e.label.trim()) add('missing_label', 'יש לתת שם לבחירה.', 'Give the entry a name.', e.id)
    if (!e.group.trim()) add('missing_group', 'יש להזין קבוצה או מזהה מנה.', 'Enter a group or packet identifier.', e.id)
    if (e.kind === 'course' && !e.courseId?.trim()) add('missing_course', 'יש לבחור קורס.', 'Select a course.', e.id)
    if (e.kind === 'bundle' && !e.members.length) add('missing_members', 'יש להוסיף קורסים וקבוצות למנה.', 'Add the courses and groups in the packet.', e.id)
    if (e.kind === 'bundle' && e.members.some((m) => !m.group.trim())) add('missing_member_group', 'יש להזין קבוצה לכל קורס במנה.', 'Enter a group for each course in the packet.', e.id)
    if (e.points !== 0 && e.points < d.minimumBid) add('below_minimum', 'ניקוד הבחירה נמוך מהמינימום; חלופה יכולה להיות באפס.', 'A bid is below the minimum; a fallback may use zero.', e.id)
    // Alternative packets may share members. Only an identical registration target is a duplicate.
    const target = e.kind === 'course' ? `course:${e.courseId}:${e.group.trim()}`
      : `bundle:${e.group.trim()}:${e.members.map((m) => `${m.courseId}/${m.group.trim()}`).sort().join('|')}`
    if (targets.has(target)) add('duplicate_target', 'אותו קורס וקבוצה או אותה מנה מופיעים פעמיים.', 'The same course/group or packet appears twice.', e.id)
    targets.add(target)
    const memberTargets = e.members.map((m) => `${m.courseId}/${m.group.trim()}`)
    if (new Set(memberTargets).size !== memberTargets.length) add('duplicate_member', 'קורס וקבוצה מופיעים פעמיים באותה מנה.', 'A course/group appears twice within the packet.', e.id)
  }
  if (d.transferMode === 'manual') {
    const edges = new Map(d.entries.map((e) => [e.id, e.transferTo || null]))
    for (const e of d.entries) {
      if (e.transferTo && !ids.has(e.transferTo)) add('missing_transfer_target', 'יעד העברת הנקודות אינו קיים.', 'The transfer target does not exist.', e.id)
      if (e.transferTo === e.id) add('self_transfer', 'אי אפשר להעביר נקודות לאותה בחירה.', 'An entry cannot transfer to itself.', e.id)
    }
    const complete = new Set<string>()
    for (const e of d.entries) {
      const path = new Set<string>()
      let cursor: string | null | undefined = e.id
      while (cursor && ids.has(cursor) && !complete.has(cursor)) {
        if (path.has(cursor)) { add('transfer_cycle', 'מסלול העברת הנקודות מכיל מעגל.', 'The transfer route contains a cycle.', e.id); break }
        path.add(cursor)
        cursor = edges.get(cursor)
      }
      path.forEach((id) => complete.add(id))
    }
  }
  return { valid: issues.length === 0, allocated, remaining: d.budget - allocated, issues }
}

export interface BiddingSimulation {
  valid: boolean
  issues: BiddingIssue[]
  totalInitial: number
  remainingBudget: number
  unallocated: number
  entries: Array<{ id: string; initialPoints: number; receivedPoints: number; transferredPoints: number; effectivePoints: number; outcome: BiddingOutcome }>
  transfers: Array<{ from: string; to: string; points: number }>
}

/** A user-defined what-if, not a simulation of demand or an official rule engine.
 * Rejected choices pass their entire pool; canceled choices release their pool.
 * Accepted, alternate-group and pending choices retain it. These assumptions are shown in the panel.
 */
export function simulateBiddingTransfers(draft: BiddingDraft, assumptions: Record<string, BiddingOutcome> = {}): BiddingSimulation {
  const validation = validateBiddingDraft(draft)
  const result: BiddingSimulation = { valid: validation.valid, issues: validation.issues,
    totalInitial: validation.allocated, remainingBudget: validation.remaining, unallocated: 0, entries: [], transfers: [] }
  if (!validation.valid) return result
  const entries = ordered(draft.entries)
  const rows = new Map(entries.map((e) => [e.id, { id: e.id, initialPoints: e.points,
    receivedPoints: 0, transferredPoints: 0, effectivePoints: e.points, outcome: assumptions[e.id] ?? e.outcome }]))
  const edges = new Map(entries.map((e, index) => [e.id,
    draft.transferMode === 'manual' ? e.transferTo || null : entries[index + 1]?.id || null]))
  // Topological traversal also permits an explicit route to an earlier priority.
  const indegree = new Map(entries.map((e) => [e.id, 0]))
  edges.forEach((to) => { if (to) indegree.set(to, indegree.get(to)! + 1) })
  const queue = entries.filter((e) => indegree.get(e.id) === 0).map((e) => e.id)
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]
    const row = rows.get(id)!
    const target = edges.get(id)
    if (row.outcome === 'rejected' || row.outcome === 'canceled') {
      const amount = row.effectivePoints
      row.effectivePoints = 0
      if (row.outcome === 'rejected' && target) {
        row.transferredPoints = amount
        const receiver = rows.get(target)!
        receiver.receivedPoints += amount
        receiver.effectivePoints += amount
        if (amount > 0) result.transfers.push({ from: id, to: target, points: amount })
      } else result.unallocated += amount
    }
    if (target) {
      indegree.set(target, indegree.get(target)! - 1)
      if (indegree.get(target) === 0) queue.push(target)
    }
  }
  result.entries = draft.entries.map((e) => rows.get(e.id)!)
  return result
}

export interface BiddingEvidence { entryId: string; summary: BiddingHistorySummary }

export function biddingBundleSignature(members: BiddingEntry['members']): string {
  const compare = (a: string, b: string) => a === b ? 0 : a < b ? -1 : 1
  return JSON.stringify(members.map((m) => [m.courseId.trim(), m.group.trim()])
    .sort((a, b) => compare(a[0], b[0]) || compare(a[1], b[1])))
}

/** Matching, sufficiently aggregated context. Score learning applies a separate accepted sample gate. */
export function getBiddingContextHistory(draft: BiddingDraft, history: BiddingHistory): BiddingEvidence[] {
  const threshold = Math.max(5, Number.isFinite(history.minimumContributors) ? history.minimumContributors : 5)
  return draft.entries.flatMap((entry) => {
    return history.summaries.filter((s) => s.kind === entry.kind && s.courseId === entry.courseId
      && s.group === entry.group && s.semester === draft.semester && s.round === draft.round
      && (entry.kind === 'course' || (entry.members.length > 0 && s.bundleSignature === biddingBundleSignature(entry.members)))
      && Number.isInteger(s.academicYear) && s.academicYear < draft.academicYear
      && Number.isInteger(s.contributors) && s.contributors >= threshold
      && Number.isInteger(s.acceptedCount) && s.acceptedCount >= 0
      && Number.isInteger(s.rejectedCount) && s.rejectedCount >= 0
      && s.acceptedCount + s.rejectedCount <= s.contributors)
      .sort((a, b) => b.academicYear - a.academicYear).map((summary) => ({ entryId: entry.id, summary: {
        ...summary,
        // A tiny accepted subgroup must not expose a single student's score through a quantile.
        acceptedBidMedian: safeHistoricalScore(summary.acceptedBidMedian, summary.acceptedCount >= threshold),
        acceptedBidP75: safeHistoricalScore(summary.acceptedBidP75, summary.acceptedCount >= threshold),
      } }))
  })
}

function safeHistoricalScore(value: number | null, sufficient: boolean): number | null {
  return sufficient && value !== null && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000 ? value : null
}

/** Defends against stale or insufficient transport responses before they influence an allocation. */
export function getBiddingEvidence(draft: BiddingDraft, history: BiddingHistory): BiddingEvidence[] {
  const context = getBiddingContextHistory(draft, history)
  return draft.entries.flatMap((entry) => {
    const evidence = context.find((row) => row.entryId === entry.id && row.summary.acceptedBidP75 !== null)
    return evidence ? [evidence] : []
  })
}

export interface BiddingAllocationProposal {
  feasible: boolean
  method: 'priority' | 'history_and_priority'
  reason: 'ready' | 'invalid_draft' | 'insufficient_budget' | 'no_active_entries'
  allocations: Array<{ entryId: string; points: number }>
  evidence: BiddingEvidence[]
  basedOn: string
}

/** Deterministic budgeting heuristic. Historical accepted scores guide relative weights, not probabilities. */
export function proposeBiddingAllocation(draft: BiddingDraft, history: BiddingHistory): BiddingAllocationProposal {
  const evidence = getBiddingEvidence(draft, history).filter((row) => draft.entries.some((entry) => entry.id === row.entryId && entry.outcome === 'pending' && entry.points > 0))
  const proposal: BiddingAllocationProposal = { feasible: false, method: evidence.length ? 'history_and_priority' : 'priority',
    reason: 'invalid_draft', allocations: [], evidence, basedOn: JSON.stringify(draft) }
  const validation = validateBiddingDraft(draft)
  if (validation.issues.some((issue) => !['over_budget', 'below_minimum'].includes(issue.code))) return proposal
  const active = ordered(draft.entries).filter((e) => e.outcome === 'pending' && e.points > 0)
  if (validation.issues.some((issue) => issue.code === 'below_minimum' && !active.some((entry) => entry.id === issue.entryId))) return proposal
  const fixed = draft.entries.filter((e) => !active.some((a) => a.id === e.id)).reduce((sum, e) => sum + e.points, 0)
  const minimum = Math.max(1, draft.minimumBid)
  if (fixed + active.length * minimum > draft.budget) return { ...proposal, reason: 'insufficient_budget' }
  if (!active.length) return { ...proposal, reason: 'no_active_entries' }
  const available = draft.budget - fixed - minimum * active.length
  const weights = active.map((e, index) => {
    const historical = evidence.find((row) => row.entryId === e.id)?.summary.acceptedBidP75
    return (active.length - index) * Math.max(minimum, historical ?? minimum)
  })
  const totalWeight = weights.reduce((sum, value) => sum + value, 0)
  const shares = weights.map((weight, index) => ({ index, raw: available * weight / totalWeight }))
  const amounts = shares.map((share) => minimum + Math.floor(share.raw))
  let remainder = draft.budget - fixed - amounts.reduce((sum, value) => sum + value, 0)
  shares.sort((a, b) => (b.raw - Math.floor(b.raw)) - (a.raw - Math.floor(a.raw)) || a.index - b.index)
  for (const share of shares) { if (remainder <= 0) break; amounts[share.index]++; remainder-- }
  return { ...proposal, feasible: true, reason: 'ready', allocations: active.map((e, index) => ({ entryId: e.id, points: amounts[index] })) }
}

/** An explicit apply may update pending initial points only, and rejects stale proposals. */
export function applyBiddingAllocation(draft: BiddingDraft, proposal: BiddingAllocationProposal): BiddingDraft {
  if (proposal.basedOn !== JSON.stringify(draft)) throw new Error('The draft changed. Generate a new allocation proposal.')
  if (!proposal.feasible) throw new Error('The allocation proposal cannot be applied.')
  const amounts = new Map(proposal.allocations.map((a) => [a.entryId, a.points]))
  const result = { ...draft, entries: draft.entries.map((entry) => entry.outcome === 'pending' && entry.points > 0 && amounts.has(entry.id)
    ? { ...entry, points: amounts.get(entry.id)! } : { ...entry }) }
  if (!validateBiddingDraft(result).valid) throw new Error('The allocation proposal is invalid.')
  return result
}

export function exportBiddingDraft(draft: BiddingDraft, locale: 'he' | 'en' = 'he'): string {
  if (!validateBiddingDraft(draft).valid) throw new Error('Review and correct the bidding draft before export.')
  const he = locale === 'he'
  const outcomes: Record<BiddingOutcome, string> = he
    ? { pending: 'ממתין', accepted: 'התקבלתי', rejected: 'נדחיתי', other_group: 'קבוצה אחרת', canceled: 'ביטלתי' }
    : { pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected', other_group: 'Other group', canceled: 'Canceled' }
  const reasons: Record<string, string> = he
    ? { points: 'ניקוד', closed_group: 'קבוצה סגורה', ineligible: 'אי עמידה בתנאי רישום', canceled: 'הקורס בוטל', other_group: 'קבוצה אחרת', other: 'אחר' }
    : { points: 'Points', closed_group: 'Closed group', ineligible: 'Ineligible', canceled: 'Course canceled', other_group: 'Other group', other: 'Other' }
  const entries = ordered(draft.entries)
  return [
    he ? 'טיוטת בידינג — להזנה ידנית באתר הרשמי' : 'Bidding draft — Manual entry on the official site',
    `${draft.academicYear}–${draft.academicYear + 1} | ${he ? 'סמסטר' : 'Semester'} ${draft.semester} | ${he ? 'מקצה' : 'Round'} ${draft.round}`,
    `${he ? 'תקציב' : 'Budget'}: ${draft.budget} | ${he ? 'מינימום' : 'Minimum'}: ${draft.minimumBid} | ${he ? 'העברות' : 'Transfers'}: ${draft.transferMode === 'automatic' ? (he ? 'לפי סדר העדיפויות' : 'By priority') : (he ? 'ליעד שנבחר' : 'Designated target')}`,
    `${he ? 'מקור הכללים' : 'Rules source'}: ${draft.rulesSource || (he ? 'הזנה ידנית של הסטודנט' : 'Student-entered rules')}`,
    he ? 'תוצאות בדיווח הסטודנט; הטיוטה אינה אישור רישום.' : 'Student-reported results; this draft is not registration confirmation.',
    ...entries.map((e, index) => [
      `${e.priority}. ${e.label} (${e.kind === 'bundle' ? (he ? 'מנה' : 'Packet') : e.courseId || '—'})`,
      `${he ? 'קבוצה/מנה' : 'Group/packet'}: ${e.group || '—'}`,
      `${he ? 'ניקוד התחלתי' : 'Initial points'}: ${e.points}`,
      `${he ? 'יעד העברה' : 'Transfer target'}: ${draft.transferMode === 'automatic' ? entries[index + 1]?.label || '—' : draft.entries.find((target) => target.id === e.transferTo)?.label || '—'}`,
      `${he ? 'תוצאה' : 'Result'}: ${outcomes[e.outcome]}`,
      ...(e.effectivePoints !== undefined ? [`${he ? 'ניקוד סופי מדווח' : 'Reported final points'}: ${e.effectivePoints}`] : []),
      ...(e.rejectionReason ? [`${he ? 'סיבה' : 'Reason'}: ${reasons[e.rejectionReason] ?? e.rejectionReason}`] : []),
      ...(e.members.length ? [`${he ? 'קורסים וקבוצות' : 'Courses and groups'}: ${e.members.map((m) => `${m.courseId} / ${m.group}`).join(', ')}`] : []),
    ].join(' | ')),
  ].join('\n')
}
