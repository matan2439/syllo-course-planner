/**
 * proposal_store.ts — S1: what the SERVER remembers after a Generate.
 *
 * Until now a Generate computed a validated candidate set, serialized it, and
 * forgot it. That left the browser as the only holder of the plans, so an Apply
 * had nothing to name except the plan itself — and a plan sent by a client is
 * exactly what must not be trusted.
 *
 * A proposal record is therefore the server's own copy of what it decided:
 * which candidates were validated, under which hard constraints, against which
 * evidence snapshot, for which owner, on top of which board version. Apply
 * resolves a candidate out of THIS record; the request only names one.
 *
 * ── Supersession (deterministic) ─────────────────────────────────────────────
 * A newer proposal for the same (owner, program) supersedes every older
 * non-superseded one, recording the id that replaced it. The rule is "newer
 * proposal for the same owner and program", not "newer in time" — so two
 * programs, or two people, never invalidate each other. A superseded or expired
 * record can never be applied, which is what stops a stale tab from committing
 * a plan built from assumptions the student has since changed.
 */
import { randomUUID } from 'crypto';

export interface StoredCandidate {
  candidateId: string;
  /** The COMPLETE plan, exactly as validated. This is the applied content. */
  semesters: Array<{ semesterId: string; courseIds: string[] }>;
  normalizedIdentity: string;
  /** Passed the authoritative validator at generation time. */
  valid: boolean;
  /** May be offered to the student as a choice. */
  applyable: boolean;
  recommended: boolean;
}

export interface ProposalRecord {
  proposalId: string;
  /** The server-issued session that owns this. Never client-supplied. */
  ownerId: string;
  programId: string;
  createdAt: number;
  expiresAt: number;
  /** Set when a newer proposal replaced this one. */
  supersededBy?: string;
  /** The committed board version this was planned on top of; null ⇒ none yet. */
  baseBoardVersion: string | null;
  profileVersion: number;
  /** Digest of the academic status the plan assumed — changes invalidate it. */
  academicStatusDigest: string;
  /** Identical across candidates: proof they answer the same question. */
  constraintFingerprint: string;
  snapshotId: string;
  candidates: StoredCandidate[];
  recommendedCandidateId: string | null;
  outcome: string;
  applyEligible: boolean;
}

/** The lean receipt the client gets. It carries no plan the server must trust. */
export interface ProposalReceipt {
  proposalId: string;
  candidateIds: string[];
  recommendedCandidateId: string | null;
  baseBoardVersion: string | null;
  profileVersion: number;
  academicStatusDigest: string;
  expiresAt: number;
}

export function toReceipt(record: ProposalRecord): ProposalReceipt {
  return {
    proposalId: record.proposalId,
    candidateIds: record.candidates.map((c) => c.candidateId),
    recommendedCandidateId: record.recommendedCandidateId,
    baseBoardVersion: record.baseBoardVersion,
    profileVersion: record.profileVersion,
    academicStatusDigest: record.academicStatusDigest,
    expiresAt: record.expiresAt,
  };
}

export interface ProposalStore {
  /** Persist a new record and supersede this owner+program's older ones. */
  put(record: ProposalRecord): Promise<ProposalRecord>;
  get(proposalId: string): Promise<ProposalRecord | null>;
}

/** Two hours: long enough for a real deliberation, short enough to bound staleness. */
export const PROPOSAL_TTL_MS = 2 * 60 * 60 * 1000;

export function newProposalId(): string {
  return `prop_${randomUUID()}`;
}

const clone = <T>(v: T): T => structuredClone(v);

export interface InMemoryProposalStoreOptions {
  clock?: () => number;
  /** Bounded so a long-lived process cannot grow without limit. */
  maxRecords?: number;
}

/**
 * Test/local adapter. As with the board repository, no method awaits between
 * read and write, so supersession cannot interleave within one process.
 *
 * NOT durable. A serverless deployment gives each invocation its own module
 * instance, so a proposal stored by the Generate invocation would not exist for
 * the Apply invocation — which is precisely why the production adapter is
 * recorded as required work rather than claimed as done.
 */
export class InMemoryProposalStore implements ProposalStore {
  private records = new Map<string, ProposalRecord>();
  private readonly clock: () => number;
  private readonly maxRecords: number;

  constructor(options: InMemoryProposalStoreOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.maxRecords = options.maxRecords ?? 500;
  }

  async put(record: ProposalRecord): Promise<ProposalRecord> {
    // Deterministic supersession: same owner AND same program only.
    for (const existing of this.records.values()) {
      if (existing.ownerId !== record.ownerId) continue;
      if (existing.programId !== record.programId) continue;
      if (existing.proposalId === record.proposalId) continue;
      if (existing.supersededBy) continue;
      existing.supersededBy = record.proposalId;
    }
    this.records.set(record.proposalId, clone(record));
    if (this.records.size > this.maxRecords) {
      // Oldest-first eviction by insertion order.
      const excess = this.records.size - this.maxRecords;
      for (const key of [...this.records.keys()].slice(0, excess)) this.records.delete(key);
    }
    return clone(record);
  }

  async get(proposalId: string): Promise<ProposalRecord | null> {
    const found = this.records.get(proposalId);
    return found ? clone(found) : null;
  }

  /** Test-only. Deliberately absent from the ProposalStore interface. */
  reset(): void {
    this.records.clear();
  }
}

// ── validity, as one shared decision ────────────────────────────────────────

export type ProposalRejection =
  | 'PROPOSAL_NOT_FOUND'
  | 'PROPOSAL_EXPIRED'
  | 'PROPOSAL_SUPERSEDED'
  | 'SESSION_MISMATCH';

/**
 * Whether this caller may act on this record at all.
 *
 * Ownership is checked with the SAME "not found" treatment as a missing record
 * would get in terms of information disclosure — the caller learns only that
 * they cannot use it, never that it exists and belongs to someone else.
 */
export function checkProposalAccess(
  record: ProposalRecord | null,
  ownerId: string,
  now: number,
): ProposalRejection | null {
  if (!record) return 'PROPOSAL_NOT_FOUND';
  if (record.ownerId !== ownerId) return 'SESSION_MISMATCH';
  if (record.supersededBy) return 'PROPOSAL_SUPERSEDED';
  if (now >= record.expiresAt) return 'PROPOSAL_EXPIRED';
  return null;
}
