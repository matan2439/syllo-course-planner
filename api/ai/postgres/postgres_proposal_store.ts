import type {
  ProposalRecord,
  ProposalStore,
  StoredCandidate,
} from '../proposal_store';
import { ownerStorageKey } from '../owner_key';

type ProposalRow = Record<string, unknown>;

export interface PlannerProposalTransaction {
  unsafe(query: string, parameters?: readonly unknown[]): Promise<ProposalRow[]>;
}

export interface PlannerProposalSql extends PlannerProposalTransaction {
  begin<T>(fn: (sql: PlannerProposalTransaction) => Promise<T>): Promise<T>;
}

const clone = <T>(value: T): T => structuredClone(value);

function timestampMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const parsed = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new Error('Invalid planner proposal timestamp');
  return parsed;
}

function candidateFromRow(row: ProposalRow): StoredCandidate {
  return {
    candidateId: String(row.candidate_id),
    semesters: clone(row.semesters_json) as StoredCandidate['semesters'],
    normalizedIdentity: String(row.normalized_identity),
    valid: Boolean(row.valid),
    applyable: Boolean(row.applyable),
    recommended: Boolean(row.recommended),
  };
}

function proposalFromRows(
  row: ProposalRow,
  candidates: StoredCandidate[],
  ownerId: string,
): ProposalRecord {
  const record: ProposalRecord = {
    proposalId: String(row.proposal_id),
    ownerId,
    programId: String(row.program_id),
    createdAt: timestampMs(row.created_at),
    expiresAt: timestampMs(row.expires_at),
    baseBoardVersion: row.base_board_version == null ? null : String(row.base_board_version),
    profileVersion: Number(row.profile_version),
    academicStatusDigest: String(row.academic_status_digest),
    constraintFingerprint: String(row.constraint_fingerprint),
    snapshotId: String(row.snapshot_id),
    candidates,
    recommendedCandidateId: row.recommended_candidate_id == null
      ? null
      : String(row.recommended_candidate_id),
    outcome: String(row.outcome),
    applyEligible: Boolean(row.apply_eligible),
  };
  if (row.superseded_by != null) record.supersededBy = String(row.superseded_by);
  return record;
}

export class PostgresProposalStore implements ProposalStore {
  constructor(private readonly sql: PlannerProposalSql) {}

  async put(record: ProposalRecord): Promise<ProposalRecord> {
    await this.sql.begin(async (tx) => {
      await tx.unsafe(
        `INSERT INTO planner_proposals (
           proposal_id, owner_hash, program_id, created_at, expires_at,
           superseded_by, base_board_version, profile_version,
           academic_status_digest, constraint_fingerprint, snapshot_id,
           recommended_candidate_id, outcome, apply_eligible
         ) VALUES (
           $1, $2, $3, to_timestamp($4 / 1000.0), to_timestamp($5 / 1000.0),
           $6, $7, $8, $9, $10, $11, $12, $13, $14
         )`,
        [
          record.proposalId,
          ownerStorageKey(record.ownerId),
          record.programId,
          record.createdAt,
          record.expiresAt,
          record.supersededBy ?? null,
          record.baseBoardVersion,
          record.profileVersion,
          record.academicStatusDigest,
          record.constraintFingerprint,
          record.snapshotId,
          record.recommendedCandidateId,
          record.outcome,
          record.applyEligible,
        ],
      );

      for (const candidate of record.candidates) {
        await tx.unsafe(
          `INSERT INTO planner_proposal_candidates (
             proposal_id, candidate_id, semesters_json, normalized_identity,
             valid, applyable, recommended
           ) VALUES ($1, $2, $3::text::jsonb, $4, $5, $6, $7)`,
          [
            record.proposalId,
            candidate.candidateId,
            JSON.stringify(candidate.semesters),
            candidate.normalizedIdentity,
            candidate.valid,
            candidate.applyable,
            candidate.recommended,
          ],
        );
      }

      await tx.unsafe(
        `UPDATE planner_proposals
            SET superseded_by = $1
          WHERE owner_hash = $2
            AND program_id = $3
            AND proposal_id <> $4
            AND superseded_by IS NULL`,
        [record.proposalId, ownerStorageKey(record.ownerId), record.programId, record.proposalId],
      );
    });
    return clone(record);
  }

  async get(proposalId: string, ownerId?: string): Promise<ProposalRecord | null> {
    if (!ownerId) return null;
    const proposals = await this.sql.unsafe(
      `SELECT proposal_id, owner_hash, program_id, created_at, expires_at,
              superseded_by, base_board_version, profile_version,
              academic_status_digest, constraint_fingerprint, snapshot_id,
              recommended_candidate_id, outcome, apply_eligible
         FROM planner_proposals
        WHERE proposal_id = $1 AND owner_hash = $2`,
      [proposalId, ownerStorageKey(ownerId)],
    );
    if (proposals.length === 0) return null;

    const candidateRows = await this.sql.unsafe(
      `SELECT candidate_id, semesters_json, normalized_identity,
              valid, applyable, recommended
         FROM planner_proposal_candidates
        WHERE proposal_id = $1
        ORDER BY candidate_id`,
      [proposalId],
    );

    return proposalFromRows(proposals[0], candidateRows.map(candidateFromRow), ownerId);
  }
}
