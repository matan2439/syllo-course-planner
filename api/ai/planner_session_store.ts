/**
 * Storage for the active planning session of one student and program. The state itself is the
 * bounded structure in shared/planner/planning-session.ts; this layer only keeps it, safely:
 *  - one row per (owner, program), addressed by the hashed owner key;
 *  - optimistic concurrency: a write names the revision it read and is refused if another turn
 *    wrote first — a second tab can never silently overwrite the first;
 *  - an expired session reads as "no session";
 *  - an unreadable or invalid stored state reads as "no session" (the student starts fresh, the
 *    committed board is untouched).
 */
import { planningSessionSchema, sessionBytes, type PlanningSessionState } from '../../shared/planner/planning-session';
import { ownerStorageKey } from './owner_key';

export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_CLEANUP_PER_WRITE = 20;

export interface StoredPlanningSession {
  state: PlanningSessionState;
  revision: number;
  baseBoardVersion: string | null;
  updatedAt: number;
  expiresAt: number;
}

export type SaveResult = { ok: true; revision: number } | { ok: false; reason: 'REVISION_CONFLICT' | 'NOT_AN_ACCOUNT' };

export interface PlannerSessionStore {
  load(ownerId: string, programId: string, now?: number): Promise<StoredPlanningSession | null>;
  /** `expectedRevision` null = create; otherwise the revision this turn read. */
  save(input: {
    ownerId: string; programId: string; state: PlanningSessionState; expectedRevision: number | null; now?: number;
  }): Promise<SaveResult>;
  delete(ownerId: string, programId: string): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The Supabase user id behind an account owner (`auth:<uuid>`); anything else has no persistent session. */
export function accountUserId(ownerId: string): string | null {
  const id = ownerId.startsWith('auth:') ? ownerId.slice(5) : '';
  return UUID.test(id) ? id : null;
}

function readable(value: unknown): PlanningSessionState | null {
  const parsed = planningSessionSchema.safeParse(typeof value === 'string' ? JSON.parse(value) : value);
  return parsed.success ? parsed.data : null;
}

export class InMemoryPlannerSessionStore implements PlannerSessionStore {
  private rows = new Map<string, { state: PlanningSessionState; revision: number; updatedAt: number; expiresAt: number }>();
  private key = (ownerId: string, programId: string) => `${ownerStorageKey(ownerId)}|${programId}`;

  async load(ownerId: string, programId: string, now = Date.now()): Promise<StoredPlanningSession | null> {
    const row = this.rows.get(this.key(ownerId, programId));
    if (!row || row.expiresAt <= now) return null;
    const state = readable(structuredClone(row.state));
    return state ? { state, revision: row.revision, baseBoardVersion: state.base_board_version, updatedAt: row.updatedAt, expiresAt: row.expiresAt } : null;
  }

  async save(input: Parameters<PlannerSessionStore['save']>[0]): Promise<SaveResult> {
    if (!accountUserId(input.ownerId)) return { ok: false, reason: 'NOT_AN_ACCOUNT' };
    const now = input.now ?? Date.now();
    const key = this.key(input.ownerId, input.programId);
    const current = this.rows.get(key);
    const live = current && current.expiresAt > now ? current : undefined;
    if ((live?.revision ?? null) !== input.expectedRevision) return { ok: false, reason: 'REVISION_CONFLICT' };
    const revision = (live?.revision ?? 0) + 1;
    this.rows.set(key, { state: structuredClone(planningSessionSchema.parse(input.state)), revision, updatedAt: now, expiresAt: now + SESSION_TTL_MS });
    return { ok: true, revision };
  }

  async delete(ownerId: string, programId: string): Promise<void> {
    this.rows.delete(this.key(ownerId, programId));
  }
}

export interface SessionSql {
  unsafe(query: string, parameters?: readonly unknown[]): Promise<Array<Record<string, unknown>>>;
}

const ms = (value: unknown) => value instanceof Date ? value.getTime() : Date.parse(String(value));

export class PostgresPlannerSessionStore implements PlannerSessionStore {
  constructor(private readonly sql: SessionSql) {}

  async load(ownerId: string, programId: string, now = Date.now()): Promise<StoredPlanningSession | null> {
    const rows = await this.sql.unsafe(
      `SELECT revision, base_board_version, state_json, updated_at, expires_at
         FROM planner_sessions
        WHERE owner_hash = $1 AND program_id = $2 AND expires_at > $3::timestamptz`,
      [ownerStorageKey(ownerId), programId, new Date(now).toISOString()],
    );
    if (!rows.length) return null;
    let state: PlanningSessionState | null = null;
    try { state = readable(rows[0].state_json); } catch { state = null; }
    if (!state) {
      console.error('[planner-session] stored state is unreadable; starting a new session');
      return null;
    }
    return { state, revision: Number(rows[0].revision), baseBoardVersion: rows[0].base_board_version == null ? null : String(rows[0].base_board_version),
      updatedAt: ms(rows[0].updated_at), expiresAt: ms(rows[0].expires_at) };
  }

  async save(input: Parameters<PlannerSessionStore['save']>[0]): Promise<SaveResult> {
    const userId = accountUserId(input.ownerId);
    if (!userId) return { ok: false, reason: 'NOT_AN_ACCOUNT' };
    const state = planningSessionSchema.parse(input.state);
    const now = new Date(input.now ?? Date.now());
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
    const owner = ownerStorageKey(input.ownerId);
    const body = JSON.stringify(state);
    const bytes = sessionBytes(state);
    // A small, bounded cleanup of expired rows rides along with every write; no scheduled job.
    await this.sql.unsafe(
      `DELETE FROM planner_sessions WHERE (owner_hash, program_id) IN (
         SELECT owner_hash, program_id FROM planner_sessions WHERE expires_at <= $1::timestamptz LIMIT ${MAX_CLEANUP_PER_WRITE})`,
      [now.toISOString()]);
    const rows = input.expectedRevision === null
      ? await this.sql.unsafe(
        `INSERT INTO planner_sessions (owner_hash, program_id, user_id, revision, base_board_version, state_json, state_bytes, created_at, updated_at, expires_at)
         VALUES ($1, $2, $3::uuid, 1, $4, $5::text::jsonb, $6, $7::timestamptz, $7::timestamptz, $8::timestamptz)
         ON CONFLICT (owner_hash, program_id) DO UPDATE SET
           user_id = EXCLUDED.user_id, revision = 1, base_board_version = EXCLUDED.base_board_version, state_json = EXCLUDED.state_json,
           state_bytes = EXCLUDED.state_bytes, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at, expires_at = EXCLUDED.expires_at
           WHERE planner_sessions.expires_at <= $7::timestamptz
         RETURNING revision`,
        [owner, input.programId, userId, state.base_board_version, body, bytes, now.toISOString(), expiresAt])
      : await this.sql.unsafe(
        `UPDATE planner_sessions SET revision = revision + 1, base_board_version = $4, state_json = $5::text::jsonb, state_bytes = $6,
                updated_at = $7::timestamptz, expires_at = $8::timestamptz
          WHERE owner_hash = $1 AND program_id = $2 AND revision = $3 AND expires_at > $7::timestamptz
          RETURNING revision`,
        [owner, input.programId, input.expectedRevision, state.base_board_version, body, bytes, now.toISOString(), expiresAt]);
    return rows.length === 1 ? { ok: true, revision: Number(rows[0].revision) } : { ok: false, reason: 'REVISION_CONFLICT' };
  }

  async delete(ownerId: string, programId: string): Promise<void> {
    await this.sql.unsafe('DELETE FROM planner_sessions WHERE owner_hash = $1 AND program_id = $2', [ownerStorageKey(ownerId), programId]);
  }
}
