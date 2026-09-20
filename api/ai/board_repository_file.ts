/**
 * board_repository_file.ts — the LOCAL PREVIEW adapter.
 *
 * Scope, stated plainly: this exists so a local Preview can prove that a
 * committed board survives a browser refresh AND an API process restart. It is
 * **not** a Production adapter and must never be described as one — a Vercel
 * deployment gives each invocation its own ephemeral filesystem, so a file
 * written by one request may simply not exist for the next.
 *
 * Safety rules it follows, because it writes real user data:
 *   - only under an ignored runtime directory, never `data/` and never a
 *     tracked file;
 *   - the filename is a HASH of the owner id, never the id itself — the owner
 *     id is a capability, and putting it in a directory listing would leak it;
 *   - writes are atomic (temp file + rename), so a crash mid-write cannot leave
 *     a half-written board that later parses as a real one;
 *   - a corrupt file is quarantined rather than silently deleted or trusted;
 *   - reads and writes for one owner are serialized through an in-process
 *     queue, so the compare-and-swap in `nextRecord` cannot interleave with
 *     itself across concurrent requests in the same process.
 */
import { createHash, randomBytes } from 'crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  boardKey,
  nextRecord,
  type BoardRecord,
  type BoardRepository,
  type CommitInput,
  type CommitResult,
  type CommittedBoard,
} from './board_repository';

/** Ignored runtime path. Overridable so tests never touch the developer's own. */
export const DEFAULT_RUNTIME_DIR = join(process.cwd(), '.runtime', 'board-state');

export interface FileBoardRepositoryOptions {
  dir?: string;
  clock?: () => number;
}

const clone = <T>(v: T): T => structuredClone(v);

export class FileBoardRepository implements BoardRepository {
  private readonly dir: string;
  private readonly clock: () => number;
  /** Per-key promise chain: serializes read-modify-write within this process. */
  private queues = new Map<string, Promise<unknown>>();

  constructor(options: FileBoardRepositoryOptions = {}) {
    this.dir = options.dir ?? DEFAULT_RUNTIME_DIR;
    this.clock = options.clock ?? Date.now;
  }

  /**
   * Hash, never the raw owner id. Also makes the name filesystem-safe by
   * construction, so a hostile owner id cannot escape the directory.
   */
  private fileFor(ownerId: string, programId: string): string {
    const digest = createHash('sha256').update(boardKey(ownerId, programId), 'utf8').digest('hex');
    return join(this.dir, `${digest}.json`);
  }

  private read(file: string): BoardRecord | undefined {
    if (!existsSync(file)) return undefined;
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw) as BoardRecord;
      // A file that parses but is not shaped like a record is as untrustworthy
      // as one that does not parse at all.
      if (!parsed?.board?.version || !Array.isArray(parsed.history)) throw new Error('shape');
      return parsed;
    } catch {
      // Quarantine rather than delete or trust: the data may be recoverable by
      // a human, and silently treating it as "no board" would look like data
      // loss with no trace of why.
      try { renameSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* best effort */ }
      return undefined;
    }
  }

  private write(file: string, record: BoardRecord): void {
    mkdirSync(this.dir, { recursive: true });
    const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8');
    renameSync(tmp, file); // atomic replace on both POSIX and Windows
  }

  /** Serialize all work for one key, so a CAS is never read-then-stale-write. */
  private enqueue<T>(key: string, work: () => T): Promise<T> {
    const prior = this.queues.get(key) ?? Promise.resolve();
    const next = prior.then(work, work);
    // Keep the chain alive but never let a rejection poison later work.
    this.queues.set(key, next.catch(() => undefined));
    return next;
  }

  async load(ownerId: string, programId: string): Promise<CommittedBoard | null> {
    const key = boardKey(ownerId, programId);
    return this.enqueue(key, () => {
      const rec = this.read(this.fileFor(ownerId, programId));
      return rec ? clone(rec.board) : null;
    });
  }

  async commit(input: CommitInput): Promise<CommitResult> {
    const key = boardKey(input.ownerId, input.programId);
    return this.enqueue(key, () => {
      const file = this.fileFor(input.ownerId, input.programId);
      const { result, record } = nextRecord(this.read(file), input, this.clock());
      // Only a real state change touches the disk: a replay or a rejection must
      // not rewrite the file and bump its mtime as if something happened.
      if (result.ok && !result.replayed && record) this.write(file, record);
      return clone(result);
    });
  }
}
