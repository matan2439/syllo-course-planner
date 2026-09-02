import { createConversationHandler } from '../../api/ai/conversation'

function response() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    headers: {} as Record<string, unknown>,
    status(code: number) { this.statusCode = code; return this },
    json(body: unknown) { this.body = body; return this },
    setHeader(name: string, value: unknown) { this.headers[name] = value },
    getHeader(name: string) { return this.headers[name] },
  }
  return res
}

const validBody = {
  program_id: 'mechanical_engineering_2027',
  session_token: '5dbda0de-bfa7-4f38-9f45-2f13ae81e267',
  board_version: null,
  academic_status_digest: 'as_4',
  preference_digest: 'pref_4',
  transcript: [{ role: 'user', text: 'בנה לי חלופה מאוזנת' }],
}

test('conversation endpoint allows POST only', async () => {
  const handler = createConversationHandler({ resolveModel: () => null })
  const res = response()
  await handler({ method: 'GET' } as any, res)
  expect(res.statusCode).toBe(405)
  expect(res.body).toEqual(expect.objectContaining({ code: 'METHOD_NOT_ALLOWED' }))
})

test('conversation endpoint rejects untrusted board and tool payloads', async () => {
  const handler = createConversationHandler({ resolveModel: () => null })
  const res = response()
  await handler({ method: 'POST', body: { ...validBody, committed_board: { semesters: [] } } } as any, res)
  expect(res.statusCode).toBe(400)
  expect(res.body).toEqual(expect.objectContaining({ code: 'INVALID_REQUEST' }))
})

test('missing model fails closed with typed assistant unavailability', async () => {
  const handler = createConversationHandler({ resolveModel: () => null })
  const res = response()
  await handler({ method: 'POST', body: validBody } as any, res)
  expect(res.statusCode).toBe(503)
  expect(res.body).toEqual({
    outcome: 'assistant_unavailable',
    message_he: 'העוזר האקדמי אינו זמין כרגע.',
    events: [{ type: 'assistant_unavailable', message_he: 'העוזר האקדמי אינו זמין כרגע.' }],
    code: 'ASSISTANT_UNAVAILABLE',
  })
})

test('configured conversation fails closed when the authoritative board version is stale', async () => {
  const handler = createConversationHandler({
    resolveModel: () => ({ model: {} as any, name: 'test-model' } as any),
    loadBoard: async () => ({
      ownerId: 'server-owner',
      programId: validBody.program_id,
      version: 'bv_2',
      semesters: [],
      updatedAt: 1,
    }),
  })
  const res = response()
  await handler({
    method: 'POST',
    headers: { cookie: `syllo_owner=${'x'.repeat(43)}` },
    body: { ...validBody, board_version: 'bv_1' },
  } as any, res)

  expect(res.statusCode).toBe(409)
  expect(res.body).toEqual(expect.objectContaining({
    code: 'BOARD_VERSION_CONFLICT',
    currentBoardVersion: 'bv_2',
  }))
})

test('configured conversation rejects a stale academic status digest', async () => {
  const handler = createConversationHandler({
    resolveModel: () => ({ model: {} as any, name: 'test-model' } as any),
    loadBoard: async () => null,
    loadAcademicContext: async () => ({
      ownerId: 'server-owner', programId: validBody.program_id,
      digest: 'as_server', personalStatus: {}, planContext: {}, preferences: {}, updatedAt: 1,
    }),
  })
  const res = response()
  await handler({
    method: 'POST', headers: { cookie: `syllo_owner=${'x'.repeat(43)}` }, body: validBody,
  } as any, res)

  expect(res.statusCode).toBe(409)
  expect(res.body).toEqual(expect.objectContaining({ code: 'ACADEMIC_CONTEXT_CONFLICT' }))
})
