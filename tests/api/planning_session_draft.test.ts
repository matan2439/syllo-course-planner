import { RunContext, type FunctionTool } from '@openai/agents'
import { loadLocalBoardJson } from '../../api/ai/board_loader'
import { clarifyForAcademicDecision, extractClarificationContext } from '../../api/ai/academic_decision_runtime'
import { PlanningSession } from '../../api/ai/agent/session'
import { buildAgentTools } from '../../api/ai/agent/tools'
import { placedCourseIds } from '../../api/ai/planner_types'
import { InMemoryPlannerSessionStore } from '../../api/ai/planner_session_store'
import { agentTranscript, finishSessionTurn, foldIntoSummary, startSessionTurn } from '../../api/ai/planning_session_service'
import { SESSION_LIMITS, emptyPlanningSession, planningSessionSchema, type DraftChange, type PlanningSessionState } from '../../shared/planner/planning-session'

// Fixture: MAND (mandatory, year 3A) and interchangeable core electives ALPHA / BETA (year 4).
const PROGRAM = 'test_program_intent_2027'
const OWNER = 'auth:11111111-1111-4111-8111-111111111111'
const status = { completed: [], currently_taking: [], planned: [], completed_knowledge: { status: 'known', provenance: 'explicit_user' } }
const ctx = (semesters: any[] = []) => ({ semesters, total_hours_progress: { known_completed_hours: 177 }, personal_status: status })
const PREFS = { disallowed_course_ids: [], __preferred_courses_answered: true }
const BOARD = { version: 'v1', semesters: [{ semesterId: 'year_3_semester_a', courseIds: ['MAND'] }, { semesterId: 'year_4_semester_a', courseIds: [] }] }

async function open(restored?: PlanningSessionState, committed = [{ id: 'year_3_semester_a', courses: [{ course_id: 'MAND' }] }], preferences: Record<string, unknown> = PREFS, dropped: DraftChange[] = []) {
  const context = ctx(committed)
  return new PlanningSession({
    programId: PROGRAM, programBoard: loadLocalBoardJson(PROGRAM), planContext: context, committedContext: context, preferences,
    clarification: await clarifyForAcademicDecision(extractClarificationContext(context, preferences, undefined)),
    ...(restored ? { restoredSession: restored, droppedDraftChanges: dropped } : {}),
  })
}
async function tool(session: PlanningSession, name: string, args: Record<string, unknown>) {
  const found = buildAgentTools().find((candidate) => candidate.name === name) as unknown as FunctionTool<PlanningSession>
  const out = await found.invoke(new RunContext(session), JSON.stringify(args))
  return typeof out === 'string' ? JSON.parse(out) : out
}
const build = (session: PlanningSession, extra: Record<string, unknown> = {}) => tool(session, 'build_plan', { only_years: null, start_over: null, ...extra })
const planned = (session: PlanningSession) => [...new Set(placedCourseIds(session.worker.getPlan()))].sort()

describe('the draft is what the conversation keeps', () => {
  test('only the changes against the committed board are kept, never a copy of the board', async () => {
    const session = await open()
    await build(session)
    const changes = session.draftChanges()
    expect(changes.length).toBeGreaterThan(0)
    expect(changes.every((change) => change.kind === 'add')).toBe(true)
    expect(changes.some((change) => change.course_id === 'MAND')).toBe(false)
    expect(planningSessionSchema.safeParse(session.planningState()).success).toBe(true)
  })

  test('a returning student gets the same draft back, around the same committed board', async () => {
    const first = await open()
    await build(first)
    const second = await open(first.planningState())
    expect(planned(second)).toEqual(planned(first))
    expect(second.notReapplied).toEqual([])
    expect(second.lockViolations()).toEqual([])
  })

  test('refining does not restart: a preference change keeps what was already drafted', async () => {
    const session = await open()
    await build(session)
    const before = planned(session)
    await tool(session, 'update_preferences', { max_weekly_hours: 24, add_wanted_course_ids: null, remove_wanted_course_ids: null, add_avoided_course_ids: null,
      remove_avoided_course_ids: null, semester_distribution: null, focus_areas: null, free_days: null, excluded_courses_answered: null, preferred_courses_answered: null })
    expect(planned(session)).toEqual(before)
  })

  test('build_plan refines the current draft; start_over goes back to the committed board', async () => {
    const session = await open()
    await build(session)
    expect(planned(session).length).toBeGreaterThan(1)
    await tool(session, 'decide_on_suggestions', { accept_course_ids: null, reject_course_ids: ['ALPHA'], student_words_he: 'לא אלפא' })
    expect(planned(session)).not.toContain('ALPHA')
    await build(session, { start_over: true })
    expect(planned(session)).not.toContain('ALPHA') // still avoided: a rejection is not forgotten by starting over
  })
})

describe('accepting and rejecting individual suggestions', () => {
  test('an accepted suggestion stays exactly where it is through later refinement', async () => {
    const session = await open()
    await build(session)
    const pick = session.draftChanges().find((change) => change.kind === 'add')!
    const result = await tool(session, 'decide_on_suggestions', { accept_course_ids: [pick.course_id], reject_course_ids: null, student_words_he: 'כן, את זה' })
    expect(result).toMatchObject({ accepted: true, accepted_courses: [{ course_id: pick.course_id }] })
    await tool(session, 'update_planning_profile', { priorities: [{ id: 'load_balance', weight: 0.9, basis: 'stated' }], directions: null, free_days: null,
      max_weekly_hours: null, specialization_may_exceed_preferred_load: null, decision_he: 'עומס מאוזן חשוב' })
    await build(session)
    const kept = session.draftChanges().find((change) => change.course_id === pick.course_id)
    expect(kept).toMatchObject({ kind: 'add', semester_id: pick.semester_id, accepted: true })
  })

  test('an accepted suggestion survives to the next conversation, and is still pinned there', async () => {
    const session = await open()
    await build(session)
    const pick = session.draftChanges().find((change) => change.kind === 'add')!
    await tool(session, 'decide_on_suggestions', { accept_course_ids: [pick.course_id], reject_course_ids: null, student_words_he: 'כן' })
    const next = await open(session.planningState())
    expect(next.acceptedCourseIds.has(pick.course_id)).toBe(true)
    expect(next.model.pinnedCourseIds.has(pick.course_id)).toBe(true)
  })

  test('a rejected suggestion leaves the draft, is avoided from now on, and is remembered', async () => {
    const session = await open()
    await build(session)
    const victim = session.draftChanges().find((change) => change.kind === 'add' && change.course_id !== 'MAND')!.course_id
    const result = await tool(session, 'decide_on_suggestions', { accept_course_ids: null, reject_course_ids: [victim], student_words_he: 'לא' })
    expect(result.rejected_courses).toEqual([expect.objectContaining({ course_id: victim })])
    expect(planned(session)).not.toContain(victim)
    expect(session.preferences.disallowed_course_ids).toContain(victim)
    expect(session.planning.decisions.at(-1)?.summary_he).toMatch(/נדחו/)
  })

  test('a committed course cannot be "rejected" — that is an unlock, which needs the student\'s explicit word', async () => {
    const session = await open()
    const result = await tool(session, 'decide_on_suggestions', { accept_course_ids: null, reject_course_ids: ['MAND'], student_words_he: 'x' })
    expect(result).toMatchObject({ accepted: false })
    expect(planned(session)).toContain('MAND')
  })
})

describe('priorities change through the conversation, without breaking the rules', () => {
  const profile = (session: PlanningSession) => session.planning.profile
  const update = (session: PlanningSession, args: Record<string, unknown>) => tool(session, 'update_planning_profile',
    { priorities: null, directions: null, free_days: null, max_weekly_hours: null, specialization_may_exceed_preferred_load: null, decision_he: null, ...args })

  test('a stated priority counts at once; an inferred one waits for the student', async () => {
    const session = await open()
    const stated = await update(session, { priorities: [{ id: 'campus_days', weight: 0.95, basis: 'stated' }] })
    expect(stated.priorities_in_order[0]).toBe('campus_days')
    const inferred = await update(session, { priorities: [{ id: 'free_days', weight: 1, basis: 'inferred' }] })
    expect(inferred.priorities_in_order).not.toContain('free_days')
    expect(inferred.awaiting_confirmation).toEqual(['free_days'])
  })

  test('"specialization even if a semester is harder" is recorded as a choice, with the direction and a decision line', async () => {
    const session = await open()
    await update(session, { directions: [{ label_he: 'אלמנטים סופיים', anchor_course_ids: ['ALPHA'], basis: 'stated' }],
      specialization_may_exceed_preferred_load: true, decision_he: 'התמחות לפני עומס' })
    expect(profile(session).specialization_may_exceed_preferred_load).toBe(true)
    expect(profile(session).directions).toEqual([expect.objectContaining({ label_he: 'אלמנטים סופיים', confirmed: true })])
    expect(session.planning.decisions.map((d) => d.summary_he)).toContain('התוכנית לפני עומס'.replace('התוכנית', 'התמחות'))
  })

  test('an inferred direction is not confirmed until the student says so', async () => {
    const session = await open()
    await update(session, { directions: [{ label_he: 'מכניקה חישובית', anchor_course_ids: [], basis: 'inferred' }] })
    expect(profile(session).directions[0]).toMatchObject({ confirmed: false, source: 'inferred' })
  })

  test('an unknown course cannot anchor a direction', async () => {
    const session = await open()
    expect(await update(session, { directions: [{ label_he: 'x', anchor_course_ids: ['NOPE'], basis: 'stated' }] })).toMatchObject({ accepted: false })
  })

  test('free days and a weekly load reach the planner\'s own preferences', async () => {
    const session = await open()
    await update(session, { free_days: ['ה'], max_weekly_hours: 18 })
    expect(session.preferences).toMatchObject({ free_days: ['ה'], max_weekly_hours: 18 })
  })

  test('none of it can touch a committed course', async () => {
    const session = await open()
    await update(session, { priorities: [{ id: 'specialization', weight: 1, basis: 'stated' }], specialization_may_exceed_preferred_load: true })
    await build(session)
    expect(session.lockViolations()).toEqual([])
    expect(planned(session)).toContain('MAND')
  })
})

describe('the committed board moving under a saved draft', () => {
  test('changes the board has overtaken are dropped and reported; the student is told', async () => {
    const first = await open()
    await build(first)
    const added = first.draftChanges().find((change) => change.kind === 'add')!.course_id
    const store = new InMemoryPlannerSessionStore()
    await store.save({ ownerId: OWNER, programId: PROGRAM, state: { ...first.planningState(), base_board_version: 'v1' }, expectedRevision: null })
    // The student placed that very course by hand since: the board moved to v2.
    const liveBoard = { version: 'v2', semesters: [{ semesterId: 'year_3_semester_a', courseIds: ['MAND'] }, { semesterId: 'year_4_semester_a', courseIds: [added] }] }
    const start = await startSessionTurn({ store, ownerId: OWNER, programId: PROGRAM, board: liveBoard })
    expect(start.dropped.map((change) => change.course_id)).toContain(added)
    const second = await open(start.state!, [{ id: 'year_3_semester_a', courses: [{ course_id: 'MAND' }] }, { id: 'year_4_semester_a', courses: [{ course_id: added }] }], PREFS, start.dropped)
    const context = await tool(second, 'get_student_context', {})
    expect(context.data.planning_session.draft_changes_no_longer_applicable.map((c: { course_id: string }) => c.course_id)).toContain(added)
    expect(second.lockViolations()).toEqual([])
  })

  test('a saved course the planner can no longer place is reported, not forced', async () => {
    const first = await open()
    await build(first)
    const state = first.planningState()
    // Next time the student has since avoided every elective: replay refuses them.
    const second = await open(state, undefined, { ...PREFS, disallowed_course_ids: ['ALPHA', 'BETA'] })
    expect(planned(second)).not.toContain('ALPHA')
    expect(second.notReapplied.length).toBeGreaterThan(0)
    expect(second.notReapplied.every((change) => ['ALPHA', 'BETA'].includes(change.course_id) || change.kind === 'add')).toBe(true)
  })
})

describe('session service', () => {
  const NOW = Date.UTC(2026, 10, 15)
  test('the first turn has no memory and uses the client transcript', () => {
    const requested = [{ role: 'user' as const, text: 'שלום' }]
    expect(agentTranscript(null, requested)).toEqual(requested)
  })

  test('later turns use the stored window plus only the new message, and a resent message is not doubled', () => {
    const state: PlanningSessionState = { ...emptyPlanningSession(PROGRAM, 'v1', 'now'), recent_turns: [{ role: 'user', text: 'א' }, { role: 'assistant', text: 'ב' }] }
    expect(agentTranscript(state, [{ role: 'user', text: 'ג' }])).toEqual([{ role: 'user', text: 'א' }, { role: 'assistant', text: 'ב' }, { role: 'user', text: 'ג' }])
    const resent: PlanningSessionState = { ...state, recent_turns: [...state.recent_turns, { role: 'user', text: 'ג' }] }
    expect(agentTranscript(resent, [{ role: 'user', text: 'ג' }])).toHaveLength(3)
  })

  test('the summary stays inside its limit however much is folded in, keeping the newest', () => {
    let summary = ''
    for (let i = 0; i < 400; i++) summary = foldIntoSummary(summary, [{ role: 'user', text: `הודעה מספר ${i} `.repeat(30) }])
    expect(summary.length).toBeLessThanOrEqual(SESSION_LIMITS.summaryChars)
    expect(summary).toContain('399')
    expect(summary).not.toContain('הודעה מספר 0 ')
  })

  test('finishing a turn saves it, a stale second save is refused, and an unavailable store is not fatal', async () => {
    const store = new InMemoryPlannerSessionStore()
    const session = await open()
    const start = await startSessionTurn({ store, ownerId: OWNER, programId: PROGRAM, board: BOARD, now: NOW })
    const save = (s = start) => finishSessionTurn({ store, ownerId: OWNER, programId: PROGRAM, start: s, session, userText: 'שלום', assistantText: 'היי', board: BOARD, now: NOW })
    expect(await save()).toBe('saved')
    expect(await save()).toBe('conflict') // the same stale start again: a second tab
    const broken = { load: async () => { throw new Error('x') }, save: async () => { throw new Error('x') }, delete: async () => undefined }
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const down = await startSessionTurn({ store: broken, ownerId: OWNER, programId: PROGRAM, board: BOARD })
    expect(down.unavailable).toBe(true)
    expect(await finishSessionTurn({ store: broken, ownerId: OWNER, programId: PROGRAM, start: down, session, userText: 'a', assistantText: 'b', board: BOARD })).toBe('skipped')
  })

  test('a board that moved since the last turn is rebased before the agent sees it', async () => {
    const store = new InMemoryPlannerSessionStore()
    const state = { ...emptyPlanningSession(PROGRAM, 'v1', 'now'), draft_changes: [{ kind: 'add' as const, course_id: 'ALPHA', semester_id: 'year_4_semester_a', accepted: false }] }
    await store.save({ ownerId: OWNER, programId: PROGRAM, state, expectedRevision: null, now: NOW })
    const moved = { version: 'v2', semesters: [{ semesterId: 'year_4_semester_a', courseIds: ['ALPHA'] }] }
    const start = await startSessionTurn({ store, ownerId: OWNER, programId: PROGRAM, board: moved, now: NOW })
    expect(start.state?.base_board_version).toBe('v2')
    expect(start.dropped.map((change) => change.course_id)).toEqual(['ALPHA'])
  })
})
