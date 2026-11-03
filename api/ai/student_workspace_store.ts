import postgres from 'postgres';
import { PG_OPTS } from './_quota';
import { isolatedUrl } from '../db_env';
import { ownerStorageKey } from './owner_key';
import type { BiddingObservation, ObservationInput } from './student_bidding_history';

export interface WorkspaceDocument { revision: number; data: unknown }
export type WorkspaceSaveResult = ({ ok: true } & WorkspaceDocument) | { ok: false; revision: number };
export interface StudentWorkspaceStore {
  load(ownerId: string, scope: string): Promise<WorkspaceDocument | null>;
  save(ownerId: string, scope: string, expectedRevision: number, data: unknown): Promise<WorkspaceSaveResult>;
  adopt(fromOwner: string, toOwner: string): Promise<void>;
  replaceObservations(ownerId: string, programId: string, year: number, semester: 1 | 2, round: number, rows: ObservationInput[]): Promise<void>;
  withdrawObservations(ownerId: string, programId: string): Promise<void>;
  observations(programId: string, beforeYear: number, semester: 1 | 2, round: number): Promise<BiddingObservation[]>;
}

export class MemoryStudentWorkspaceStore implements StudentWorkspaceStore {
  private documents = new Map<string, WorkspaceDocument>();
  private reports = new Map<string, BiddingObservation[]>();
  private key(owner: string, scope: string) { return JSON.stringify([owner, scope]); }
  async load(owner: string, scope: string) { return structuredClone(this.documents.get(this.key(owner, scope)) ?? null); }
  async save(owner: string, scope: string, expected: number, data: unknown): Promise<WorkspaceSaveResult> {
    const key = this.key(owner, scope);
    const revision = this.documents.get(key)?.revision ?? 0;
    if (revision !== expected) return { ok: false, revision };
    const document = { revision: revision + 1, data: structuredClone(data) };
    this.documents.set(key, document);
    return { ok: true, ...structuredClone(document) };
  }
  async adopt(from: string, to: string) {
    for (const [key, record] of this.documents) {
      const [owner, scope] = JSON.parse(key) as string[];
      if (owner !== from) continue;
      if (!this.documents.has(this.key(to, scope))) this.documents.set(this.key(to, scope), structuredClone(record));
      this.documents.delete(key);
    }
  }
  async replaceObservations(owner: string, programId: string, academicYear: number, semester: 1 | 2, round: number, rows: ObservationInput[]) {
    const key = JSON.stringify([owner, programId, academicYear, semester, round]);
    this.reports.set(key, rows.map((row) => ({ ...row, owner, programId, academicYear, semester, round })));
  }
  async observations(programId: string, beforeYear: number, semester: 1 | 2, round: number) {
    return structuredClone([...this.reports.values()].flat().filter((r) => r.programId === programId && r.academicYear < beforeYear && r.semester === semester && r.round === round));
  }
  async withdrawObservations(owner: string, programId: string) {
    for (const [key, rows] of this.reports) {
      const [reportOwner, reportProgram] = JSON.parse(key) as string[];
      if (reportOwner === owner && reportProgram === programId) this.reports.delete(key);
    }
  }
}

type Row = Record<string, unknown>;
interface SqlBoundary { unsafe(query: string, parameters?: readonly unknown[]): Promise<Row[]> }
export interface WorkspaceSql extends SqlBoundary { begin<T>(fn: (tx: SqlBoundary) => Promise<T>): Promise<T> }
const userId = (owner: string) => /^auth:([0-9a-f-]{36})$/i.exec(owner)?.[1] ?? null;
const document = (row: Row): WorkspaceDocument => ({ revision: Number(row.revision), data: row.payload_json });

export class PostgresStudentWorkspaceStore implements StudentWorkspaceStore {
  constructor(private sql: WorkspaceSql) {}
  async load(owner: string, scope: string) {
    const rows = await this.sql.unsafe('SELECT revision, payload_json FROM student_workspace_documents WHERE owner_hash=$1 AND scope_key=$2', [ownerStorageKey(owner), scope]);
    return rows.length ? document(rows[0]) : null;
  }
  async save(owner: string, scope: string, expected: number, data: unknown): Promise<WorkspaceSaveResult> {
    const hash = ownerStorageKey(owner);
    const rows = expected === 0
      ? await this.sql.unsafe(`INSERT INTO student_workspace_documents(owner_hash,scope_key,user_id,revision,payload_json)
          VALUES($1,$2,$3,1,$4::text::jsonb) ON CONFLICT(owner_hash,scope_key) DO NOTHING RETURNING revision,payload_json`, [hash, scope, userId(owner), JSON.stringify(data)])
      : await this.sql.unsafe(`UPDATE student_workspace_documents SET payload_json=$3::text::jsonb,revision=revision+1,updated_at=now()
          WHERE owner_hash=$1 AND scope_key=$2 AND revision=$4 RETURNING revision,payload_json`, [hash, scope, JSON.stringify(data), expected]);
    if (!rows.length) return { ok: false, revision: (await this.load(owner, scope))?.revision ?? 0 };
    return { ok: true, ...document(rows[0]) };
  }
  async adopt(from: string, to: string) {
    await this.sql.unsafe(`WITH moved AS (
      DELETE FROM student_workspace_documents WHERE owner_hash=$1
      RETURNING scope_key,revision,payload_json,updated_at
    ) INSERT INTO student_workspace_documents(owner_hash,scope_key,user_id,revision,payload_json,updated_at)
      SELECT $2,scope_key,$3,revision,payload_json,updated_at FROM moved
      ON CONFLICT(owner_hash,scope_key) DO NOTHING`, [ownerStorageKey(from), ownerStorageKey(to), userId(to)]);
  }
  async replaceObservations(owner: string, programId: string, year: number, semester: 1 | 2, round: number, rows: ObservationInput[]) {
    await this.sql.begin(async (tx) => {
      // Serialize reports from one account, including withdrawal vs resubmission.
      await tx.unsafe('SELECT id FROM auth.users WHERE id=$1 FOR UPDATE', [userId(owner)]);
      await tx.unsafe('DELETE FROM student_bidding_observations WHERE owner_hash=$1 AND program_id=$2 AND academic_year=$3 AND semester=$4 AND round=$5', [ownerStorageKey(owner), programId, year, semester, round]);
      for (const row of rows) {
        await tx.unsafe(`INSERT INTO student_bidding_observations(owner_hash,user_id,program_id,academic_year,semester,round,kind,course_id,group_key,points,outcome,rejection_reason,initial_points,bundle_signature)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [ownerStorageKey(owner), userId(owner), programId, year, semester, round, row.kind, row.courseId ?? '', row.group, row.points, row.outcome, row.rejectionReason, row.initialPoints ?? row.points ?? 0, row.bundleSignature ?? '']);
      }
    });
  }
  async observations(programId: string, beforeYear: number, semester: 1 | 2, round: number): Promise<BiddingObservation[]> {
    const rows = await this.sql.unsafe(`SELECT owner_hash,program_id,academic_year,semester,round,kind,course_id,group_key,points,outcome,rejection_reason,initial_points,bundle_signature
      FROM student_bidding_observations WHERE program_id=$1 AND academic_year<$2 AND semester=$3 AND round=$4 ORDER BY academic_year DESC LIMIT 50000`, [programId, beforeYear, semester, round]);
    return rows.map((r) => ({ owner: String(r.owner_hash), programId: String(r.program_id), academicYear: Number(r.academic_year), semester: Number(r.semester) as 1 | 2, round: Number(r.round), kind: r.kind as 'course' | 'bundle', ...(r.course_id ? { courseId: String(r.course_id) } : {}), group: String(r.group_key), points: r.points == null ? null : Number(r.points), initialPoints: Number(r.initial_points), ...(r.bundle_signature ? { bundleSignature: String(r.bundle_signature) } : {}), outcome: String(r.outcome), rejectionReason: String(r.rejection_reason) }));
  }
  async withdrawObservations(owner: string, programId: string) {
    await this.sql.begin(async (tx) => {
      await tx.unsafe('SELECT id FROM auth.users WHERE id=$1 FOR UPDATE', [userId(owner)]);
      await tx.unsafe('DELETE FROM student_bidding_observations WHERE owner_hash=$1 AND program_id=$2', [ownerStorageKey(owner), programId]);
    });
  }
}

let selected: { url: string; store: StudentWorkspaceStore } | undefined;
let injected: StudentWorkspaceStore | undefined;
export function installStudentWorkspaceStoreForTests(store?: StudentWorkspaceStore) { injected = store; selected = undefined; }
export function getStudentWorkspaceStore(): StudentWorkspaceStore {
  if (injected) return injected;
  const raw = process.env.SYLLO_PLANNER_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  const url = isolatedUrl(raw, 'student workspace database');
  if (raw && !url) throw new Error('WORKSPACE_UNAVAILABLE');
  if (selected?.url === url) return selected.store;
  if (!url && (process.env.VERCEL === '1' || process.env.NODE_ENV === 'production')) throw new Error('WORKSPACE_UNAVAILABLE');
  const store = url ? new PostgresStudentWorkspaceStore(postgres(url, { ...PG_OPTS, max: 3 }) as unknown as WorkspaceSql) : new MemoryStudentWorkspaceStore();
  selected = { url, store };
  return store;
}
