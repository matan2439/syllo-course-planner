import type {
  AuthoritativeApplyInput,
  AuthoritativeApplyResult,
  AuthoritativeApplyStore,
} from '../authoritative_apply_store';
import type { CommittedBoard } from '../board_repository';
import { ownerStorageKey } from '../owner_key';

type ApplyRow = Record<string, unknown>;

export interface PlannerAtomicApplyTransaction {
  unsafe(query: string, parameters?: readonly unknown[]): Promise<ApplyRow[]>;
}

export interface PlannerAtomicApplySql extends PlannerAtomicApplyTransaction {
  begin<T>(fn: (tx: PlannerAtomicApplyTransaction) => Promise<T>): Promise<T>;
}

const versionNumber = (version: string | null): number | null => {
  if (version === null) return null;
  const match = /^bv_(\d+)$/.exec(version);
  return match ? Number(match[1]) : null;
};

const timestampMs = (value: unknown): number => value instanceof Date
  ? value.getTime()
  : Date.parse(String(value));

function normalizeSemesters(value: unknown): CommittedBoard['semesters'] {
  const semesters = structuredClone(value) as CommittedBoard['semesters'];
  return semesters
    .map((semester) => ({
      semesterId: semester.semesterId,
      courseIds: [...new Set(semester.courseIds)].sort(),
    }))
    .sort((a, b) => a.semesterId.localeCompare(b.semesterId));
}

function candidateIdentity(value: unknown): string {
  const semesters = value as CommittedBoard['semesters'];
  const pairs: Array<[string, string]> = [];
  for (const semester of semesters) {
    for (const courseId of semester.courseIds) pairs.push([courseId, semester.semesterId]);
  }
  pairs.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  return JSON.stringify(pairs);
}

function committedBoardFromRow(row: ApplyRow, ownerId: string): CommittedBoard {
  const version = `bv_${Number(row.version_number)}`;
  const board: CommittedBoard = {
    ownerId,
    programId: String(row.program_id),
    version,
    semesters: structuredClone(row.semesters_json) as CommittedBoard['semesters'],
    updatedAt: timestampMs(row.updated_at),
  };
  if (row.last_proposal_id != null && row.last_candidate_id != null
    && row.last_idempotency_key != null && row.last_applied_at != null) {
    board.lastApply = {
      proposalId: String(row.last_proposal_id),
      candidateId: String(row.last_candidate_id),
      idempotencyKey: String(row.last_idempotency_key),
      version,
      appliedAt: timestampMs(row.last_applied_at),
    };
  }
  return board;
}

export class PostgresAuthoritativeApplyStore implements AuthoritativeApplyStore {
  constructor(private readonly sql: PlannerAtomicApplySql) {}

  async apply(input: AuthoritativeApplyInput): Promise<AuthoritativeApplyResult> {
    return this.sql.begin(async (tx) => {
      const ownerHash = ownerStorageKey(input.ownerId);
      await tx.unsafe(
        `SELECT pg_advisory_xact_lock(hashtextextended($1 || '::' || $2, 0))`,
        [ownerHash, input.programId],
      );

      const receipts = await tx.unsafe(
        `SELECT proposal_id, candidate_id, committed_board_json
           FROM planner_apply_receipts
          WHERE owner_hash = $1 AND program_id = $2 AND idempotency_key = $3`,
        [ownerHash, input.programId, input.idempotencyKey],
      );
      if (receipts.length > 0) {
        const receipt = receipts[0];
        if (receipt.proposal_id !== input.proposalId || receipt.candidate_id !== input.candidateId) {
          return { ok: false, reason: 'IDEMPOTENCY_CONFLICT' };
        }
        return {
          ok: true,
          replayed: true,
          proposalId: input.proposalId,
          candidateId: input.candidateId,
          board: {
            ...(structuredClone(receipt.committed_board_json) as Omit<CommittedBoard, 'ownerId'>),
            ownerId: input.ownerId,
            programId: input.programId,
          },
        };
      }

      const proposals = await tx.unsafe(
        `SELECT proposal_id, program_id, created_at, expires_at, superseded_by,
                base_board_version, profile_version, academic_status_digest,
                constraint_fingerprint, apply_eligible
           FROM planner_proposals
          WHERE proposal_id = $1 AND owner_hash = $2
          FOR UPDATE`,
        [input.proposalId, ownerHash],
      );
      if (proposals.length === 0 || proposals[0].program_id !== input.programId) {
        return { ok: false, reason: 'PROPOSAL_NOT_FOUND' };
      }
      const proposal = proposals[0];
      if (proposal.superseded_by != null) return { ok: false, reason: 'PROPOSAL_SUPERSEDED' };
      const expiresAt = timestampMs(proposal.expires_at);
      if (!Number.isFinite(expiresAt) || input.now >= expiresAt) {
        return { ok: false, reason: 'PROPOSAL_EXPIRED' };
      }
      if (Number(proposal.profile_version) !== input.expectedProfileVersion) {
        return { ok: false, reason: 'PROFILE_VERSION_MISMATCH' };
      }
      if (String(proposal.academic_status_digest) !== input.expectedAcademicStatusDigest) {
        return { ok: false, reason: 'ACADEMIC_STATUS_MISMATCH' };
      }

      const candidates = await tx.unsafe(
        `SELECT candidate_id, semesters_json, normalized_identity, valid, applyable
           FROM planner_proposal_candidates
          WHERE proposal_id = $1 AND candidate_id = $2`,
        [input.proposalId, input.candidateId],
      );
      if (candidates.length === 0) return { ok: false, reason: 'CANDIDATE_NOT_IN_PROPOSAL' };
      const candidate = candidates[0];
      if (!proposal.apply_eligible || !candidate.valid || !candidate.applyable) {
        return { ok: false, reason: 'CANDIDATE_NOT_APPLYABLE' };
      }
      if (candidateIdentity(candidate.semesters_json) !== String(candidate.normalized_identity)) {
        return { ok: false, reason: 'CANDIDATE_IDENTITY_MISMATCH' };
      }
      const storedSemesters = structuredClone(candidate.semesters_json) as CommittedBoard['semesters'];
      const validation = await input.validateStoredCandidate(storedSemesters);
      if (!validation.valid) {
        return { ok: false, reason: 'CANDIDATE_NOT_APPLYABLE' };
      }
      if (validation.constraintFingerprint !== String(proposal.constraint_fingerprint)) {
        return { ok: false, reason: 'CONSTRAINT_FINGERPRINT_MISMATCH' };
      }

      const boards = await tx.unsafe(
        `SELECT program_id, version_number, semesters_json, updated_at,
                last_proposal_id, last_candidate_id, last_idempotency_key, last_applied_at
           FROM planner_boards
          WHERE owner_hash = $1 AND program_id = $2
          FOR UPDATE`,
        [ownerHash, input.programId],
      );
      const currentVersion = boards.length === 0 ? null : `bv_${Number(boards[0].version_number)}`;
      if ((proposal.base_board_version ?? null) !== currentVersion
        || input.expectedBoardVersion !== currentVersion) {
        return {
          ok: false,
          reason: 'BOARD_VERSION_CONFLICT',
          board: boards.length === 0 ? null : committedBoardFromRow(boards[0], input.ownerId),
        };
      }

      const nextVersionNumber = (versionNumber(currentVersion) ?? 0) + 1;
      const version = `bv_${nextVersionNumber}`;
      const semesters = normalizeSemesters(storedSemesters);
      const board: CommittedBoard = {
        ownerId: input.ownerId,
        programId: input.programId,
        version,
        semesters,
        updatedAt: input.now,
        lastApply: {
          proposalId: input.proposalId,
          candidateId: input.candidateId,
          idempotencyKey: input.idempotencyKey,
          version,
          appliedAt: input.now,
        },
      };
      const { ownerId: _ownerId, ...storedBoard } = board;

      await tx.unsafe(
        `INSERT INTO planner_boards (
           owner_hash, program_id, version_number, semesters_json, updated_at,
           last_proposal_id, last_candidate_id, last_idempotency_key, last_applied_at
         ) VALUES ($1, $2, $3, $4::text::jsonb, to_timestamp($8 / 1000.0), $5, $6, $7,
                   to_timestamp($8 / 1000.0))
         ON CONFLICT (owner_hash, program_id) DO UPDATE SET
           version_number = EXCLUDED.version_number,
           semesters_json = EXCLUDED.semesters_json,
           updated_at = EXCLUDED.updated_at,
           last_proposal_id = EXCLUDED.last_proposal_id,
           last_candidate_id = EXCLUDED.last_candidate_id,
           last_idempotency_key = EXCLUDED.last_idempotency_key,
           last_applied_at = EXCLUDED.last_applied_at`,
        [ownerHash, input.programId, nextVersionNumber, JSON.stringify(semesters),
          input.proposalId, input.candidateId, input.idempotencyKey, input.now],
      );
      await tx.unsafe(
        `INSERT INTO planner_apply_receipts (
           owner_hash, program_id, idempotency_key, proposal_id, candidate_id,
           produced_version_number, committed_board_json, applied_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::text::jsonb, to_timestamp($8 / 1000.0))`,
        [ownerHash, input.programId, input.idempotencyKey, input.proposalId,
          input.candidateId, nextVersionNumber, JSON.stringify(storedBoard), input.now],
      );

      return {
        ok: true,
        replayed: false,
        proposalId: input.proposalId,
        candidateId: input.candidateId,
        board,
      };
    });
  }
}
