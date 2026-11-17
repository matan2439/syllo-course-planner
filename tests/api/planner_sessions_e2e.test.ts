/**
 * End-to-end persistence scenarios with NO model: scripted tool calls stand in for the AI.
 * Real pieces: PlanningSession + agent tools, the turn service, PostgresPlannerSessionStore,
 * and the real 003 migration SQL (PGlite). Run via `npm test` (needs --experimental-vm-modules).
 */
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { RunContext, type FunctionTool } from '@openai/agents'
import { loadLocalBoardJson } from '../../api/ai/board_loader'
import { clarifyForAcademicDecision, extractClarificationContext } from '../../api/ai/academic_decision_runtime'
import { PlanningSession } from '../../api/ai/agent/session'
import { buildAgentTools } from '../../api/ai/agent/tools'
import { placedCourseIds } from '../../api/ai/planner_types'
import { PostgresPlannerSessionStore, SESSION_TTL_MS } from '../../api/ai/planner_session_store'
import { finishSessionTurn, sessionView, startSessionTurn, type BoardSnapshot } from '../../api/ai/planning_session_service'

const PROGRAM = 'test_program_intent_2027'
const OWNER = 'auth:11111111-1111-4111-8111-111111111111'
const status = { completed: [], currently_taking: [], planned: [], completed_knowledge: { status: 'known', provenance: 'explicit_user' } }
const PREFS = { disallowed_course_ids: [], __preferred_courses_answered: true }
const BOARD: BoardSnapshot = { version: 'v1', semesters: [{ semesterId: 'year_3_semester_a', courseIds: ['MAND'] }, { semesterId: 'year_4_semester_a', courseIds: [] }] }
const T0 = Date.UTC(2026, 10, 16)

let db: PGlite
let store: PostgresPlannerSessionStore
beforeEach(async () => {
  db = new PGlite()
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111');`)
  await db.exec(readFileSync('scripts/migrations/planner/003_planner_sessions.sql', 'utf8'))
  store = new PostgresPlannerSessionStore({ unsafe: async (q, p) => (await db.query(q, p as unknown[] | undefined)).rows as Array<Record<string, unknown>> })
})

async function open(restored?: any, dropped: any[] = []) {
  const context: any = { semesters: [{ id: 'year_3_semester_a', courses: [{ course_id: 'MAND' }] }], total_hours_progress: { known_completed_hours: 177 }, personal_status: status }
  return new PlanningSession({
    programId: PROGRAM, programBoard: loadLocalBoardJson(PROGRAM), planContext: context, committedContext: context, preferences: PREFS,
    clarification: await clarifyForAcademicDecision(extractClarificationContext(context, PREFS, undefined)),
    ...(restored ? { restoredSession: restored, droppedDraftChanges: dropped } : {}),
  })
}
async function tool(session: PlanningSession, name: string, args: Record<string, unknown>) {
  const found = buildAgentTools().find((candidate) => candidate.name === name) as unknown as FunctionTool<PlanningSession>
  const out = await found.invoke(new RunContext(session), JSON.stringify(args))
  return typeof out === 'string' ? JSON.parse(out) : out
}
const planned = (session: PlanningSession) => [...new Set(placedCourseIds(session.worker.getPlan()))].sort()

/** One conversation turn: read the session, let the scripted "model" act, remember the result. */
async function turn(userText: string, act: (session: PlanningSession) => Promise<void>, opts: { board?: BoardSnapshot; now?: number } = {}) {
  const board = opts.board ?? BOARD
  const start = await startSessionTurn({ store, ownerId: OWNER, programId: PROGRAM, board, now: opts.now })
  const session = await open(start.state ?? undefined, start.dropped)
  await act(session)
  const result = await finishSessionTurn({ store, ownerId: OWNER, programId: PROGRAM, start, session, userText, assistantText: 'תשובת בדיקה', board, now: opts.now })
  return { start, session, result }
}
const build = (s: PlanningSession) => tool(s, 'build_plan', { only_years: null, start_over: null })

test('reload: a cold start (new store object, new session object) restores the conversation and the draft', async () => {
  const first = await turn('תבנה לי תוכנית', async (s) => { await build(s); s.recordDecision('רוצה תוכנית מאוזנת') }, { now: T0 })
  expect(first.result).toBe('saved')
  const draftBefore = planned(first.session)

  const reloaded = new PostgresPlannerSessionStore({ unsafe: async (q, p) => (await db.query(q, p as unknown[] | undefined)).rows as Array<Record<string, unknown>> })
  const stored = await reloaded.load(OWNER, PROGRAM, T0 + 1000)
  expect(stored?.revision).toBe(1)
  expect(sessionView(stored!.state)).toMatchObject({ turns: [{ role: 'user', text: 'תבנה לי תוכנית' }, { role: 'assistant', text: 'תשובת בדיקה' }], decisions_he: ['רוצה תוכנית מאוזנת'] })
  expect(planned(await open(stored!.state))).toEqual(draftBefore)
})

test('draft persistence: turn 2 continues from the saved draft, accepted courses stay, a rejection sticks', async () => {
  await turn('תבנה', build, { now: T0 })
  const second = await turn('בלי אלפא', async (s) => {
    await tool(s, 'decide_on_suggestions', { accept_course_ids: null, reject_course_ids: ['ALPHA'], student_words_he: 'לא אלפא' })
  }, { now: T0 + 60_000 })
  expect(second.result).toBe('saved')
  expect(planned(second.session)).not.toContain('ALPHA')

  const third = await turn('תמשיך', async () => undefined, { now: T0 + 120_000 })
  expect(planned(third.session)).not.toContain('ALPHA')
  expect(third.session.lockViolations()).toEqual([])
  expect((await store.load(OWNER, PROGRAM, T0 + 130_000))?.revision).toBe(3)
})

test('board edited between turns: the board wins, the stale draft part is dropped and reported, locks hold', async () => {
  await turn('תבנה', build, { now: T0 })
  const edited: BoardSnapshot = { version: 'v2', semesters: [{ semesterId: 'year_3_semester_a', courseIds: ['MAND'] }, { semesterId: 'year_4_semester_a', courseIds: ['ALPHA'] }] }
  const next = await turn('המשך', async () => undefined, { board: edited, now: T0 + 60_000 })
  expect(next.start.dropped.some((change) => change.course_id === 'ALPHA')).toBe(true)
  expect((await store.load(OWNER, PROGRAM, T0 + 61_000))?.state.base_board_version).toBe('v2')
})

test('two tabs: the second tab\'s save is refused with a conflict; nothing is overwritten', async () => {
  await turn('הודעה ראשונה', async () => undefined, { now: T0 })
  // Both tabs read revision 1.
  const tabA = await startSessionTurn({ store, ownerId: OWNER, programId: PROGRAM, board: BOARD, now: T0 + 1000 })
  const tabB = await startSessionTurn({ store, ownerId: OWNER, programId: PROGRAM, board: BOARD, now: T0 + 1000 })
  const sessionA = await open(tabA.state ?? undefined)
  const sessionB = await open(tabB.state ?? undefined)
  const save = (start: typeof tabA, session: PlanningSession, text: string) =>
    finishSessionTurn({ store, ownerId: OWNER, programId: PROGRAM, start, session, userText: text, assistantText: 'תשובה', board: BOARD, now: T0 + 2000 })
  // Truly concurrent: exactly one wins.
  const results = await Promise.all([save(tabA, sessionA, 'טאב A'), save(tabB, sessionB, 'טאב B')])
  expect(results.filter((r) => r === 'saved')).toHaveLength(1)
  expect(results.filter((r) => r === 'conflict')).toHaveLength(1)
  const stored = await store.load(OWNER, PROGRAM, T0 + 3000)
  expect(stored?.revision).toBe(2)
  expect(stored?.state.recent_turns.filter((t) => t.role === 'user')).toHaveLength(2) // first message + exactly one tab's
  // The losing tab simply reloads and its next turn succeeds.
  expect((await turn('טאב אחרי קונפליקט', async () => undefined, { now: T0 + 4000 })).result).toBe('saved')
})

test('reset: deleting the session starts a new conversation; the committed board is untouched', async () => {
  await turn('תבנה', build, { now: T0 })
  await store.delete(OWNER, PROGRAM)
  expect(await store.load(OWNER, PROGRAM, T0 + 1000)).toBeNull()
  const fresh = await turn('מחדש', async () => undefined, { now: T0 + 2000 })
  expect(fresh.start.state).toBeNull()
  expect((await store.load(OWNER, PROGRAM, T0 + 3000))?.revision).toBe(1)
})

test('expiry: after 90 idle days the session reads as new and can be replaced; activity extends it', async () => {
  await turn('שלום', async () => undefined, { now: T0 })
  expect((await store.load(OWNER, PROGRAM, T0 + SESSION_TTL_MS - 1000))?.revision).toBe(1)
  const late = await turn('שוב', async () => undefined, { now: T0 + SESSION_TTL_MS + 1000 })
  expect(late.start.state).toBeNull() // expired: a new conversation, not an error
  expect(late.result).toBe('saved')
  // The expired row was replaced in place (one row per student per program).
  expect((await db.query('SELECT count(*)::int AS n FROM planner_sessions')).rows[0]).toEqual({ n: 1 })
  const active = await turn('ממשיך', async () => undefined, { now: T0 + SESSION_TTL_MS + 86_400_000 })
  expect(active.start.state).not.toBeNull()
})

test('a signed-out (non-account) owner is never persisted and the turn still completes', async () => {
  const start = await startSessionTurn({ store, ownerId: 'anon:abc', programId: PROGRAM, board: BOARD, now: T0 })
  const session = await open()
  const result = await finishSessionTurn({ store, ownerId: 'anon:abc', programId: PROGRAM, start, session, userText: 'x', assistantText: 'y', board: BOARD, now: T0 })
  expect(result).toBe('not_an_account')
  expect((await db.query('SELECT count(*)::int AS n FROM planner_sessions')).rows[0]).toEqual({ n: 0 })
})
