/**
 * apply_runtime.ts — which storage adapters this process actually uses, and the
 * small digests the Apply contract compares.
 *
 * Selection is explicit and honest:
 *   SYLLO_BOARD_STATE_DIR set  → file adapters (local Preview only);
 *   otherwise                  → in-memory adapters.
 *
 * **Neither is a Production adapter.** In-memory survives nothing across
 * serverless invocations, and a Vercel function's filesystem is per-instance and
 * ephemeral, so the file adapter is not durable there either. The production
 * adapter is a REMAINING decision, recorded in AUTONOMOUS_PROGRESS.md — this
 * module deliberately has no branch that silently picks a vendor.
 *
 * `productionStorageConfigured()` exists so the truth is queryable rather than
 * assumed by a reader.
 */
import { createHash } from 'crypto';
import {
  InMemoryBoardRepository,
  type BoardRepository,
} from './board_repository';
import { FileBoardRepository } from './board_repository_file';
import { InMemoryProposalStore, type ProposalStore } from './proposal_store';
import { InMemoryAcademicContextStore, type AcademicContextStore } from './academic_context_store';

/** The env var that switches on the local Preview file adapter. */
export const BOARD_STATE_DIR_ENV = 'SYLLO_BOARD_STATE_DIR';
export const PLANNER_DATABASE_URL_ENV = 'SYLLO_PLANNER_DATABASE_URL';

export type StorageKind = 'memory' | 'file' | 'postgres';

export type PlannerStorageErrorCode =
  | 'PLANNER_STORAGE_UNAVAILABLE'
  | 'PLANNER_SCHEMA_MISMATCH';

export class PlannerStorageError extends Error {
  constructor(readonly code: PlannerStorageErrorCode) {
    super(code);
    this.name = 'PlannerStorageError';
  }
}

let boardRepo: BoardRepository | undefined;
let proposalStore: ProposalStore | undefined;
let academicContextStore: AcademicContextStore | undefined;
let activeKind: StorageKind | undefined;

export function plannerDatabaseConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean((env[PLANNER_DATABASE_URL_ENV] ?? '').trim());
}

export function storageKindFor(env: NodeJS.ProcessEnv): StorageKind {
  if (plannerDatabaseConfigured(env)) return 'postgres';
  if ((env[BOARD_STATE_DIR_ENV] ?? '').trim()) return 'file';
  if (env.VERCEL === '1') throw new PlannerStorageError('PLANNER_STORAGE_UNAVAILABLE');
  return 'memory';
}

function selectedKind(): StorageKind {
  return storageKindFor(process.env);
}

/** Which adapter this process is running on — for truthful diagnostics. */
export function storageKind(): StorageKind {
  return activeKind ?? selectedKind();
}

/**
 * Is a genuinely durable, production-compatible adapter configured?
 *
 * Always false today, and deliberately so: saying otherwise would be a
 * durability claim nothing in this repository supports.
 */
export function productionStorageConfigured(): boolean {
  return false;
}

export function getBoardRepository(): BoardRepository {
  const kind = selectedKind();
  if (!boardRepo || activeKind !== kind) {
    if (kind === 'postgres') {
      throw new PlannerStorageError('PLANNER_STORAGE_UNAVAILABLE');
    }
    activeKind = kind;
    boardRepo = kind === 'file'
      ? new FileBoardRepository({ dir: process.env[BOARD_STATE_DIR_ENV]!.trim() })
      : new InMemoryBoardRepository();
    // A proposal is meaningless without the board it was planned against, so
    // the two are rebuilt together and never straddle a switch.
    proposalStore = new InMemoryProposalStore();
    academicContextStore = new InMemoryAcademicContextStore();
  }
  return boardRepo;
}

/**
 * Proposals are in-memory even in Preview: they are short-lived (2h TTL) and
 * rebuilt by the next Generate, so an API restart losing them costs one Rebuild
 * — whereas losing a committed board would look like data loss.
 */
export function getProposalStore(): ProposalStore {
  if (!proposalStore) getBoardRepository();
  return proposalStore!;
}

export function getAcademicContextStore(): AcademicContextStore {
  if (!academicContextStore) getBoardRepository();
  return academicContextStore!;
}

/** Test-only: drop both stores so suites cannot leak state into each other. */
export function resetApplyRuntime(): void {
  boardRepo = undefined;
  proposalStore = undefined;
  academicContextStore = undefined;
  activeKind = undefined;
}

// ── digests the Apply contract compares ─────────────────────────────────────

const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);

/**
 * A stable digest of the ACADEMIC STATUS a plan assumed.
 *
 * Completed courses and currently-taking courses change what is legal, so a
 * plan built before the student edited them must not be committed afterwards.
 * The knowledge marker is included because "confirmed none" and "not yet asked"
 * are genuinely different states that legitimately produce different plans.
 */
export function academicStatusDigest(personalStatus: unknown): string {
  const s = (personalStatus ?? {}) as {
    completed?: Array<{ course_id?: string }>;
    currently_taking?: Array<{ course_id?: string }>;
    completed_knowledge?: { status?: string; provenance?: string };
  };
  const norm = {
    completed: [...new Set((s.completed ?? []).map((c) => String(c?.course_id ?? '')))].sort(),
    currentlyTaking: [...new Set((s.currently_taking ?? []).map((c) => String(c?.course_id ?? '')))].sort(),
    knowledge: s.completed_knowledge?.status ?? 'unknown',
  };
  return `as_${sha(JSON.stringify(norm))}`;
}
