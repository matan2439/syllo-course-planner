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

