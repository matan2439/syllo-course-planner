import { RunContext, type FunctionTool } from '@openai/agents'
import { loadLocalBoardJson } from '../../api/ai/board_loader'
import { clarifyForAcademicDecision, extractClarificationContext } from '../../api/ai/academic_decision_runtime'
import { PlanningSession } from '../../api/ai/agent/session'
import { runPlannerAgent } from '../../api/ai/agent/planner_agent'
import { buildAgentTools } from '../../api/ai/agent/tools'
import { placedCourseIds } from '../../api/ai/planner_types'
import { streamCourseAdvisor } from '../../api/ai/agent/course_advisor'
import { withCompletedCredit } from '../../api/ai/conversation_clarification'
import { FailingAgentModel, FakeAgentModel } from './helpers/fake_agent_model'

// Fixture: mandatory MAND ("מבוא") + interchangeable core electives ALPHA ("אלפא") / BETA ("בטא");
// 177 prior hours, so MAND + one elective closes the 185h degree.
const PROGRAM_ID = 'test_program_intent_2027'
const planContext = {
  semesters: [],
  total_hours_progress: { known_completed_hours: 177 },
  personal_status: {
    completed: [], currently_taking: [], planned: [],
    completed_knowledge: { status: 'known', provenance: 'explicit_user' },
  },
}

async function newSession(preferences: Record<string, unknown> = {}, context: Record<string, unknown> = planContext) {
  const clarification = await clarifyForAcademicDecision(extractClarificationContext(context, preferences, undefined))
  return new PlanningSession({
    programId: PROGRAM_ID,
    programBoard: loadLocalBoardJson(PROGRAM_ID),
    planContext: context,
    committedContext: context,
    preferences,
    clarification,
  })
}

const transcript = [{ role: 'user' as const, text: 'תבנה לי תוכנית לשנה הבאה' }]

async function callTool(session: PlanningSession, name: string, args: Record<string, unknown>) {
  const tool = buildAgentTools().find((candidate) => candidate.name === name) as unknown as FunctionTool<PlanningSession>
  const output = await tool.invoke(new RunContext(session), JSON.stringify(args))
  return typeof output === 'string' ? JSON.parse(output) : output
}

test('ask_student ends the run and surfaces a typed clarification', async () => {
  const model = new FakeAgentModel([
    [{ tool: 'get_student_context' }],
    [{ tool: 'ask_student', args: { question_he: 'כמה שעות שבועיות נוח לך?', options_he: ['18', '22'], question_id: 'max_weekly_hours' } }],
    [{ text: 'should never be requested' }],
  ])
  const result = await runPlannerAgent({ transcript, session: await newSession() }, { model })

  expect(model.requests).toHaveLength(2)
  expect(result).toEqual(expect.objectContaining({ outcome: 'conversation', nextAction: 'ask' }))
  expect(result.events).toEqual(expect.arrayContaining([
    { type: 'tool_status', tool: 'get_student_context', status: 'completed' },
    expect.objectContaining({ type: 'clarification', question_id: 'max_weekly_hours', answer_type: 'number', options_he: ['18', '22'] }),
  ]))
})

test('an invalid submit_proposal is rejected and the agent keeps working until the plan validates', async () => {
  const submit = { tool: 'submit_proposal', args: { summary_he: 'תוכנית מלאה', tradeoffs_he: [] } }
  const model = new FakeAgentModel([[submit], [{ tool: 'build_plan' }], [submit]])
  const result = await runPlannerAgent({ transcript, session: await newSession() }, { model })

  expect(model.requests).toHaveLength(3)
  expect(result.events).toEqual(expect.arrayContaining([
    { type: 'tool_status', tool: 'submit_proposal', status: 'rejected' },
  ]))
  expect(result.outcome).toBe('proposal')
  if (result.outcome !== 'proposal') throw new Error('expected proposal')
  expect(result.validation.valid).toBe(true)
  expect(placedCourseIds(result.draftPlan)).toEqual(expect.arrayContaining(['MAND']))
})

test('update_preferences binds the planner: an avoided elective is never placed', async () => {
  const session = await newSession()
  const model = new FakeAgentModel([
    [{ tool: 'update_preferences', args: {
      max_weekly_hours: null, add_wanted_course_ids: null, remove_wanted_course_ids: null,
      add_avoided_course_ids: ['ALPHA'], remove_avoided_course_ids: null,
      semester_distribution: null, focus_areas: null, free_days: null, excluded_courses_answered: null,
    } }],
    [{ tool: 'build_plan' }],
    [{ tool: 'submit_proposal', args: { summary_he: 'בלי אלפא', tradeoffs_he: [] } }],
  ])
  const result = await runPlannerAgent({ transcript, session }, { model })

  expect(result.outcome).toBe('proposal')
  if (result.outcome !== 'proposal') throw new Error('expected proposal')
  expect(placedCourseIds(result.draftPlan)).toContain('BETA')
  expect(placedCourseIds(result.draftPlan)).not.toContain('ALPHA')
  expect(session.preferencesChanged).toBe(true)
  expect(session.preferences.disallowed_course_ids).toEqual(['ALPHA'])
})

test('the transcript reaches the model as separate messages, and a plain answer ends the run', async () => {
  const model = new FakeAgentModel([[{ text: 'בשמחה, ספר לי קודם מה חשוב לך.' }]])
  const deltas: string[] = []
  const result = await runPlannerAgent({
    transcript: [
      { role: 'user', text: 'שלום' },
      { role: 'assistant', text: 'היי, איך אפשר לעזור?' },
      { role: 'user', text: 'אני רוצה לתכנן את התואר' },
    ],
    session: await newSession(),
  }, { model, onTextDelta: (text) => deltas.push(text) })

  expect(deltas.join('')).toBe('בשמחה, ספר לי קודם מה חשוב לך.')
  expect(Array.isArray(model.requests[0].input) && model.requests[0].input).toHaveLength(3)
  expect(result).toEqual(expect.objectContaining({ outcome: 'conversation', messageHe: 'בשמחה, ספר לי קודם מה חשוב לך.' }))
})

test('a provider failure fails closed', async () => {
  const result = await runPlannerAgent({ transcript, session: await newSession() }, { model: new FailingAgentModel() })
  expect(result.outcome).toBe('assistant_unavailable')
})

test('search_courses resolves a Hebrew course name to its id', async () => {
  const output = await callTool(await newSession(), 'search_courses', { query: 'בטא', category_id: null, semester_id: null, limit: null })
  expect(output.data.courses.map((course: any) => course.course_id)).toEqual(['BETA'])
})

test('get_requirements_gap lists the missing mandatory course by id and name', async () => {
  const output = await callTool(await newSession(), 'get_requirements_gap', {})
  expect(output.data.missing_mandatory).toEqual([expect.objectContaining({ course_id: 'MAND' })])
  expect(output.data.categories).toEqual([expect.objectContaining({ category_id: 'core', remaining_courses: 1 })])
})

test('update_preferences refuses unknown course ids instead of guessing', async () => {
  const session = await newSession()
  const output = await callTool(session, 'update_preferences', {
    max_weekly_hours: null, add_wanted_course_ids: ['NOPE'], remove_wanted_course_ids: null,
    add_avoided_course_ids: null, remove_avoided_course_ids: null, semester_distribution: null, focus_areas: null, free_days: null, excluded_courses_answered: null,
  })
  expect(output).toEqual(expect.objectContaining({ accepted: false, unknown_course_ids: ['NOPE'] }))
  expect(session.preferencesChanged).toBe(false)
})

test('an illegal edit is rejected by the planner', async () => {
  const output = await callTool(await newSession(), 'add_course', { course_id: 'NOPE', semester_id: null })
  expect(output.accepted).toBe(false)
})

test('simulate_changes answers "what if" on a copy and never touches the draft', async () => {
  const session = await newSession({ disallowed_course_ids: ['ALPHA'] })
  const before = JSON.stringify(session.worker.getPlan())
  const output = await callTool(session, 'simulate_changes', {
    changes: [{ kind: 'add_course', course_id: 'ALPHA', semester_id: 'year_3_semester_b' }],
  })

  expect(output.data.status).toBe('simulated')
  expect(output.data.candidate.semesters.year_3_semester_b).toContain('ALPHA')
  // An avoided course is flagged by the authoritative validator, with evidence.
  expect(output.data.validation.valid).toBe(false)
  expect(output.data.validation.evidence.disallowedCourseIds).toEqual(['ALPHA'])
  expect(JSON.stringify(session.worker.getPlan())).toBe(before)
})

test('the course advisor verifies with read-only tools and streams its answer', async () => {
  const model = new FakeAgentModel([
    [{ tool: 'get_course_details', args: { course_id: 'BETA', target_semester: null } }],
    [{ text: 'בטא הוא קורס ליבה של 4 שעות ' }, { text: 'ללא דרישות קדם.' }],
  ])
  const advisor = await streamCourseAdvisor(
    { message: 'מה צריך לפני בטא?', programId: PROGRAM_ID, planContext, courseContext: 'קוד קורס: BETA' },
    { model },
  )
  let text = ''
  const reader = advisor.textStream.getReader()
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) text += chunk.value
  await advisor.completed

  expect(text).toBe('בטא הוא קורס ליבה של 4 שעות ללא דרישות קדם.')
  const toolNames = (model.requests[0].tools ?? []).map((tool: any) => tool.name).sort()
  expect(toolNames).toEqual(['explain_constraint', 'get_course_details', 'get_requirements_gap', 'search_courses'])
  expect(JSON.stringify(model.requests[0].input)).toContain('קוד קורס: BETA')
})

describe('courses to leave out: asked at most twice, silence then counts as none', () => {
  const noPrefs = {
    max_weekly_hours: null, add_wanted_course_ids: null, remove_wanted_course_ids: null,
    add_avoided_course_ids: null, remove_avoided_course_ids: null,
    semester_distribution: null, focus_areas: null, free_days: null,
  }
  const askLeaveOut = { question_he: 'יש קורסים שתרצה להוציא?', options_he: [], question_id: 'excluded_courses' }

  test('each ask is counted; after two unanswered asks the next turn records none', async () => {
    let preferences: Record<string, unknown> = {}
    for (const expected of [1, 2]) {
      const session = await newSession(preferences)
      expect(session.excludedCoursesKnown()).toBe(false)
      const output = await callTool(session, 'ask_student', askLeaveOut)
      expect(output).toEqual({ asked: true })
      expect(session.excludedCoursesAsked()).toBe(expected)
      preferences = session.preferences
    }
    const third = await newSession(preferences)
    expect(third.preferences.disallowed_course_ids).toEqual([])
    expect(third.preferencesChanged).toBe(true)
    expect(third.missingCriticalInputs().map((input) => input.field)).not.toContain('excludedCourses')
    expect(await callTool(third, 'ask_student', askLeaveOut)).toEqual(expect.objectContaining({ accepted: false }))
  })

  test('an explicit "none" answer is recorded; untouched lists never answer the question silently', async () => {
    const session = await newSession()
    await callTool(session, 'update_preferences', { ...noPrefs, max_weekly_hours: 20, excluded_courses_answered: null })
    expect(session.preferences).not.toHaveProperty('disallowed_course_ids')
    expect(session.excludedCoursesKnown()).toBe(false)

    await callTool(session, 'update_preferences', { ...noPrefs, excluded_courses_answered: true })
    expect(session.preferences.disallowed_course_ids).toEqual([])
    expect(session.excludedCoursesKnown()).toBe(true)
  })

  test('moving a course between the wanted and avoided lists persists both lists', async () => {
    const session = await newSession({ wanted_course_ids: ['ALPHA'], disallowed_course_ids: ['BETA'] })
    await callTool(session, 'update_preferences', { ...noPrefs, add_avoided_course_ids: ['ALPHA'], excluded_courses_answered: null })
    expect(session.preferences.wanted_course_ids).toEqual([])
    expect(session.preferences.disallowed_course_ids).toEqual(['BETA', 'ALPHA'])

    await callTool(session, 'update_preferences', { ...noPrefs, add_wanted_course_ids: ['BETA'], excluded_courses_answered: null })
    expect(session.preferences.wanted_course_ids).toEqual(['BETA'])
    expect(session.preferences.disallowed_course_ids).toEqual(['ALPHA'])
  })

  test('one unanswered ask is not enough to assume none', async () => {
    const session = await newSession({ __excluded_courses_asked: 1 })
    expect(session.excludedCoursesKnown()).toBe(false)
    expect(session.preferencesChanged).toBe(false)
  })
})

describe('completed courses carry their degree credit', () => {
  const ME = 'mechanical_engineering_2027'
  const meSession = async () => {
    const context = { semesters: [], personal_status: { completed: [], currently_taking: [], planned: [] } }
    return new PlanningSession({
      programId: ME, programBoard: loadLocalBoardJson(ME), planContext: context, committedContext: context,
      preferences: {}, clarification: await clarifyForAcademicDecision(extractClarificationContext(context, {}, undefined)),
    })
  }

  test('"I finished years 1–2" records every Years 1–2 course and ~90h of credit (was 5h)', async () => {
    const session = await meSession()
    expect(session.missingCriticalInputs().map((input) => input.field)).toContain('completedCourses')
    const output = await callTool(session, 'record_completed_courses', { include_early_years: true, add_course_ids: null, remove_course_ids: null })

    expect(output).toEqual(expect.objectContaining({ accepted: true, completed_count: 24 }))
    expect(output.completed_credit_hours).toBeGreaterThan(85)
    expect(output.degree_hours_counted).toBeGreaterThan(85)
    expect(session.academicStatusChanged).toBe(true)
    expect(session.missingCriticalInputs().map((input) => input.field)).not.toContain('completedCourses')
  })

  test('a course the student has not finished can be taken out, and unknown ids are refused', async () => {
    const session = await meSession()
    await callTool(session, 'record_completed_courses', { include_early_years: true, add_course_ids: null, remove_course_ids: null })
    const output = await callTool(session, 'record_completed_courses', { include_early_years: null, add_course_ids: null, remove_course_ids: ['0509-2846'] })
    expect(output.completed_count).toBe(23)
    expect(session.completedCourseIds()).not.toContain('0509-2846')
    expect(await callTool(session, 'record_completed_courses', { include_early_years: null, add_course_ids: ['NOPE'], remove_course_ids: null }))
      .toEqual(expect.objectContaining({ accepted: false, unknown_course_ids: ['NOPE'] }))
  })

  test('removing a completed course lowers the credit, while hand-entered extra credit is kept', () => {
    const withTwo = withCompletedCredit({ personal_status: { completed: [{ course_id: '0509-1510' }, { course_id: '0509-1624' }] } }, ME, null)
    expect(withTwo.total_hours_progress).toEqual(expect.objectContaining({ known_completed_hours: 10.5 }))
    const withOne = withCompletedCredit({ ...withTwo, personal_status: { completed: [{ course_id: '0509-1510' }] } }, ME, null)
    expect(withOne.total_hours_progress).toEqual(expect.objectContaining({ known_completed_hours: 4 }))

    const manual = { ...withTwo, total_hours_progress: { ...(withTwo.total_hours_progress as object), known_completed_hours: 120 } }
    const stillManual = withCompletedCredit({ ...manual, personal_status: { completed: [{ course_id: '0509-1510' }] } }, ME, null)
    expect(stillManual.total_hours_progress).toEqual(expect.objectContaining({ known_completed_hours: 120 }))
  })

  test('withCompletedCredit keeps larger hand-entered credit', () => {
    const base = { personal_status: { completed: [{ course_id: '0509-1510' }] } }
    expect(withCompletedCredit(base, ME, null).total_hours_progress).toEqual(expect.objectContaining({ known_completed_hours: 4 }))
    expect(withCompletedCredit({ ...base, total_hours_progress: { known_completed_hours: 100 } }, ME, null).total_hours_progress)
      .toEqual(expect.objectContaining({ known_completed_hours: 100 }))
  })
})
