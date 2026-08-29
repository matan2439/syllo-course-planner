import {
  nextRecord,
  type BoardRepository,
  type CommittedBoard,
  type CommitInput,
  type CommitResult,
} from '../board_repository';
import { ownerStorageKey } from '../owner_key';

type BoardRow = Record<string, unknown>;

export interface PlannerBoardTransaction {
  unsafe(query: string, parameters?: readonly unknown[]): Promise<BoardRow[]>;
}

export interface PlannerBoardSql extends PlannerBoardTransaction {
  begin<T>(fn: (tx: PlannerBoardTransaction) => Promise<T>): Promise<T>;
}

function timestampMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const parsed = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new Error('Invalid planner board timestamp');
  return parsed;
}

function boardFromRow(row: BoardRow, ownerId: string): CommittedBoard {
  const board: CommittedBoard = {
    ownerId,
    programId: String(row.program_id),
    version: `bv_${Number(row.version_number)}`,
    semesters: structuredClone(row.semesters_json) as CommittedBoard['semesters'],
    updatedAt: timestampMs(row.updated_at),
  };
  if (row.last_proposal_id != null && row.last_candidate_id != null
    && row.last_idempotency_key != null && row.last_applied_at != null) {
    board.lastApply = {
      proposalId: String(row.last_proposal_id),
      candidateId: String(row.last_candidate_id),
      idempotencyKey: String(row.last_idempotency_key),
      version: board.version,
      appliedAt: timestampMs(row.last_applied_at),
    };
  }
  return board;
}

function receiptBoard(row: BoardRow, ownerId: string): CommittedBoard {
  const stored = structuredClone(row.committed_board_json) as Omit<CommittedBoard, 'ownerId'>;
  return { ownerId, ...stored };
}

function boardForReceipt(board: CommittedBoard): Omit<CommittedBoard, 'ownerId'> {
  const { ownerId: _ownerId, ...stored } = board;
  return stored;
}

export interface PostgresBoardRepositoryOptions {
  clock?: () => number;
}

export class PostgresBoardRepository implements BoardRepository {
  private readonly clock: () => number;

  constructor(
    private readonly sql: PlannerBoardSql,
    options: PostgresBoardRepositoryOptions = {},
  ) {
    this.clock = options.clock ?? Date.now;
  }

  async load(ownerId: string, programId: string): Promise<CommittedBoard | null> {
    const rows = await this.sql.unsafe(
      `SELECT program_id, version_number, semesters_json, updated_at,
              last_proposal_id, last_candidate_id, last_idempotency_key, last_applied_at
         FROM planner_boards
        WHERE owner_hash = $1 AND program_id = $2`,
      [ownerStorageKey(ownerId), programId],
    );
    return rows.length === 0 ? null : boardFromRow(rows[0], ownerId);
  }

  async commit(input: CommitInput): Promise<CommitResult> {
    return this.sql.begin(async (tx) => {
      const ownerHash = ownerStorageKey(input.ownerId);
      // A missing board row cannot be locked with FOR UPDATE. Serialize the
      // whole owner+program mutation key so two first commits cannot both win.
      await tx.unsafe(
        `SELECT pg_advisory_xact_lock(
           hashtextextended($1 || '::' || $2, 0)
         )`,
        [ownerHash, input.programId],
      );
      const priorRows = await tx.unsafe(
        `SELECT proposal_id, candidate_id, committed_board_json
           FROM planner_apply_receipts
          WHERE owner_hash = $1 AND program_id = $2 AND idempotency_key = $3`,
        [ownerHash, input.programId, input.idempotencyKey],
      );
      if (priorRows.length > 0) {
        const prior = priorRows[0];
        const board = receiptBoard(prior, input.ownerId);
        if (prior.proposal_id !== input.proposalId || prior.candidate_id !== input.candidateId) {
          return { ok: false, reason: 'IDEMPOTENCY_CONFLICT', board };
        }
        return { ok: true, board, replayed: true };
      }

      const boardRows = await tx.unsafe(
        `SELECT program_id, version_number, semesters_json, updated_at,
                last_proposal_id, last_candidate_id, last_idempotency_key, last_applied_at
           FROM planner_boards
          WHERE owner_hash = $1 AND program_id = $2
          FOR UPDATE`,
        [ownerHash, input.programId],
      );
      const current = boardRows.length === 0 ? undefined : boardFromRow(boardRows[0], input.ownerId);
      const now = this.clock();
      const { result, record } = nextRecord(
        current ? { board: current, history: [] } : undefined,
        input,
        now,
      );
      if (!result.ok || !record) return result;

      const board = record.board;
      const versionNumber = Number(board.version.slice(3));
      await tx.unsafe(
        `INSERT INTO planner_boards (
           owner_hash, program_id, version_number, semesters_json, updated_at,
           last_proposal_id, last_candidate_id, last_idempotency_key, last_applied_at
         ) VALUES ($1, $2, $3, $4::jsonb, to_timestamp($8 / 1000.0), $5, $6, $7,
                   to_timestamp($8 / 1000.0))
         ON CONFLICT (owner_hash, program_id) DO UPDATE SET
           version_number = EXCLUDED.version_number,
           semesters_json = EXCLUDED.semesters_json,
           updated_at = EXCLUDED.updated_at,
           last_proposal_id = EXCLUDED.last_proposal_id,
           last_candidate_id = EXCLUDED.last_candidate_id,
           last_idempotency_key = EXCLUDED.last_idempotency_key,
           last_applied_at = EXCLUDED.last_applied_at
         RETURNING *`,
        [
          ownerHash, input.programId, versionNumber, JSON.stringify(board.semesters),
          input.proposalId, input.candidateId, input.idempotencyKey, now,
        ],
      );
      await tx.unsafe(
        `INSERT INTO planner_apply_receipts (
           owner_hash, program_id, idempotency_key, proposal_id, candidate_id,
           produced_version_number, committed_board_json, applied_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, to_timestamp($8 / 1000.0))`,
        [
          ownerHash, input.programId, input.idempotencyKey, input.proposalId,
          input.candidateId, versionNumber, JSON.stringify(boardForReceipt(board)), now,
        ],
      );
      return result;
    });
  }
}
