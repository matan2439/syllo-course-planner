import { createConversationHandler } from '../../api/ai/conversation'
import { PlannerStorageError, preferenceDigest } from '../../api/ai/apply_runtime'
import type { AcademicDecisionAgentRun } from '../../api/ai/academic_decision_integration'

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

test('conversation redacts planner storage failures', async () => {
  const handler = createConversationHandler({
    resolveModel: () => ({ model: {} as any, name: 'test-model' } as any),
    loadBoard: async () => { throw new PlannerStorageError('PLANNER_STORAGE_UNAVAILABLE') },
  })
  const res = response()
  await handler({
    method: 'POST', headers: { cookie: `syllo_owner=${'x'.repeat(43)}` }, body: validBody,
  } as any, res)

  expect(res.statusCode).toBe(503)
  expect(res.body).toEqual({
    ok: false,
    code: 'PLANNER_STORAGE_UNAVAILABLE',
    message_he: 'אחסון התכנון אינו זמין כרגע. נא לנסות שוב מאוחר יותר.',
  })
})

test('configured conversation rejects stale planning preferences', async () => {
  const preferences = { max_weekly_hours: 22, avoid_days: ['friday'] }
  const handler = createConversationHandler({
    resolveModel: () => ({ model: {} as any, name: 'test-model' } as any),
    loadBoard: async () => null,
    loadAcademicContext: async () => ({
      ownerId: 'server-owner', programId: validBody.program_id,
      digest: validBody.academic_status_digest,
      personalStatus: {}, planContext: {}, preferences, updatedAt: 1,
    }),
  })
  const res = response()
  await handler({
    method: 'POST', headers: { cookie: `syllo_owner=${'x'.repeat(43)}` },
    body: { ...validBody, preference_digest: preferenceDigest({ max_weekly_hours: 18 }) },
  } as any, res)

  expect(res.statusCode).toBe(409)
  expect(res.body).toEqual(expect.objectContaining({ code: 'PREFERENCE_CONTEXT_CONFLICT' }))
})

test('configured conversation fails closed when the authoritative program universe is unavailable', async () => {
  const preferences = { max_weekly_hours: 22 }
  const handler = createConversationHandler({
    resolveModel: () => ({ model: {} as any, name: 'test-model' } as any),
    loadBoard: async () => null,
    loadAcademicContext: async () => ({
      ownerId: 'server-owner', programId: validBody.program_id,
      digest: validBody.academic_status_digest,
      personalStatus: {}, planContext: {}, preferences, updatedAt: 1,
    }),
    loadProgramBoard: () => null,
  })
  const res = response()
  await handler({
    method: 'POST', headers: { cookie: `syllo_owner=${'x'.repeat(43)}` },
    body: { ...validBody, preference_digest: preferenceDigest(preferences) },
  } as any, res)

  expect(res.statusCode).toBe(503)
  expect(res.body).toEqual(expect.objectContaining({ code: 'NO_PROGRAM_UNIVERSE' }))
})

test('configured conversation returns a server-owned proposal receipt after the injected agent succeeds', async () => {
  const preferences = { max_weekly_hours: 22, disallowed_course_ids: [] }
  const putProposal = jest.fn(async (record: any) => record)
  const handler = createConversationHandler({
    resolveModel: () => ({ model: {} as any, name: 'test-model' } as any),
    loadBoard: async () => null,
    loadAcademicContext: async () => ({
      ownerId: 'server-owner', programId: validBody.program_id,
      digest: validBody.academic_status_digest,
      personalStatus: { completed: [], completed_knowledge: { status: 'known', provenance: 'explicit_user' } },
      planContext: {}, preferences, updatedAt: 1,
    }),
    loadProgramBoard: () => ({ semesters: [], metadata: {} }),
    runAgent: async () => ({
      outcome: 'proposal',
      messageHe: 'הכנתי חלופה חוקית.',
      events: [{ type: 'assistant_message', text_he: 'הכנתי חלופה חוקית.' }],
      draftPlan: { semesters: { semester_a: ['COURSE-1'] } },
      validation: { valid: true },
    } as any),
    putProposal,
  })
  const res = response()

  await handler({
    method: 'POST', headers: { cookie: `syllo_owner=${'x'.repeat(43)}` },
    body: { ...validBody, preference_digest: preferenceDigest(preferences) },
  } as any, res)

  expect(res.statusCode).toBe(200)
  expect(res.body).toEqual(expect.objectContaining({
    outcome: 'proposal',
    message_he: 'הכנתי חלופה חוקית.',
    proposal_id: expect.any(String),
  }))
  expect(res.body).not.toHaveProperty('draftPlan')
  expect(res.body.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'alternatives_ready', candidate_ids: expect.any(Array) }),
  ]))
  expect(putProposal).toHaveBeenCalledTimes(1)
  expect(putProposal.mock.calls[0][0]).toEqual(expect.objectContaining({
    ownerId: expect.any(String),
    baseBoardVersion: null,
    candidates: [expect.objectContaining({
      semesters: [{ semesterId: 'semester_a', courseIds: ['COURSE-1'] }],
      valid: true,
      applyable: true,
    })],
  }))
})

test('configured conversation runs the AcademicDecisionAgent pipeline over the authoritative board and draft', async () => {
  const preferences = { max_weekly_hours: 22, disallowed_course_ids: [] }
  const runDecisionPipeline = jest.fn(async (input: any) => ({
    orchestration: {
      engine: 'AcademicDecisionAgent',
      planningSource: 'stable-planner',
      planned: true,
      gapsDetected: 0,
    },
    clarification: { needsClarification: false, missingInputs: [], questions: [] },
    structuredClarification: { items: [], applyBlocked: false },
    grounding: { facts: [], conflicts: [] },
    validation: { findings: [], applyBlocked: false },
    input,
  } as unknown as AcademicDecisionAgentRun))
  const handler = createConversationHandler({
    resolveModel: () => ({ model: {} as any, name: 'test-model' } as any),
    loadBoard: async () => null,
    loadAcademicContext: async () => ({
      ownerId: 'server-owner', programId: validBody.program_id,
      digest: validBody.academic_status_digest,
      personalStatus: { completed: [], completed_knowledge: { status: 'known', provenance: 'explicit_user' } },
      planContext: {}, preferences, updatedAt: 1,
    }),
    loadProgramBoard: () => ({ semesters: [], metadata: {} }),
    runAgent: async () => ({
      outcome: 'proposal',
      messageHe: 'הכנתי חלופה חוקית.',
      events: [{ type: 'assistant_message', text_he: 'הכנתי חלופה חוקית.' }],
      draftPlan: { semesters: { semester_a: ['COURSE-1'] } },
      validation: { valid: true },
    } as any),
    runAcademicDecisionAgent: runDecisionPipeline,
    putProposal: async (record: any) => record,
  })
  const res = response()

  await handler({
    method: 'POST', headers: { cookie: `syllo_owner=${'x'.repeat(43)}` },
    body: { ...validBody, preference_digest: preferenceDigest(preferences) },
  } as any, res)

  expect(res.statusCode).toBe(200)
  expect(runDecisionPipeline).toHaveBeenCalledTimes(1)
  expect(runDecisionPipeline.mock.calls[0][0]).toEqual(expect.objectContaining({
    programId: validBody.program_id,
    finalState: { semesters: { semester_a: ['COURSE-1'] } },
  }))
  expect(res.body.academic_decision).toEqual(expect.objectContaining({
    engine: 'AcademicDecisionAgent',
    ready_to_plan: true,
  }))
})

test('conversation blocks an early proposal until critical academic facts are known', async () => {
  const runDecisionPipeline = jest.fn()
  const handler = createConversationHandler({
    resolveModel: () => ({ model: {} as any, name: 'test-model' } as any),
    loadBoard: async () => null,
    loadAcademicContext: async () => ({
      ownerId: 'server-owner', programId: validBody.program_id,
      digest: validBody.academic_status_digest, personalStatus: {}, planContext: {},
      preferences: { max_weekly_hours: 22 }, updatedAt: 1,
    }),
    loadProgramBoard: () => ({ semesters: [], metadata: {} }),
    runAgent: async () => ({
      outcome: 'proposal',
      messageHe: 'הכנתי חלופה מוקדם מדי.',
      events: [{ type: 'assistant_message', text_he: 'הכנתי חלופה מוקדם מדי.' }],
      draftPlan: { semesters: {} },
      validation: { valid: true },
    } as any),
    runAcademicDecisionAgent: runDecisionPipeline as any,
  })
  const res = response()

  await handler({
    method: 'POST', headers: { cookie: `syllo_owner=${'x'.repeat(43)}` },
    body: { ...validBody, preference_digest: preferenceDigest({ max_weekly_hours: 22 }) },
  } as any, res)

  expect(res.statusCode).toBe(200)
  expect(res.body).toEqual(expect.objectContaining({
    outcome: 'clarification_required',
    next_action: 'ask',
    message_he: expect.stringContaining('פרטים אקדמיים'),
    academic_decision: expect.objectContaining({ ready_to_plan: false }),
  }))
  expect(res.body.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'clarification', question_he: expect.stringContaining('קורסים') }),
  ]))
  expect(runDecisionPipeline).not.toHaveBeenCalled()
})
