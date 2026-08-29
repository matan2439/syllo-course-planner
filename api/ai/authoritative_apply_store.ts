import type { CommittedBoard } from './board_repository';

export type AuthoritativeApplyFailureReason =
  | 'PROPOSAL_NOT_FOUND'
  | 'PROPOSAL_EXPIRED'
  | 'PROPOSAL_SUPERSEDED'
  | 'CANDIDATE_NOT_IN_PROPOSAL'
  | 'CANDIDATE_NOT_APPLYABLE'
  | 'CANDIDATE_IDENTITY_MISMATCH'
  | 'CONSTRAINT_FINGERPRINT_MISMATCH'
  | 'PROFILE_VERSION_MISMATCH'
  | 'ACADEMIC_STATUS_MISMATCH'
  | 'BOARD_VERSION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT';

export interface AuthoritativeApplyInput {
  ownerId: string;
  programId: string;
  proposalId: string;
  candidateId: string;
  expectedBoardVersion: string | null;
  expectedProfileVersion: number;
  expectedAcademicStatusDigest: string;
  idempotencyKey: string;
  now: number;
  validateStoredCandidate(
    semesters: CommittedBoard['semesters'],
  ): AuthoritativeCandidateValidation | Promise<AuthoritativeCandidateValidation>;
}

export interface AuthoritativeCandidateValidation {
  valid: boolean;
  constraintFingerprint: string;
}

export type AuthoritativeApplyResult =
  | {
      ok: true;
      replayed: boolean;
      proposalId: string;
      candidateId: string;
      board: CommittedBoard;
    }
  | { ok: false; reason: AuthoritativeApplyFailureReason; board?: CommittedBoard | null };

export interface AuthoritativeApplyStore {
  apply(input: AuthoritativeApplyInput): Promise<AuthoritativeApplyResult>;
}
