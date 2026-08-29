import type {
  AcademicContextRecord,
  AcademicContextStore,
  PutAcademicContext,
} from '../academic_context_store';
import { ownerStorageKey } from '../owner_key';

type ContextRow = Record<string, unknown>;

export interface PlannerContextSql {
  unsafe(query: string, parameters?: readonly unknown[]): Promise<ContextRow[]>;
}

const clone = <T>(value: T): T => structuredClone(value);

function timestampMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const parsed = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new Error('Invalid planner academic-context timestamp');
  return parsed;
}

function fromRow(row: ContextRow, ownerId: string): AcademicContextRecord {
  return {
    ownerId,
    programId: String(row.program_id),
    digest: String(row.digest),
    personalStatus: clone(row.personal_status_json),
    planContext: clone(row.plan_context_json),
    preferences: clone(row.preferences_json),
    updatedAt: timestampMs(row.updated_at),
  };
}

export class PostgresAcademicContextStore implements AcademicContextStore {
  constructor(private readonly sql: PlannerContextSql) {}

  async load(ownerId: string, programId: string): Promise<AcademicContextRecord | null> {
    const rows = await this.sql.unsafe(
      `SELECT program_id, digest, personal_status_json, plan_context_json,
              preferences_json, updated_at
         FROM planner_academic_contexts
        WHERE owner_hash = $1 AND program_id = $2`,
      [ownerStorageKey(ownerId), programId],
    );
    return rows.length === 0 ? null : fromRow(rows[0], ownerId);
  }

  async put(input: PutAcademicContext): Promise<AcademicContextRecord> {
    const rows = await this.sql.unsafe(
      `INSERT INTO planner_academic_contexts (
         owner_hash, program_id, digest, personal_status_json,
         plan_context_json, preferences_json, updated_at
       ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, now())
       ON CONFLICT (owner_hash, program_id) DO UPDATE SET
         digest = EXCLUDED.digest,
         personal_status_json = EXCLUDED.personal_status_json,
         plan_context_json = EXCLUDED.plan_context_json,
         preferences_json = EXCLUDED.preferences_json,
         updated_at = now()
       RETURNING program_id, digest, personal_status_json, plan_context_json,
                 preferences_json, updated_at`,
      [
        ownerStorageKey(input.ownerId),
        input.programId,
        input.digest,
        JSON.stringify(input.personalStatus),
        JSON.stringify(input.planContext),
        JSON.stringify(input.preferences),
      ],
    );
    if (rows.length !== 1) throw new Error('Academic context upsert returned no record');
    return fromRow(rows[0], input.ownerId);
  }
}
