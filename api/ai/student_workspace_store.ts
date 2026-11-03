import postgres from 'postgres';
import { PG_OPTS } from './_quota';
import { isolatedUrl } from '../db_env';
import { ownerStorageKey } from './owner_key';
import type { BiddingObservation, ObservationInput } from './student_bidding_history';
import { randomUUID } from 'crypto';
import { COMMUNITY_NOTE_HIDE_AFTER_REPORTS, type CommunityCourseNote, type CourseNote, type HiddenCommunityNote } from '../../shared/planner/course-notes';

/** A note as its author publishes it (server timestamps). */
export type PublishedNoteInput = Pick<CourseNote, 'id' | 'courseId' | 'kind' | 'lecturer' | 'body'>;
export type ReportResult = 'reported' | 'own_note' | 'not_found';

export interface WorkspaceDocument { revision: number; data: unknown }
export type WorkspaceSaveResult = ({ ok: true } & WorkspaceDocument) | { ok: false; revision: number };
export interface StudentWorkspaceStore {
  load(ownerId: string, scope: string): Promise<WorkspaceDocument | null>;
  save(ownerId: string, scope: string, expectedRevision: number, data: unknown): Promise<WorkspaceSaveResult>;
  adopt(fromOwner: string, toOwner: string): Promise<void>;
  replaceObservations(ownerId: string, programId: string, year: number, semester: 1 | 2, round: number, rows: ObservationInput[]): Promise<void>;
  withdrawObservations(ownerId: string, programId: string): Promise<void>;
  observations(programId: string, beforeYear: number, semester: 1 | 2, round: number): Promise<BiddingObservation[]>;
  publishNote(ownerId: string, note: PublishedNoteInput): Promise<void>;
  withdrawNote(ownerId: string, noteId: string): Promise<void>;
  communityNotes(viewerId: string, courseId: string): Promise<CommunityCourseNote[]>;
  reportNote(viewerId: string, publicId: string): Promise<ReportResult>;
  isDeveloper(ownerId: string): Promise<boolean>;
  hiddenNotes(): Promise<HiddenCommunityNote[]>;
  moderateNote(publicId: string, decision: 'restore' | 'remove'): Promise<boolean>;
}
const MAX_LISTED_NOTES = 50;

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
  private notes = new Map<string, PublishedNoteInput & { publicId: string; owner: string; updatedAt: number; reporters: Set<string>; hiddenAt: number | null }>();
  developers = new Set<string>();
  async publishNote(owner: string, note: PublishedNoteInput) {
    const key = JSON.stringify([owner, note.id]);
    const old = this.notes.get(key);
    this.notes.set(key, { ...structuredClone(note), publicId: old?.publicId ?? randomUUID(), owner, updatedAt: Date.now(),
      reporters: old?.reporters ?? new Set(), hiddenAt: old?.hiddenAt ?? null });
  }
  async withdrawNote(owner: string, noteId: string) { this.notes.delete(JSON.stringify([owner, noteId])); }
  async communityNotes(viewer: string, courseId: string) {
    return [...this.notes.values()].filter((n) => n.courseId === courseId && n.hiddenAt === null)
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_LISTED_NOTES)
      .map((n) => ({ id: n.publicId, courseId: n.courseId, kind: n.kind, ...(n.lecturer ? { lecturer: n.lecturer } : {}), body: n.body,
        updatedAt: n.updatedAt, mine: n.owner === viewer, reported: n.reporters.has(viewer) }));
  }
  async reportNote(viewer: string, publicId: string): Promise<ReportResult> {
    const note = [...this.notes.values()].find((n) => n.publicId === publicId);
    if (!note) return 'not_found';
    if (note.owner === viewer) return 'own_note';
    note.reporters.add(viewer);
    if (note.hiddenAt === null && note.reporters.size >= COMMUNITY_NOTE_HIDE_AFTER_REPORTS) note.hiddenAt = Date.now();
    return 'reported';
  }
  async isDeveloper(owner: string) { return this.developers.has(owner); }
  async hiddenNotes() {
    return [...this.notes.values()].filter((n) => n.hiddenAt !== null)
      .map((n) => ({ id: n.publicId, courseId: n.courseId, kind: n.kind, ...(n.lecturer ? { lecturer: n.lecturer } : {}), body: n.body, reports: n.reporters.size, hiddenAt: n.hiddenAt! }));
  }
  async moderateNote(publicId: string, decision: 'restore' | 'remove') {
    for (const [key, note] of this.notes) {
      if (note.publicId !== publicId) continue;
      if (decision === 'remove') this.notes.delete(key); else { note.hiddenAt = null; note.reporters = new Set(); }
      return true;
    }
    return false;
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
  async publishNote(owner: string, note: PublishedNoteInput) {
    // An edit keeps its reports and hidden state: re-publishing never clears a moderation hold.
    await this.sql.unsafe(`INSERT INTO community_course_notes(owner_hash,user_id,note_id,course_id,kind,lecturer,body)
      VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(owner_hash,note_id) DO UPDATE SET course_id=EXCLUDED.course_id,kind=EXCLUDED.kind,lecturer=EXCLUDED.lecturer,body=EXCLUDED.body,updated_at=now()`,
    [ownerStorageKey(owner), userId(owner), note.id, note.courseId, note.kind, note.lecturer ?? null, note.body]);
  }
  async withdrawNote(owner: string, noteId: string) {
    await this.sql.unsafe('DELETE FROM community_course_notes WHERE owner_hash=$1 AND note_id=$2', [ownerStorageKey(owner), noteId]);
  }
  async communityNotes(viewer: string, courseId: string): Promise<CommunityCourseNote[]> {
    const hash = ownerStorageKey(viewer);
    const rows = await this.sql.unsafe(`SELECT n.public_id,n.course_id,n.kind,n.lecturer,n.body,n.updated_at,(n.owner_hash=$2) AS mine,
        EXISTS(SELECT 1 FROM community_course_note_reports r WHERE r.public_id=n.public_id AND r.reporter_hash=$2) AS reported
      FROM community_course_notes n WHERE n.course_id=$1 AND n.hidden_at IS NULL ORDER BY n.updated_at DESC LIMIT ${MAX_LISTED_NOTES}`, [courseId, hash]);
    return rows.map((r) => ({ id: String(r.public_id), courseId: String(r.course_id), kind: r.kind as CourseNote['kind'],
      ...(r.lecturer ? { lecturer: String(r.lecturer) } : {}), body: String(r.body), updatedAt: new Date(r.updated_at as string).getTime(),
      mine: r.mine === true, reported: r.reported === true }));
  }
  async reportNote(viewer: string, publicId: string): Promise<ReportResult> {
    const hash = ownerStorageKey(viewer);
    return this.sql.begin(async (tx) => {
      const [note] = await tx.unsafe('SELECT owner_hash FROM community_course_notes WHERE public_id=$1 FOR UPDATE', [publicId]);
      if (!note) return 'not_found';
      if (note.owner_hash === hash) return 'own_note';
      const added = await tx.unsafe('INSERT INTO community_course_note_reports(public_id,reporter_hash) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING 1', [publicId, hash]);
      if (added.length) {
        await tx.unsafe(`UPDATE community_course_notes SET report_count=report_count+1,
          hidden_at=CASE WHEN hidden_at IS NULL AND report_count+1 >= $2 THEN now() ELSE hidden_at END WHERE public_id=$1`, [publicId, COMMUNITY_NOTE_HIDE_AFTER_REPORTS]);
      }
      return 'reported';
    });
  }
  async isDeveloper(owner: string) {
    const id = userId(owner);
    if (!id) return false;
    const [row] = await this.sql.unsafe('SELECT role FROM profiles WHERE id=$1', [id]);
    return row?.role === 'developer';
  }
  async hiddenNotes(): Promise<HiddenCommunityNote[]> {
    const rows = await this.sql.unsafe('SELECT public_id,course_id,kind,lecturer,body,report_count,hidden_at FROM community_course_notes WHERE hidden_at IS NOT NULL ORDER BY hidden_at LIMIT 200');
    return rows.map((r) => ({ id: String(r.public_id), courseId: String(r.course_id), kind: r.kind as CourseNote['kind'],
      ...(r.lecturer ? { lecturer: String(r.lecturer) } : {}), body: String(r.body), reports: Number(r.report_count), hiddenAt: new Date(r.hidden_at as string).getTime() }));
  }
  async moderateNote(publicId: string, decision: 'restore' | 'remove') {
    if (decision === 'remove') return (await this.sql.unsafe('DELETE FROM community_course_notes WHERE public_id=$1 RETURNING 1', [publicId])).length > 0;
    return this.sql.begin(async (tx) => {
      await tx.unsafe('DELETE FROM community_course_note_reports WHERE public_id=$1', [publicId]);
      return (await tx.unsafe('UPDATE community_course_notes SET hidden_at=NULL,report_count=0 WHERE public_id=$1 RETURNING 1', [publicId])).length > 0;
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
