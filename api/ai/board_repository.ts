/**
 * board_repository.ts — the ONE authoritative boundary for a session's
 * committed board, and the only place a board version is minted.
 *
 * A committed board is USER state: the plan this owner has actually accepted.
 * It is deliberately a different thing from the program CATALOG that
 * `api/board.ts` serves — the catalog is identical for every visitor and is
 * never written here. A session with no committed board yet simply has none,
 * and the journey shows the catalog until the first Apply.
 *
 * ── Version semantics (one documented rule) ──────────────────────────────────
 * A version is `bv_<n>` with `n` a monotonically increasing integer per
 * (owner, program), minted by the repository and by nothing else. The client
 * cannot choose it, cannot skip it, and can only ever echo one back as the
 * version it EXPECTS to be replacing. `null` means "no board committed yet",
 * which is a legitimate expected value for a first Apply.
 *
 * ── Concurrency ─────────────────────────────────────────────────────────────
 * `commit` is compare-and-swap: it applies only if the stored version equals
 * the caller's expected version. Two Applies racing from the same base version
 * therefore cannot both succeed — the loser gets BOARD_VERSION_CONFLICT and the
 * committed state stays exactly one of the two candidates, never a merge.
 *
 * ── Idempotency ─────────────────────────────────────────────────────────────
 * A retry legitimately carries the version the caller last saw, which the first
 * attempt has already superseded — so a naive CAS would reject every retry.
 * The idempotency record is checked FIRST: the same key replaying the same
 * (proposal, candidate) returns the original result with no second mutation,
 * while the same key carrying different work is a deterministic conflict rather
 * than a silent overwrite.
 */

export interface BoardSemesterState {
  semesterId: string;
  courseIds: string[];
}

/** What was committed, and the receipt that makes a retry safe. */
export interface AppliedReceipt {
  proposalId: string;
  candidateId: string;
  idempotencyKey: string;
  /** The version this apply PRODUCED. */
  version: string;
  appliedAt: number;
}

export interface CommittedBoard {
  ownerId: string;
  programId: string;
  /** Opaque to every caller. Minted here; see the version rule above. */
  version: string;
  semesters: BoardSemesterState[];
  updatedAt: number;
  /** The apply that produced the CURRENT version, if any. */
  lastApply?: AppliedReceipt;
}

export type CommitFailureReason = 'BOARD_VERSION_CONFLICT' | 'IDEMPOTENCY_CONFLICT';

export type CommitResult =
  | { ok: true; board: CommittedBoard; replayed: boolean }
  | { ok: false; reason: CommitFailureReason; board: CommittedBoard | null };

export interface CommitInput {
  ownerId: string;
  programId: string;
  /** The version the caller believes it is replacing. `null` ⇒ expects no board yet. */
  expectedVersion: string | null;
  semesters: BoardSemesterState[];
  proposalId: string;
  candidateId: string;
  idempotencyKey: string;
}

export interface BoardRepository {
  /** The owner's committed board, or null when they have never applied one. */
  load(ownerId: string, programId: string): Promise<CommittedBoard | null>;
  /** Compare-and-swap commit. See the concurrency and idempotency notes above. */
  commit(input: CommitInput): Promise<CommitResult>;
}

// ── shared, adapter-independent logic ───────────────────────────────────────

export const FIRST_VERSION_NUMBER = 1;

const versionOf = (n: number) => `bv_${n}`;

/** Parse a repository-minted version. Anything else is not a version we issued. */
export function parseVersion(version: string | null): number | null {
  if (version === null) return null;
  const m = /^bv_(\d+)$/.exec(version);
  return m ? Number(m[1]) : null;
}

/** Normalized, order-stable board content — so equal plans store identically. */
function normalizeSemesters(semesters: readonly BoardSemesterState[]): BoardSemesterState[] {
  return semesters
    .map((s) => ({ semesterId: s.semesterId, courseIds: [...new Set(s.courseIds)].sort() }))
    .sort((a, b) => (a.semesterId < b.semesterId ? -1 : a.semesterId > b.semesterId ? 1 : 0));
}

/**
 * The whole decision procedure, as a pure function of the current state.
 *
 * Adapters differ only in how they read and durably write; they must not
 * re-implement any of this, so every adapter has identical semantics.
 */
export function decideCommit(
  current: CommittedBoard | null,
  input: CommitInput,
  now: number,
  history: readonly AppliedReceipt[],
): CommitResult & { nextState?: CommittedBoard; receipt?: AppliedReceipt } {
  // 1. Idempotency FIRST — a legitimate retry still carries the pre-apply
  //    version, which CAS would otherwise reject.
  const prior = history.find((h) => h.idempotencyKey === input.idempotencyKey);
  if (prior) {
    if (prior.proposalId !== input.proposalId || prior.candidateId !== input.candidateId) {
      // The same key must not be reusable for different work — that would make
      // "retry" a way to smuggle a second, different mutation through.
      return { ok: false, reason: 'IDEMPOTENCY_CONFLICT', board: current };
    }
    // Replay: return what the first attempt produced, mutating nothing.
    return { ok: true, board: current!, replayed: true };
  }

  // 2. Compare-and-swap on the version the caller expected to replace.
  const currentVersion = current ? current.version : null;
  if ((input.expectedVersion ?? null) !== currentVersion) {
    return { ok: false, reason: 'BOARD_VERSION_CONFLICT', board: current };
  }

  const nextNumber = (parseVersion(currentVersion) ?? FIRST_VERSION_NUMBER - 1) + 1;
  const receipt: AppliedReceipt = {
    proposalId: input.proposalId,
    candidateId: input.candidateId,
    idempotencyKey: input.idempotencyKey,
    version: versionOf(nextNumber),
    appliedAt: now,
  };
  const nextState: CommittedBoard = {
    ownerId: input.ownerId,
    programId: input.programId,
    version: receipt.version,
    semesters: normalizeSemesters(input.semesters),
    updatedAt: now,
    lastApply: receipt,
  };
  return { ok: true, board: nextState, replayed: false, nextState, receipt };
}

/** How many apply receipts to retain per board for replay detection. */
export const APPLY_HISTORY_LIMIT = 50;

const clone = <T>(v: T): T => structuredClone(v);

/** One owner+program's durable record, as every adapter stores it. */
export interface BoardRecord {
  board: CommittedBoard;
  history: AppliedReceipt[];
}

export const boardKey = (ownerId: string, programId: string) => `${ownerId}::${programId}`;

/**
 * Apply `decideCommit` to a record and produce the record to persist.
 * Shared by every adapter so semantics cannot drift between them.
 */
export function nextRecord(
  existing: BoardRecord | undefined,
  input: CommitInput,
  now: number,
): { result: CommitResult; record: BoardRecord | undefined } {
  const decision = decideCommit(existing?.board ?? null, input, now, existing?.history ?? []);
  if (!decision.ok || !decision.nextState || !decision.receipt) {
    // Replay returns the stored board untouched; a failure changes nothing.
    return { result: { ...decision } as CommitResult, record: existing };
  }
  const history = [...(existing?.history ?? []), decision.receipt].slice(-APPLY_HISTORY_LIMIT);
  return {
    result: { ok: true, board: decision.nextState, replayed: false },
    record: { board: decision.nextState, history },
  };
}

// ── in-memory adapter (deterministic tests) ─────────────────────────────────

export interface InMemoryBoardRepositoryOptions {
  clock?: () => number;
}

/**
 * For unit/API tests. Node runs one turn of the event loop at a time and no
 * method here awaits between read and write, so a read-modify-write cannot
 * interleave — which is what makes the CAS test meaningful rather than lucky.
 *
 * NOT durable, and deliberately not presented as such: a serverless deployment
 * gives each invocation its own module instance, so this survives nothing.
 */
export class InMemoryBoardRepository implements BoardRepository {
  private records = new Map<string, BoardRecord>();
  private readonly clock: () => number;

  constructor(options: InMemoryBoardRepositoryOptions = {}) {
    this.clock = options.clock ?? Date.now;
  }

  async load(ownerId: string, programId: string): Promise<CommittedBoard | null> {
    const rec = this.records.get(boardKey(ownerId, programId));
    return rec ? clone(rec.board) : null;
  }

  async commit(input: CommitInput): Promise<CommitResult> {
    const key = boardKey(input.ownerId, input.programId);
    const { result, record } = nextRecord(this.records.get(key), input, this.clock());
    if (record) this.records.set(key, record);
    return clone(result);
  }

  /** Test-only. Deliberately absent from the BoardRepository interface. */
  reset(): void {
    this.records.clear();
  }
}
