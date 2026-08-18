/**
 * POST /api/ai/apply-plan — S2: the authoritative Apply.
 * GET  /api/ai/apply-plan — the owner's committed board (so a refresh can read
 *                           back what was committed).
 *
 * The contract in one sentence: the client names a proposal and a candidate,
 * and the SERVER decides what that means. A plan in the request body is not
 * read, not merged and not stored — the committed content comes from the
 * proposal record the server wrote at Generate time.
 *
 * Every rejection is a stable, typed reason code. Codes name the CONDITION the
 * caller can act on ("your board moved on", "that proposal was replaced") and
 * never leak whose record it was, what it contained, or any internal id the
 * caller did not already hold.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { resolveOwner } from './session_owner';
import { academicStatusDigest, getBoardRepository, getProposalStore, storageKind } from './apply_runtime';
import { checkProposalAccess, type ProposalRecord } from './proposal_store';
import type { CommittedBoard } from './board_repository';

/** Stable, deterministic rejection codes. Additive only — never renumbered. */
export type ApplyRejectionCode =
  | 'INVALID_REQUEST'
  | 'PROPOSAL_NOT_FOUND'
  | 'PROPOSAL_EXPIRED'
  | 'PROPOSAL_SUPERSEDED'
  | 'SESSION_MISMATCH'
  | 'CANDIDATE_NOT_IN_PROPOSAL'
  | 'CANDIDATE_NOT_APPLYABLE'
  | 'PROFILE_VERSION_MISMATCH'
  | 'ACADEMIC_STATUS_MISMATCH'
  | 'BOARD_VERSION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT';

/** Concise, non-technical Hebrew. No internals, no stack traces, no ids. */
const REASON_HE: Record<ApplyRejectionCode, string> = {
  INVALID_REQUEST: 'הבקשה אינה תקינה.',
  PROPOSAL_NOT_FOUND: 'ההצעה כבר אינה זמינה. יש לבנות תוכנית מחדש.',
  PROPOSAL_EXPIRED: 'ההצעה פגה. יש לבנות תוכנית מחדש.',
  PROPOSAL_SUPERSEDED: 'נבנתה הצעה חדשה יותר. יש לבנות מחדש ולבחור שוב.',
  SESSION_MISMATCH: 'ההצעה כבר אינה זמינה. יש לבנות תוכנית מחדש.',
  CANDIDATE_NOT_IN_PROPOSAL: 'החלופה שנבחרה אינה חלק מההצעה הזו.',
  CANDIDATE_NOT_APPLYABLE: 'לא ניתן להחיל את החלופה הזו.',
  PROFILE_VERSION_MISMATCH: 'ההעדפות שלך השתנו מאז הבנייה — יש לבנות מחדש לפני החלה.',
  ACADEMIC_STATUS_MISMATCH: 'סטטוס הקורסים שהשלמת השתנה מאז הבנייה — יש לבנות מחדש לפני החלה.',
  BOARD_VERSION_CONFLICT: 'התוכנית הנוכחית התעדכנה בינתיים. יש לרענן ולנסות שוב.',
  IDEMPOTENCY_CONFLICT: 'הבקשה חוזרת על מזהה קיים עם תוכן אחר.',
};

/** HTTP status per code — 409 for "the world moved", 403/404 for access. */
const STATUS: Record<ApplyRejectionCode, number> = {
  INVALID_REQUEST: 400,
  PROPOSAL_NOT_FOUND: 404,
  SESSION_MISMATCH: 404, // same shape as not-found: never confirm someone else's record exists
  PROPOSAL_EXPIRED: 409,
  PROPOSAL_SUPERSEDED: 409,
  CANDIDATE_NOT_IN_PROPOSAL: 409,
  CANDIDATE_NOT_APPLYABLE: 409,
  PROFILE_VERSION_MISMATCH: 409,
  ACADEMIC_STATUS_MISMATCH: 409,
  BOARD_VERSION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
};

/**
 * The MINIMUM the client may send. Note what is absent: any plan, any course
 * id, any semester. `.strict()` so an attempt to smuggle one in is a typed
 * rejection rather than an ignored field — a silently ignored `semesters` key
 * would let a caller believe they had influenced the commit.
 */
export const applyPlanRequestSchema = z
  .object({
    program_id: z.string().min(1),
    proposal_id: z.string().min(1),
    candidate_id: z.string().min(1),
    /** The version the client believes it is replacing. null ⇒ no board yet. */
    expected_board_version: z.string().min(1).nullable(),
    expected_profile_version: z.number().int().nonnegative(),
    idempotency_key: z.string().min(8).max(200),
    /** Echoed back for staleness comparison; never used to build the plan. */
    academic_status: z.unknown().optional(),
  })
  .strict();

export type ApplyPlanRequest = z.infer<typeof applyPlanRequestSchema>;

export interface ApplyPlanSuccess {
  ok: true;
  /** True when this request replayed an earlier identical one. */
  replayed: boolean;
  board: {
    programId: string;
    version: string;
    semesters: Array<{ semesterId: string; courseIds: string[] }>;
  };
  appliedCandidateId: string;
  appliedProposalId: string;
}

export interface ApplyPlanFailure {
  ok: false;
  code: ApplyRejectionCode;
  message_he: string;
  /** Present only for a version conflict, so the client can resync honestly. */
  currentBoardVersion?: string | null;
}

const boardView = (board: CommittedBoard) => ({
  programId: board.programId,
  version: board.version,
  semesters: board.semesters.map((s) => ({ semesterId: s.semesterId, courseIds: [...s.courseIds] })),
});

function reject(res: VercelResponse, code: ApplyRejectionCode, extra: Partial<ApplyPlanFailure> = {}): void {
  const body: ApplyPlanFailure = { ok: false, code, message_he: REASON_HE[code], ...extra };
  res.status(STATUS[code]).json(body);
}

/**
 * The whole validation sequence, ordered cheapest-and-most-general first so a
 * caller never learns more than the first thing that was wrong.
 */
export function validateApply(
  record: ProposalRecord | null,
  req: ApplyPlanRequest,
  ownerId: string,
  now: number,
  currentBoard: CommittedBoard | null,
): { code: ApplyRejectionCode } | { code: null; candidate: ProposalRecord['candidates'][number] } {
  // 1–4. Existence, ownership, supersession, expiry.
  const access = checkProposalAccess(record, ownerId, now);
  if (access) return { code: access };
  const proposal = record!;

  // The proposal must belong to the program the caller says it does.
  if (proposal.programId !== req.program_id) return { code: 'PROPOSAL_NOT_FOUND' };

  // 5. Candidate membership — a fabricated id, or one from another proposal,
  //    simply is not in here.
  const candidate = proposal.candidates.find((c) => c.candidateId === req.candidate_id);
  if (!candidate) return { code: 'CANDIDATE_NOT_IN_PROPOSAL' };

  // 6. Applyability, as the server recorded it at validation time.
  if (!candidate.valid || !candidate.applyable) return { code: 'CANDIDATE_NOT_APPLYABLE' };

  // 7. The preferences the plan was built from must still be the current ones.
  if (proposal.profileVersion !== req.expected_profile_version) {
    return { code: 'PROFILE_VERSION_MISMATCH' };
  }

  // 8. The academic status it assumed must still hold — completed and
  //    currently-taking courses change what is legal.
  if (req.academic_status !== undefined) {
    if (academicStatusDigest(req.academic_status) !== proposal.academicStatusDigest) {
      return { code: 'ACADEMIC_STATUS_MISMATCH' };
    }
  }

  // 9. The board the plan was computed on top of must still be the committed
  //    one. This catches a second tab that already applied something.
  const committedVersion = currentBoard?.version ?? null;
  if (proposal.baseBoardVersion !== committedVersion) {
    return { code: 'BOARD_VERSION_CONFLICT' };
  }
  // …and the client must agree about what it is replacing. Disagreeing means
  // the client is working from a view of the world the server has moved past.
  if ((req.expected_board_version ?? null) !== committedVersion) {
    return { code: 'BOARD_VERSION_CONFLICT' };
  }

  return { code: null, candidate };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    await handle(req, res);
  } catch (err) {
    // Never surface an internal message: a stack trace is not something a
    // student can act on, and it is not something a stranger should see.
    console.error('[ai/apply-plan] unexpected error:', err instanceof Error ? err.message : String(err));
    if (!res.headersSent) {
      res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message_he: 'אירעה שגיאה פנימית.' });
    }
  }
}

async function handle(req: VercelRequest, res: VercelResponse): Promise<void> {
  // The session is resolved for every method: a GET is how a fresh page learns
  // whether this browser already owns a committed board.
  const owner = resolveOwner(req as unknown as { headers?: Record<string, string | string[] | undefined> }, res);
  const repo = getBoardRepository();

  if (req.method === 'GET') {
    const programId = String(
      (Array.isArray(req.query?.program_id) ? req.query.program_id[0] : req.query?.program_id) ?? '',
    ).trim();
    if (!programId) { reject(res, 'INVALID_REQUEST'); return; }
    const board = await repo.load(owner.ownerId, programId);
    res.status(200).json({
      ok: true,
      board: board ? boardView(board) : null,
      // Truthful disclosure of what this deployment can actually promise.
      storage: storageKind(),
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', message_he: 'שיטה לא נתמכת.' });
    return;
  }

  const parsed = applyPlanRequestSchema.safeParse(req.body);
  if (!parsed.success) { reject(res, 'INVALID_REQUEST'); return; }
  const request = parsed.data;

  const record = await getProposalStore().get(request.proposal_id);
  const currentBoard = await repo.load(owner.ownerId, request.program_id);
  const verdict = validateApply(record, request, owner.ownerId, Date.now(), currentBoard);

  if (verdict.code !== null) {
    // An idempotent REPLAY legitimately carries the pre-apply board version, so
    // a version conflict is not the final word: hand it to the repository,
    // which is the only component that knows whether this exact request already
    // succeeded.
    if (verdict.code === 'BOARD_VERSION_CONFLICT' && record) {
      const replay = await replayIfKnown(request, owner.ownerId, record, currentBoard);
      if (replay) { res.status(200).json(replay); return; }
    }
    reject(res, verdict.code, {
      ...(verdict.code === 'BOARD_VERSION_CONFLICT'
        ? { currentBoardVersion: currentBoard?.version ?? null }
        : {}),
    });
    return;
  }

  const commit = await repo.commit({
    ownerId: owner.ownerId,
    programId: request.program_id,
    expectedVersion: request.expected_board_version ?? null,
    // THE authoritative content: the server's stored plan, never the request's.
    semesters: verdict.candidate.semesters,
    proposalId: record!.proposalId,
    candidateId: verdict.candidate.candidateId,
    idempotencyKey: request.idempotency_key,
  });

  if (!commit.ok) {
    reject(res, commit.reason, {
      ...(commit.reason === 'BOARD_VERSION_CONFLICT'
        ? { currentBoardVersion: commit.board?.version ?? null }
        : {}),
    });
    return;
  }

  const success: ApplyPlanSuccess = {
    ok: true,
    replayed: commit.replayed,
    board: boardView(commit.board),
    appliedCandidateId: verdict.candidate.candidateId,
    appliedProposalId: record!.proposalId,
  };
  res.status(200).json(success);
}

/**
 * A retry of an already-successful apply.
 *
 * The client cannot know the new version yet — that is the entire reason
 * idempotency exists — so its expected version is legitimately stale. The
 * repository owns the decision: it replays only when the same key carried the
 * same proposal and candidate, and reports IDEMPOTENCY_CONFLICT otherwise.
 */
async function replayIfKnown(
  request: ApplyPlanRequest,
  ownerId: string,
  record: ProposalRecord,
  currentBoard: CommittedBoard | null,
): Promise<ApplyPlanSuccess | null> {
  const candidate = record.candidates.find((c) => c.candidateId === request.candidate_id);
  if (!candidate || !currentBoard) return null;

  const commit = await getBoardRepository().commit({
    ownerId,
    programId: request.program_id,
    expectedVersion: request.expected_board_version ?? null,
    semesters: candidate.semesters,
    proposalId: record.proposalId,
    candidateId: candidate.candidateId,
    idempotencyKey: request.idempotency_key,
  });
  if (!commit.ok || !commit.replayed) return null;
  return {
    ok: true,
    replayed: true,
    board: boardView(commit.board),
    appliedCandidateId: candidate.candidateId,
    appliedProposalId: record.proposalId,
  };
}
