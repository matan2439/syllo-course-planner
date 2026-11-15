import { createConversationHandler } from '../../api/ai/conversation'
import { InMemoryPlannerSessionStore, type PlannerSessionStore } from '../../api/ai/planner_session_store'
import { preferenceDigest } from '../../api/ai/apply_runtime'
import { planningSessionViewResponseSchema } from '../../shared/planner/conversation-wire'

const OWNER = 'auth:11111111-1111-4111-8111-111111111111'
const PROGRAM = 'mechanical_engineering_2027'
const preferences = { max_weekly_hours: 22, disallowed_course_ids: [] }

function response() {
  const res: any = {
    statusCode: 200, body: undefined, headers: {} as Record<string, unknown>,
    status(code: number) { this.statusCode = code; return this },
    json(body: unknown) { this.body = body; return this },
    setHeader(name: string, value: unknown) { this.headers[name] = value },
    getHeader(name: string) { return this.headers[name] },
    write: () => true, end: () => undefined,
  }
  return res
}

const body = (text: string, transcript?: Array<{ role: 'user' | 'assistant'; text: string }>) => ({
  program_id: PROGRAM, session_token: '5dbda0de-bfa7-4f38-9f45-2f13ae81e267', board_version: null,
  academic_status_digest: 'as_4', preference_digest: preferenceDigest(preferences),
  transcript: transcript ?? [{ role: 'user' as const, text }],
})

function make(store: PlannerSessionStore | null, seen: any[] = [], reply = 'תשובה') {
  const meter = { funding: 'credits' as const, deliver: async () => undefined, release: async () => undefined }
  return createConversationHandler({
    resolveModel: () => ({ model: {} as any, name: 'test-model' }),
    openMeter: async () => meter as any,
    resolveOwner: async () => ({ ownerId: OWNER, issued: false }),
    sessionStore: store,
    loadBoard: async () => ({ ownerId: OWNER, programId: PROGRAM, version: 'v1', semesters: [], updatedAt: 1 } as any),
    loadAcademicContext: async () => ({
      ownerId: OWNER, programId: PROGRAM, digest: 'as_4',
      personalStatus: { completed: [], completed_knowledge: { status: 'known', provenance: 'explicit_user' } },
      planContext: {}, preferences, updatedAt: 1,
    }),
    loadProgramBoard: () => ({ semesters: [], metadata: {} }),
    runAgent: async (input: any) => {
      seen.push(input.transcript)
      input.session.recordDecision('המשתמש מתעניין באלמנטים סופיים')
      return { outcome: 'conversation', messageHe: reply, events: [], usage: { input_tokens: 5 } } as any
    },
    putProposal: async (record: any) => record,
  })
}

const post = async (handler: any, text: string, transcript?: any) => {
  const res = response()
  await handler({ method: 'POST', headers: { cookie: `syllo_owner=${'x'.repeat(43)}` }, body: body(text, transcript) } as any, res)
  return res
}
const call = async (handler: any, method: 'GET' | 'DELETE', programId = PROGRAM) => {
  const res = response()
  await handler({ method, query: { program_id: programId }, headers: {} } as any, res)
  return res
}

test('a reply is remembered: the next turn continues from the stored conversation, not from what the client sent', async () => {
  const store = new InMemoryPlannerSessionStore()
  const seen: any[] = []
  const handler = make(store, seen)
  expect((await post(handler, 'אני מתעניין באלמנטים סופיים')).statusCode).toBe(200)
  expect((await store.load(OWNER, PROGRAM))?.revision).toBe(1)

  // A second device sends only its own message; the server still knows the first exchange.
  expect((await post(handler, 'ומה אחרי זה?')).statusCode).toBe(200)
  expect(seen[1]).toEqual([
    { role: 'user', text: 'אני מתעניין באלמנטים סופיים' }, { role: 'assistant', text: 'תשובה' },
    { role: 'user', text: 'ומה אחרי זה?' },
  ])
  const stored = await store.load(OWNER, PROGRAM)
  expect(stored?.revision).toBe(2)
  expect(stored?.state.recent_turns).toHaveLength(4)
  expect(stored?.state.decisions.map((d) => d.summary_he)).toEqual(['המשתמש מתעניין באלמנטים סופיים', 'המשתמש מתעניין באלמנטים סופיים'])
  expect(stored?.state.base_board_version).toBe('v1')
})

test('the page restores the conversation after a reload, and "new conversation" clears it', async () => {
  const store = new InMemoryPlannerSessionStore()
  const handler = make(store)
  await post(handler, 'שלום')
  const view = await call(handler, 'GET')
  expect(planningSessionViewResponseSchema.safeParse(view.body).success).toBe(true)
  expect(view.body).toMatchObject({ ok: true, enabled: true, session: { turns: [{ role: 'user', text: 'שלום' }, { role: 'assistant', text: 'תשובה' }] } })
  expect((await call(handler, 'DELETE')).body).toEqual({ ok: true })
  expect((await call(handler, 'GET')).body).toMatchObject({ enabled: true, session: null })
  expect(await store.load(OWNER, PROGRAM)).toBeNull()
})

test('with persistent sessions off, nothing is stored and the page keeps its own transcript', async () => {
  const handler = make(null)
  expect((await post(handler, 'שלום')).statusCode).toBe(200)
  expect((await call(handler, 'GET')).body).toEqual({ ok: true, enabled: false, session: null })
})

test('an unavailable session store never fails the reply: the turn runs from the client transcript', async () => {
  const broken: PlannerSessionStore = {
    load: async () => { throw new Error('relation "planner_sessions" does not exist') },
    save: async () => { throw new Error('relation "planner_sessions" does not exist') },
    delete: async () => undefined,
  }
  const seen: any[] = []
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  const handler = make(broken, seen)
  const res = await post(handler, 'שלום', [{ role: 'user', text: 'שלום' }])
  expect(res.statusCode).toBe(200)
  expect(res.body).toMatchObject({ outcome: 'conversation', message_he: 'תשובה' })
  expect(seen[0]).toEqual([{ role: 'user', text: 'שלום' }])
})

test('a stale save from a second tab is refused and cannot overwrite the first', async () => {
  const store = new InMemoryPlannerSessionStore()
  // Tab 1 and tab 2 both read the (absent) session; tab 1 saves first, tab 2's save must lose.
  const handler = make(store)
  const first = await post(handler, 'טאב 1')
  const lateSave = await store.save({ ownerId: OWNER, programId: PROGRAM, state: (await store.load(OWNER, PROGRAM))!.state, expectedRevision: null })
  expect(first.statusCode).toBe(200)
  expect(lateSave).toEqual({ ok: false, reason: 'REVISION_CONFLICT' })
  expect((await store.load(OWNER, PROGRAM))?.state.recent_turns[0].text).toBe('טאב 1')
})

test('another student never sees this conversation', async () => {
  const store = new InMemoryPlannerSessionStore()
  await post(make(store), 'פרטי')
  const other = createConversationHandler({
    resolveModel: () => ({ model: {} as any, name: 't' }), sessionStore: store,
    resolveOwner: async () => ({ ownerId: 'auth:22222222-2222-4222-8222-222222222222', issued: false }),
  })
  expect((await call(other, 'GET')).body).toMatchObject({ enabled: true, session: null })
})

test('a request for the session needs a program id', async () => {
  const res = response()
  await make(new InMemoryPlannerSessionStore())({ method: 'GET', query: {}, headers: {} } as any, res)
  expect(res.statusCode).toBe(400)
})
