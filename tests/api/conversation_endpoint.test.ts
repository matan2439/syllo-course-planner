import { createConversationHandler } from '../../api/ai/conversation'
import { PlannerStorageError, academicStatusDigest, preferenceDigest } from '../../api/ai/apply_runtime'
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
    explanation: expect.objectContaining({
      summary_he: 'הטיוטה עברה אימות חוקיות והשלמת דרישות.',
      facts_he: [],
      risks_he: [],
      next_actions_he: ['אפשר לעבור על החלופה בלוח לפני ההחלה.'],
    }),
    decision: expect.objectContaining({
      outcome: 'selected',
      selected_candidate_id: expect.any(String),
      evaluated_candidate_ids: [expect.any(String)],
      alternatives_not_selected_ids: [],
      selection_basis: 'existing_deterministic_ranking',
    }),
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

test('conversation refuses a turn once the AI quota is exhausted, before running the agent', async () => {
  const runAgent = jest.fn()
  const handler = createConversationHandler({
    resolveModel: () => ({ model: {} as any, name: 'test-model' }),
    checkQuota: async () => ({ allowed: false }),
    runAgent: runAgent as any,
  })
  const res = response()
  await handler({ method: 'POST', headers: { cookie: `syllo_owner=${'x'.repeat(43)}` }, body: validBody } as any, res)

  expect(res.statusCode).toBe(429)
  expect(res.body).toEqual(expect.objectContaining({ code: 'QUOTA_EXCEEDED' }))
  expect(runAgent).not.toHaveBeenCalled()
})

test('preferences the agent records are persisted and returned as a context update', async () => {
  const preferences = { max_weekly_hours: 22 }
  const personalStatus = { completed: [], completed_knowledge: { status: 'known', provenance: 'explicit_user' } }
  const putAcademicContext = jest.fn(async (input: any) => ({ ...input, updatedAt: 2 }))
  const handler = createConversationHandler({
    resolveModel: () => ({ model: {} as any, name: 'test-model' }),
    loadBoard: async () => null,
    loadAcademicContext: async () => ({
      ownerId: 'server-owner', programId: validBody.program_id,
      digest: validBody.academic_status_digest, personalStatus, planContext: {}, preferences, updatedAt: 1,
    }),
    loadProgramBoard: () => ({ semesters: [], metadata: {} }),
    runAgent: async ({ session }) => {
      session.updatePreferences({ max_weekly_hours: 18 })
      return { outcome: 'conversation', messageHe: 'עדכנתי את מגבלת השעות.', events: [] }
    },
    putAcademicContext,
  })
  const res = response()
  await handler({
    method: 'POST', headers: { cookie: `syllo_owner=${'x'.repeat(43)}` },
    body: { ...validBody, preference_digest: preferenceDigest(preferences) },
  } as any, res)

  expect(res.statusCode).toBe(200)
  expect(putAcademicContext).toHaveBeenCalledWith(expect.objectContaining({ preferences: { max_weekly_hours: 18 } }))
  expect(res.body.context_update).toEqual({
    academic_status_digest: validBody.academic_status_digest,
    preference_digest: preferenceDigest({ max_weekly_hours: 18 }),
  })
})

test('the plan the agent submitted is stored as the recommended, apply-checkable candidate', async () => {
  const preferences = { max_weekly_hours: 22, disallowed_course_ids: [] }
  const putProposal = jest.fn(async (record: any) => record)
  const recordUsage = jest.fn(async () => undefined)
  const handler = createConversationHandler({
    resolveModel: () => ({ model: {} as any, name: 'test-model' }),
    recordUsage,
    loadBoard: async () => null,
    loadAcademicContext: async () => ({
      ownerId: 'server-owner', programId: validBody.program_id, digest: validBody.academic_status_digest,
      personalStatus: { completed: [], completed_knowledge: { status: 'known', provenance: 'explicit_user' } },
      planContext: {}, preferences, updatedAt: 1,
    }),
    loadProgramBoard: () => ({ semesters: [], metadata: {} }),
    runAgent: async () => ({
      outcome: 'proposal', messageHe: 'הכנתי חלופה חוקית.', events: [],
      draftPlan: { semesters: { semester_a: ['COURSE-1'] } }, validation: { valid: true },
    } as any),
    putProposal,
  })
  const res = response()
  await handler({
    method: 'POST', headers: { cookie: `syllo_owner=${'x'.repeat(43)}` },
    body: { ...validBody, preference_digest: preferenceDigest(preferences) },
  } as any, res)

  expect(res.statusCode).toBe(200)
  const record = putProposal.mock.calls[0][0]
  const recommended = record.candidates.find((candidate: any) => candidate.recommended)
  expect(recommended.semesters).toEqual([{ semesterId: 'semester_a', courseIds: ['COURSE-1'] }])
  // Same identity + fingerprint format the apply path re-checks.
  expect(recommended.normalizedIdentity).toBe(JSON.stringify([['COURSE-1', 'semester_a']]))
  expect(record.constraintFingerprint).toMatch(/^cf_[0-9a-f]{16}$/)
  expect(record.recommendedCandidateId).toBe(recommended.candidateId)
  expect(recordUsage).toHaveBeenCalledWith(validBody.session_token, 'test-model')
})

test('conversation persists a structured clarification answer and returns refreshed context digests', async () => {
  const personalStatus = {
    completed: [{ course_id: '0542-2400', grade: 91 }],
    currently_taking: [{ course_id: '0542-2500', semester_id: 'semester_5' }],
    completed_knowledge: { status: 'known', provenance: 'explicit_user' },
  }
  const preferences = { max_weekly_hours: 22 }
  const putAcademicContext = jest.fn(async (input: any) => ({
    ...input,
    updatedAt: 2,
  }))
  const handler = createConversationHandler({
    resolveModel: () => ({ model: {} as any, name: 'test-model' } as any),
    loadBoard: async () => null,
    loadAcademicContext: async () => ({
      ownerId: 'server-owner', programId: validBody.program_id,
      digest: academicStatusDigest(personalStatus), personalStatus, planContext: {}, preferences, updatedAt: 1,
    }),
    loadProgramBoard: () => ({ semesters: [], metadata: {} }),
    runAgent: async () => ({
      outcome: 'conversation',
      nextAction: 'ask',
      messageHe: 'תודה, ממשיכים.',
      events: [{ type: 'assistant_message', text_he: 'תודה, ממשיכים.' }],
    } as any),
    putAcademicContext,
  })
  const res = response()

  await handler({
    method: 'POST', headers: { cookie: `syllo_owner=${'x'.repeat(43)}` },
    body: {
      ...validBody,
      academic_status_digest: academicStatusDigest(personalStatus),
      preference_digest: preferenceDigest(preferences),
      clarification_answers: [{ question_id: 'excluded_courses', value: [] }],
    },
  } as any, res)

  expect(res.statusCode).toBe(200)
  expect(putAcademicContext).toHaveBeenCalledWith(expect.objectContaining({
    personalStatus,
    preferences: { max_weekly_hours: 22, disallowed_course_ids: [] },
  }))
  expect(res.body.context_update).toEqual({
    academic_status_digest: academicStatusDigest(personalStatus),
    preference_digest: preferenceDigest({ max_weekly_hours: 22, disallowed_course_ids: [] }),
  })
})

test('each proposal alternative carries the degree requirements it would leave, recomputed by the server', async () => {
  const board = {
    semesters: [{ semester_id: 'semester_a', courses: [] }],
    metadata: {
      completed_course_ids: [],
      program_requirements_validation: { valid: false },
      program_requirements_categories: {
        total_required_hours: 10, core_courses_total_min: 1, mandatory_course_ids: [],
        categories: [{ category_id: 'core_a', name_he: 'ליבה', min_courses: 1, needs_review: false, is_core: true, course_ids: ['COURSE-1'] }],
      },
      program_repository_courses: [{ course_id: 'COURSE-1', name_he: 'קורס', weekly_hours: 3, is_mandatory: false }],
    },
  }
  const run = async (programBoard: unknown, maxWeeklyHours = 22) => {
    const preferences = { max_weekly_hours: maxWeeklyHours, disallowed_course_ids: [] }
    const handler = createConversationHandler({
      resolveModel: () => ({ model: {} as any, name: 'test-model' } as any),
      loadBoard: async () => null,
      loadAcademicContext: async () => ({
        ownerId: 'server-owner', programId: validBody.program_id, digest: validBody.academic_status_digest,
        personalStatus: { completed: [], completed_knowledge: { status: 'known', provenance: 'explicit_user' } },
        planContext: {}, preferences, updatedAt: 1,
      }),
      loadProgramBoard: () => programBoard as any,
      runAgent: async () => ({
        outcome: 'proposal', messageHe: 'הכנתי חלופה חוקית.',
        events: [{ type: 'assistant_message', text_he: 'הכנתי חלופה חוקית.' }],
        draftPlan: { semesters: { semester_a: ['COURSE-1'] } }, validation: { valid: true },
      } as any),
      putProposal: jest.fn(async (record: any) => record),
    })
    const res = response()
    await handler({
      method: 'POST', headers: { cookie: `syllo_owner=${'x'.repeat(43)}` },
      body: { ...validBody, preference_digest: preferenceDigest(preferences) },
    } as any, res)
    return res
  }

  const withSnapshot = await run(board)
  expect(withSnapshot.statusCode).toBe(200)
  // The same alternative also reports its per-semester load with the server's cap verdicts.
  expect(withSnapshot.body.proposal.alternatives[0].semester_loads).toEqual([
    { semester_id: 'semester_a', hours: 3, over_user_cap: false, over_hard_cap: false },
  ])
  expect(withSnapshot.body.proposal.alternatives[0].requirements_validation).toEqual(expect.objectContaining({
    planned_hours: 3, remaining_hours: 7, core_courses_selected: 1, core_courses_satisfied: true, valid: true,
  }))

  // A student cap below the plan's load is flagged by the server, not guessed by the client.
  const overCap = await run(board, 2)
  expect(overCap.statusCode).toBe(200)
  expect(overCap.body.proposal.alternatives[0].semester_loads[0]).toEqual(
    expect.objectContaining({ semester_id: 'semester_a', hours: 3, over_user_cap: true }),
  )

  const withoutSnapshot = await run({ semesters: [], metadata: {} })
  expect(withoutSnapshot.statusCode).toBe(200)
  expect(withoutSnapshot.body.proposal.alternatives[0]).not.toHaveProperty('requirements_validation')
})
