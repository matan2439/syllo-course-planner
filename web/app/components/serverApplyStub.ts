/**
 * A stand-in for the real `/api/ai/apply-plan`, for journey tests.
 *
 * It deliberately enforces the SAME rules the endpoint does — the candidate
 * must belong to the named proposal, and the committed plan comes from the
 * stub's own stored candidates rather than from anything the caller sends. A
 * stub that simply echoed the request back would let a journey test pass while
 * the client was still the source of truth, which is exactly the defect the
 * server Apply exists to remove.
 *
 * The endpoint's full rejection matrix is proven against the real handler in
 * `tests/api/apply_plan_endpoint.test.ts`; this only needs to be faithful
 * enough that the JOURNEY cannot cheat.
 */
import type { ApplyPlanResult, CommittedBoardState } from '../../../shared/planner/api-client'

export interface StubCandidate {
  candidateId: string
  semesters: Array<{ semesterId: string; courseIds: string[] }>
}

export interface ServerApplyStub {
  /** Drop-in for the journey's `applyFn`. */
  applyFn: (req: {
    program_id: string
    proposal_id: string
    candidate_id: string
    expected_board_version: string | null
    idempotency_key: string
  }) => Promise<ApplyPlanResult>
  /** Drop-in for the journey's `committedBoardFn`. */
  committedBoardFn: (programId: string) => Promise<CommittedBoardState | null>
  /** Every apply request the journey sent, in order. */
  readonly calls: Array<Record<string, unknown>>
  /** The board as the "server" holds it. */
  readonly committed: CommittedBoardState | null
}

export function createServerApplyStub(options: {
  proposalId: string
  candidates: StubCandidate[]
  programId?: string
  /** Force a typed refusal instead of a commit. */
  reject?: { code: string; messageHe: string; currentBoardVersion?: string | null }
  /** Make the transport itself fail, as a network error would. */
  throwOnApply?: boolean
}): ServerApplyStub {
  const programId = options.programId ?? 'mechanical_engineering_2027'
  const calls: Array<Record<string, unknown>> = []
  let committed: CommittedBoardState | null = null
  let version = 0
  const applied = new Map<string, CommittedBoardState>()

  const stub: ServerApplyStub = {
    calls,
    get committed() { return committed },
    async committedBoardFn() { return committed },
    async applyFn(req) {
      calls.push({ ...req })
      if (options.throwOnApply) throw new Error('network down')
      if (options.reject) {
        return {
          ok: false,
          code: options.reject.code,
          messageHe: options.reject.messageHe,
          currentBoardVersion: options.reject.currentBoardVersion ?? null,
        }
      }
      if (req.proposal_id !== options.proposalId) {
        return { ok: false, code: 'PROPOSAL_NOT_FOUND', messageHe: 'ההצעה כבר אינה זמינה.' }
      }
      // Idempotency, on the same terms as the server: same key ⇒ same result.
      const replay = applied.get(req.idempotency_key)
      if (replay) return { ok: true, replayed: true, board: replay, appliedCandidateId: req.candidate_id }

      const candidate = options.candidates.find((c) => c.candidateId === req.candidate_id)
      if (!candidate) {
        return { ok: false, code: 'CANDIDATE_NOT_IN_PROPOSAL', messageHe: 'החלופה אינה חלק מההצעה הזו.' }
      }
      if ((req.expected_board_version ?? null) !== (committed?.version ?? null)) {
        return {
          ok: false, code: 'BOARD_VERSION_CONFLICT',
          messageHe: 'התוכנית הנוכחית התעדכנה בינתיים.',
          currentBoardVersion: committed?.version ?? null,
        }
      }
      version += 1
      // THE authoritative content: the stub's stored plan, never the request's.
      committed = { programId, version: `bv_${version}`, semesters: candidate.semesters }
      applied.set(req.idempotency_key, committed)
      return { ok: true, replayed: false, board: committed, appliedCandidateId: candidate.candidateId }
    },
  }
  return stub
}
