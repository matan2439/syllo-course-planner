import { z } from 'zod'
import { biddingDraftSchema, type BiddingDraft } from './bidding'

export const biddingRoundSnapshotSchema = z.object({
  id: z.string().min(1).max(100),
  savedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  draft: biddingDraftSchema,
}).strict()
export type BiddingRoundSnapshot = z.infer<typeof biddingRoundSnapshotSchema>
export interface BiddingRoundTransition { snapshot: BiddingRoundSnapshot; nextDraft: BiddingDraft }
export interface BiddingRoundMetadata { id: string; savedAt: number }

function freezeCopy<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach((child) => freezeCopy(child))
    Object.freeze(value)
  }
  return value
}

/** A fully independent, immutable record of student-entered results and points. */
export function archiveBiddingRound(draft: BiddingDraft, metadata: BiddingRoundMetadata): BiddingRoundSnapshot {
  return freezeCopy(biddingRoundSnapshotSchema.parse({ ...metadata, draft }))
}

/** Carry unresolved competition forward. Accepted and canceled choices stay in history. */
export function prepareNextBiddingRound(draft: BiddingDraft, metadata: BiddingRoundMetadata): BiddingRoundTransition {
  const snapshot = archiveBiddingRound(draft, metadata)
  if (snapshot.draft.round >= 20) throw new RangeError('ROUND_LIMIT_REACHED')
  const source: BiddingDraft = JSON.parse(JSON.stringify(snapshot.draft))
  const entries = source.entries.filter((entry) => entry.outcome === 'rejected' || entry.outcome === 'pending')
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .map(({ effectivePoints: _effective, rejectionReason: _reason, transferTo: _transfer, ...entry }, index) => ({
      ...entry, priority: index + 1, points: 0, outcome: 'pending' as const, transferTo: null,
    }))
  return { snapshot, nextDraft: { ...source, round: source.round + 1, budget: 0, rulesConfirmed: false, rulesSource: '', entries } }
}
