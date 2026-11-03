import { readFileSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';
import { MemoryStudentWorkspaceStore, PostgresStudentWorkspaceStore } from '../../api/ai/student_workspace_store';
import { aggregateBiddingHistory } from '../../api/ai/student_bidding_history';
import { programWorkspaceSchema } from '../../shared/planner/student-workspace';

const preferences = { locale: 'he' as const };

describe('personal workspace ownership and optimistic concurrency', () => {
  test('keeps owners isolated and refuses a stale writer', async () => {
    const store = new MemoryStudentWorkspaceStore();
    expect(await store.save('alice', 'preferences', 0, preferences)).toMatchObject({ ok: true, revision: 1 });
    expect(await store.load('bob', 'preferences')).toBeNull();
    expect(await store.save('alice', 'preferences', 0, { locale: 'en' })).toMatchObject({ ok: false, revision: 1 });
    expect((await store.load('alice', 'preferences'))?.data).toEqual(preferences);
    expect(await store.save('alice', 'preferences', 1, { locale: 'en' })).toMatchObject({ ok: true, revision: 2 });
  });

  test('adopts anonymous scopes once and keeps an existing account scope', async () => {
    const store = new MemoryStudentWorkspaceStore();
    await store.save('guest', 'program:p', 0, { plans: ['guest'] });
    await store.save('guest', 'preferences', 0, { locale: 'he' });
    await store.save('auth:account', 'preferences', 0, { locale: 'en' });
    await store.adopt('guest', 'auth:account');
    expect((await store.load('auth:account', 'program:p'))?.data).toEqual({ plans: ['guest'] });
    expect((await store.load('auth:account', 'preferences'))?.data).toEqual({ locale: 'en' });
    expect(await store.load('guest', 'program:p')).toBeNull();
  });

  test('rejects duplicate ids, excessive records and malformed saved schedules', () => {
    const plan = {
      id: 'plan_12345678', name: 'A', notes: '', catalogVersion: null, createdAt: 1, updatedAt: 1,
      semesters: [{ semesterId: 'A', courseIds: ['C1'] }],
      weeklySchedule: { termMapping: {}, selections: {}, freeDays: [] },
    };
    expect(programWorkspaceSchema.safeParse({ plans: [plan, plan] }).success).toBe(false);
    expect(programWorkspaceSchema.safeParse({ plans: [{ ...plan, weeklySchedule: { selections: { C1: 'not-an-array' } } }] }).success).toBe(false);
  });
});

describe('Postgres storage and schema access', () => {
  let pg: PGlite;
  let store: PostgresStudentWorkspaceStore;
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec('CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE ROLE anon; CREATE ROLE authenticated;');
    await pg.exec(readFileSync(join(__dirname, '../../scripts/migrations/planner/002_student_workspace.sql'), 'utf8'));
    await pg.exec('CREATE TABLE profiles(id uuid PRIMARY KEY, role text)');
    await pg.exec(readFileSync(join(__dirname, '../../scripts/migrations/planner/003_community_course_notes.sql'), 'utf8'));
    const sql = {
      unsafe: async (query: string, params: readonly unknown[] = []) => (await pg.query(query, [...params])).rows as Record<string, unknown>[],
      begin: <T>(fn: (tx: any) => Promise<T>) => pg.transaction((tx) => fn({
        unsafe: async (query: string, params: readonly unknown[] = []) => (await tx.query(query, [...params])).rows,
      })),
    };
    store = new PostgresStudentWorkspaceStore(sql);
  });
  afterAll(async () => { await pg?.close(); });

  test('persists across adapters, conflicts rather than losing changes, and enables RLS', async () => {
    expect(await store.save('owner', 'preferences', 0, preferences)).toMatchObject({ ok: true, revision: 1 });
    expect((await store.load('owner', 'preferences'))?.data).toEqual(preferences);
    expect(await store.save('owner', 'preferences', 0, { locale: 'en' })).toMatchObject({ ok: false, revision: 1 });
    const result = await pg.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE relname IN ('student_workspace_documents','student_bidding_observations')");
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((row) => row.relrowsecurity)).toBe(true);
    await pg.exec('SET ROLE anon');
    try { await expect(pg.query('SELECT * FROM student_workspace_documents')).rejects.toThrow(/permission denied/i); }
    finally { await pg.exec('RESET ROLE'); }
  });

  test('shared course notes: anonymous reads, report hold, developer review, cascade on account deletion', async () => {
    const [author, r1, r2, r3, dev] = [1, 2, 3, 4, 5].map((n) => `00000000-0000-4000-8000-00000000010${n}`);
    for (const id of [author, r1, r2, r3, dev]) await pg.query('INSERT INTO auth.users(id) VALUES($1)', [id]);
    await pg.query("INSERT INTO profiles(id, role) VALUES($1,'developer')", [dev]);
    const note = { id: 'note_pg_000001', courseId: 'C9', kind: 'tip' as const, body: 'טיפ' };
    await store.publishNote(`auth:${author}`, note);
    await store.publishNote(`auth:${author}`, { ...note, body: 'טיפ מעודכן' }); // an edit, not a second note
    const [seen] = await store.communityNotes(`auth:${r1}`, 'C9');
    expect(seen).toMatchObject({ body: 'טיפ מעודכן', mine: false, reported: false });
    expect(Object.keys(seen)).not.toContain('owner');
    expect(await store.reportNote(`auth:${author}`, seen.id)).toBe('own_note');
    for (const reporter of [r1, r1, r2, r3]) expect(await store.reportNote(`auth:${reporter}`, seen.id)).toBe('reported');
    expect(await store.communityNotes(`auth:${r1}`, 'C9')).toEqual([]);
    expect(await store.isDeveloper(`auth:${r1}`)).toBe(false);
    expect(await store.isDeveloper(`auth:${dev}`)).toBe(true);
    expect(await store.hiddenNotes()).toEqual([expect.objectContaining({ id: seen.id, reports: 3 })]);
    expect(await store.moderateNote(seen.id, 'restore')).toBe(true);
    expect(await store.communityNotes(`auth:${r1}`, 'C9')).toHaveLength(1);
    await pg.exec('SET ROLE anon');
    try { await expect(pg.query('SELECT * FROM community_course_notes')).rejects.toThrow(/permission denied/i); }
    finally { await pg.exec('RESET ROLE'); }
    await pg.query('DELETE FROM auth.users WHERE id=$1', [author]);
    expect(await store.communityNotes(`auth:${r1}`, 'C9')).toEqual([]);
  });

  test('deleting an account also removes workspace documents and reports', async () => {
    const uid = '00000000-0000-4000-8000-000000000001';
    await pg.query('INSERT INTO auth.users(id) VALUES($1)', [uid]);
    await store.save(`auth:${uid}`, 'preferences', 0, preferences);
    await store.replaceObservations(`auth:${uid}`, 'p', 2025, 1, 1, [{
      kind: 'course', courseId: 'C1', group: '01', points: 20, outcome: 'accepted', rejectionReason: '',
    }]);
    await pg.query('DELETE FROM auth.users WHERE id=$1', [uid]);
    expect(await store.load(`auth:${uid}`, 'preferences')).toBeNull();
    expect(await store.observations('p', 2026, 1, 1)).toHaveLength(0);
  });
  test('anonymous documents can be claimed by only one account', async () => {
    const ids = ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'];
    for (const id of ids) await pg.query('INSERT INTO auth.users(id) VALUES($1)', [id]);
    await store.save('guest-for-adoption', 'preferences', 0, preferences);
    await Promise.all(ids.map((id) => store.adopt('guest-for-adoption', `auth:${id}`)));
    const copies = await Promise.all(ids.map((id) => store.load(`auth:${id}`, 'preferences')));
    expect(copies.filter(Boolean)).toHaveLength(1);
    expect(await store.load('guest-for-adoption', 'preferences')).toBeNull();
  });
});

describe('consented bidding history', () => {
  const report = (owner: string, year = 2025, points = 20, outcome = 'accepted', reason = '') => ({
    owner, programId: 'p', academicYear: year, semester: 1 as const, round: 1,
    kind: 'course' as const, courseId: 'C1', group: '01', points,
    outcome, rejectionReason: reason,
  });

  test('requires distinct contributors, historical years and competitive outcomes', () => {
    expect(aggregateBiddingHistory(Array.from({ length: 8 }, () => report('same')), 2026).summaries).toHaveLength(0);
    expect(aggregateBiddingHistory(Array.from({ length: 5 }, (_, i) => report(`u${i}`, 2026)), 2026).summaries).toHaveLength(0);
    const rows = Array.from({ length: 5 }, (_, i) => report(`u${i}`, 2025, 10 + 10 * i));
    rows.push(report('closed', 2025, 500, 'rejected', 'closed_group'));
    const history = aggregateBiddingHistory(rows, 2026);
    expect(history.summaries).toHaveLength(1);
    expect(history.summaries[0]).toMatchObject({ contributors: 5, acceptedCount: 5, acceptedBidMedian: 30, acceptedBidP75: 40 });
    expect(JSON.stringify(history)).not.toContain('owner');
  });

  test('replaces reports rather than counting retries, and supports withdrawal', async () => {
    const store = new MemoryStudentWorkspaceStore();
    const row = { kind: 'course' as const, courseId: 'C1', group: '01', points: 25, outcome: 'accepted', rejectionReason: '' };
    await store.replaceObservations('auth:u', 'p', 2025, 1, 1, [row]);
    await store.replaceObservations('auth:u', 'p', 2025, 1, 1, [{ ...row, points: 30 }]);
    expect(await store.observations('p', 2026, 1, 1)).toHaveLength(1);
    await store.replaceObservations('auth:u', 'p', 2025, 1, 1, []);
    expect(await store.observations('p', 2026, 1, 1)).toHaveLength(0);
  });
});
