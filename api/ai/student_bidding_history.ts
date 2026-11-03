import type { BiddingHistory, BiddingHistorySummary } from '../../shared/planner/bidding';

export const MIN_BIDDING_CONTRIBUTORS = 5;
export interface BiddingObservation {
  owner: string; programId: string; academicYear: number; semester: 1 | 2; round: number;
  kind: 'course' | 'bundle'; courseId?: string; group: string; points: number | null;
  initialPoints?: number; bundleSignature?: string;
  outcome: string; rejectionReason: string;
}
export type ObservationInput = Omit<BiddingObservation, 'owner' | 'programId' | 'academicYear' | 'semester' | 'round'>;
const excluded = new Set(['closed_group', 'group_closed', 'canceled', 'ineligible', 'other_group', 'unknown', 'קבוצה סגורה']);

/** All returned buckets are historical, owner-deduplicated and large enough to publish. */
export function aggregateBiddingHistory(rows: readonly BiddingObservation[], beforeYear: number): BiddingHistory {
  const buckets = new Map<string, Map<string, BiddingObservation>>();
  for (const row of rows) {
    if (row.academicYear >= beforeYear || !row.group.trim() || typeof row.points !== 'number' || !Number.isFinite(row.points) || row.points < 0) continue;
    if (row.kind === 'bundle' && !row.bundleSignature) continue;
    if (row.outcome !== 'accepted' && !(row.outcome === 'rejected' && ['insufficient_points', 'points', 'score'].includes(row.rejectionReason))) continue;
    if (excluded.has(row.rejectionReason)) continue;
    const key = JSON.stringify([row.programId, row.academicYear, row.semester, row.round, row.kind, row.courseId ?? '', row.group, row.bundleSignature ?? '']);
    const bucket = buckets.get(key) ?? new Map();
    bucket.set(row.owner, row);
    buckets.set(key, bucket);
  }
  const summaries: BiddingHistorySummary[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.size < MIN_BIDDING_CONTRIBUTORS) continue;
    const values = [...bucket.values()];
    const sample = values[0];
    const accepted = values.filter((v) => v.outcome === 'accepted').map((v) => v.points as number).sort((a, b) => a - b);
    // Suppress outcome-specific values from very small subsets too.
    const quantile = (fraction: number) => accepted.length < MIN_BIDDING_CONTRIBUTORS ? null : accepted[Math.ceil(fraction * accepted.length) - 1];
    summaries.push({
      kind: sample.kind, ...(sample.courseId ? { courseId: sample.courseId } : {}), group: sample.group,
      ...(sample.bundleSignature ? { bundleSignature: sample.bundleSignature } : {}),
      academicYear: sample.academicYear, semester: sample.semester, round: sample.round,
      contributors: values.length, acceptedCount: accepted.length, rejectedCount: values.length - accepted.length,
      acceptedBidMedian: quantile(0.5), acceptedBidP75: quantile(0.75),
      source: 'consented_self_reported_results',
    });
  }
  return { summaries: summaries.sort((a, b) => b.academicYear - a.academicYear || a.group.localeCompare(b.group)), generatedAt: new Date().toISOString(), minimumContributors: MIN_BIDDING_CONTRIBUTORS };
}
