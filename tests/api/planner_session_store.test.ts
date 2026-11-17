import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import {
  InMemoryPlannerSessionStore, PostgresPlannerSessionStore, SESSION_TTL_MS, accountUserId, type PlannerSessionStore,
} from '../../api/ai/planner_session_store'
import { emptyPlanningSession, type PlanningSessionState } from '../../shared/planner/planning-session'

const UP = readFileSync('scripts/migrations/planner/003_planner_sessions.sql', 'utf8')
const DOWN = readFileSync('scripts/migrations/planner/003_planner_sessions.down.sql', 'utf8')
const A = 'auth:11111111-1111-4111-8111-111111111111'
const B = 'auth:22222222-2222-4222-8222-222222222222'
const NOW = Date.UTC(2026, 10, 14)
const state = (note = ''): PlanningSessionState => ({ ...emptyPlanningSession('mechanical_engineering_2027', 'v1', '2026-11-14T00:00:00Z'), summary_he: note })

function contract(name: string, make: () => Promise<PlannerSessionStore>) {
  describe(name, () => {
    let store: PlannerSessionStore
    beforeEach(async () => { store = await make() })

    test('no session until one is saved; then it round-trips', async () => {
      expect(await store.load(A, 'p', NOW)).toBeNull()
      expect(await store.save({ ownerId: A, programId: 'p', state: state('סיכום'), expectedRevision: null, now: NOW })).toEqual({ ok: true, revision: 1 })
      const loaded = await store.load(A, 'p', NOW)
      expect(loaded).toMatchObject({ revision: 1, baseBoardVersion: 'v1' })
      expect(loaded?.state.summary_he).toBe('סיכום')
    })

    test('a save must name the revision it read: a second tab cannot silently overwrite the first', async () => {
      await store.save({ ownerId: A, programId: 'p', state: state('first'), expectedRevision: null, now: NOW })
      expect(await store.save({ ownerId: A, programId: 'p', state: state('tab 1'), expectedRevision: 1, now: NOW })).toEqual({ ok: true, revision: 2 })
      expect(await store.save({ ownerId: A, programId: 'p', state: state('tab 2'), expectedRevision: 1, now: NOW })).toEqual({ ok: false, reason: 'REVISION_CONFLICT' })
      expect((await store.load(A, 'p', NOW))?.state.summary_he).toBe('tab 1')
    })

    test('creating over an existing live session is refused', async () => {
      await store.save({ ownerId: A, programId: 'p', state: state('first'), expectedRevision: null, now: NOW })
      expect(await store.save({ ownerId: A, programId: 'p', state: state('again'), expectedRevision: null, now: NOW })).toEqual({ ok: false, reason: 'REVISION_CONFLICT' })
    })

    test('sessions are private to their owner and to their program', async () => {
      await store.save({ ownerId: A, programId: 'p', state: state('mine'), expectedRevision: null, now: NOW })
      expect(await store.load(B, 'p', NOW)).toBeNull()
      expect(await store.load(A, 'other', NOW)).toBeNull()
      expect(await store.save({ ownerId: B, programId: 'p', state: state('theirs'), expectedRevision: 1, now: NOW })).toEqual({ ok: false, reason: 'REVISION_CONFLICT' })
      expect((await store.load(A, 'p', NOW))?.state.summary_he).toBe('mine')
    })

    test('an expired session reads as none and can be replaced', async () => {
      await store.save({ ownerId: A, programId: 'p', state: state('old'), expectedRevision: null, now: NOW })
      const later = NOW + SESSION_TTL_MS + 1
      expect(await store.load(A, 'p', later)).toBeNull()
      expect(await store.save({ ownerId: A, programId: 'p', state: state('stale write'), expectedRevision: 1, now: later })).toEqual({ ok: false, reason: 'REVISION_CONFLICT' })
      expect(await store.save({ ownerId: A, programId: 'p', state: state('fresh'), expectedRevision: null, now: later })).toEqual({ ok: true, revision: 1 })
      expect((await store.load(A, 'p', later))?.state.summary_he).toBe('fresh')
    })

    test('only signed-in accounts get a persistent session', async () => {
      expect(await store.save({ ownerId: 'anon-cookie', programId: 'p', state: state(), expectedRevision: null, now: NOW })).toEqual({ ok: false, reason: 'NOT_AN_ACCOUNT' })
    })

    test('deleting clears the session', async () => {
      await store.save({ ownerId: A, programId: 'p', state: state(), expectedRevision: null, now: NOW })
      await store.delete(A, 'p')
      expect(await store.load(A, 'p', NOW)).toBeNull()
    })

    test('a state that breaks the schema is never written', async () => {
      const broken = { ...state(), schema_version: 2 } as unknown as PlanningSessionState
      await expect(store.save({ ownerId: A, programId: 'p', state: broken, expectedRevision: null, now: NOW })).rejects.toThrow()
    })
  })
}

test('account owner ids map to a user id; anything else does not', () => {
  expect(accountUserId(A)).toBe('11111111-1111-4111-8111-111111111111')
  expect(accountUserId('auth:not-a-uuid')).toBeNull()
  expect(accountUserId('0123456789abcdef')).toBeNull()
})

contract('in-memory store', async () => new InMemoryPlannerSessionStore())

describe('Postgres store against the real migration SQL (PGlite)', () => {
  let db: PGlite
  const sql = () => ({ unsafe: async (q: string, p?: readonly unknown[]) => (await db.query(q, p as unknown[] | undefined)).rows as Array<Record<string, unknown>> })
  const setUp = async () => {
    db = new PGlite()
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
      INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');`)
    await db.exec(UP)
    return new PostgresPlannerSessionStore(sql())
  }
  contract('Postgres store', setUp)

  test('the migration is idempotent and reversible, and touches nothing else', async () => {
    await setUp()
    await db.exec('CREATE TABLE planner_boards (owner_hash text PRIMARY KEY); INSERT INTO planner_boards VALUES (\'x\');')
    await db.exec(UP) // applying twice is harmless
    await db.exec(DOWN)
    expect((await db.query(`SELECT to_regclass('public.planner_sessions') AS t`)).rows[0]).toEqual({ t: null })
    expect((await db.query('SELECT count(*)::int AS n FROM planner_boards')).rows[0]).toEqual({ n: 1 })
    await db.exec(UP)
    expect((await db.query(`SELECT to_regclass('public.planner_sessions')::text AS t`)).rows[0]).toEqual({ t: 'planner_sessions' })
  })

  test('security posture: row security on, no policies, no privileges for browser roles', async () => {
    await setUp()
    expect((await db.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'planner_sessions'`)).rows[0]).toEqual({ relrowsecurity: true })
    expect((await db.query(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'planner_sessions'`)).rows[0]).toEqual({ n: 0 })
    const grants = (await db.query(`SELECT grantee FROM information_schema.role_table_grants WHERE table_name = 'planner_sessions' AND grantee IN ('anon','authenticated','PUBLIC')`)).rows
    expect(grants).toEqual([])
  })

  test('deleting the account deletes its sessions and no one else\'s', async () => {
    const store = await setUp()
    await store.save({ ownerId: A, programId: 'p', state: state('a'), expectedRevision: null, now: NOW })
    await store.save({ ownerId: B, programId: 'p', state: state('b'), expectedRevision: null, now: NOW })
    await db.exec(`DELETE FROM auth.users WHERE id = '11111111-1111-4111-8111-111111111111'`)
    expect(await store.load(A, 'p', NOW)).toBeNull()
    expect((await store.load(B, 'p', NOW))?.state.summary_he).toBe('b')
  })

  test('the size constraint refuses an oversized row, and expired rows are cleaned in small batches', async () => {
    const store = await setUp()
    await expect(db.query(`INSERT INTO planner_sessions VALUES ('o','p','11111111-1111-4111-8111-111111111111',1,null,'{}',200001,now(),now(),now())`)).rejects.toThrow()
    for (let i = 0; i < 25; i++) {
      await db.query(`INSERT INTO planner_sessions VALUES ($1,'p','11111111-1111-4111-8111-111111111111',1,null,'{}',2,now(),now(),now() - interval '1 day')`, [`old${i}`])
    }
    await store.save({ ownerId: B, programId: 'p', state: state(), expectedRevision: null, now: Date.now() })
    expect((await db.query(`SELECT count(*)::int AS n FROM planner_sessions WHERE owner_hash LIKE 'old%'`)).rows[0]).toEqual({ n: 5 })
  })

  test('an unreadable stored state starts a fresh session instead of failing', async () => {
    const store = await setUp()
    await db.query(`INSERT INTO planner_sessions VALUES ($1,'p','11111111-1111-4111-8111-111111111111',3,null,'{"schema_version":99}',20,now(),now(),now() + interval '1 day')`,
      [(await import('../../api/ai/owner_key')).ownerStorageKey(A)])
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await store.load(A, 'p')).toBeNull()
    spy.mockRestore()
  })
})
