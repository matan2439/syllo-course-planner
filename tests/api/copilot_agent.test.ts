import { RunContext, type FunctionTool } from '@openai/agents'
import { loadLocalBoardJson } from '../../api/ai/board_loader'
import { clarifyForAcademicDecision, extractClarificationContext } from '../../api/ai/academic_decision_runtime'
import { PlanningSession } from '../../api/ai/agent/session'
import { runPlannerAgent } from '../../api/ai/agent/planner_agent'
import { buildAgentTools, READ_ONLY_AGENT_TOOLS } from '../../api/ai/agent/tools'
import type { CourseInsightsProvider } from '../../api/ai/course_insights'
import { placedCourseIds } from '../../api/ai/planner_types'
import { streamCourseAdvisor } from '../../api/ai/agent/course_advisor'
import { withCompletedCredit } from '../../api/ai/conversation_clarification'
import { FailingAgentModel, FakeAgentModel, HangingAgentModel } from './helpers/fake_agent_model'

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

const KNOWN_COURSE_PREFERENCES = { disallowed_course_ids: [], __preferred_courses_answered: true }
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
    [{ tool: 'ask_student', args: { question_he: 'כמה שעות שבועיות נוח לך?', options_he: ['18', '22'], question_id: 'max_weekly_hours', asks_preferred_courses: null } }],
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
  const submit = { tool: 'submit_proposal', args: { summary_he: 'תוכנית מלאה', tradeoffs_he: [], extra_hours_reason_he: null } }
  const model = new FakeAgentModel([[submit], [{ tool: 'build_plan', args: { only_years: null } }], [submit]])
  const result = await runPlannerAgent({ transcript, session: await newSession(KNOWN_COURSE_PREFERENCES) }, { model })

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
  const session = await newSession({ __preferred_courses_answered: true })
  const model = new FakeAgentModel([
    [{ tool: 'update_preferences', args: {
      max_weekly_hours: null, add_wanted_course_ids: null, remove_wanted_course_ids: null,
      add_avoided_course_ids: ['ALPHA'], remove_avoided_course_ids: null,
      semester_distribution: null, focus_areas: null, free_days: null, excluded_courses_answered: null, preferred_courses_answered: null,
    } }],
    [{ tool: 'build_plan', args: { only_years: null } }],
    [{ tool: 'submit_proposal', args: { summary_he: 'בלי אלפא', tradeoffs_he: [], extra_hours_reason_he: null } }],
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
  }, { model, onTextDelta: (text) => { deltas.push(text) } })

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
    add_avoided_course_ids: null, remove_avoided_course_ids: null, semester_distribution: null, focus_areas: null, free_days: null, excluded_courses_answered: null, preferred_courses_answered: null,
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

const fakeInsights: CourseInsightsProvider = {
  grades: async (courseId) => ({
    course_key: courseId, has_data: true, passing_grade: 60,
    sources: [{ id: 'src', label_he: 'מקור', attribution_url: null, status: 'ok', terms: 1 }],
    overall: { mean: 81.5, median: 83, pass_rate: 92, students: 120, terms: 1 },
    recent: { mean: 81.5, median: 83, pass_rate: 92, students: 120, terms: 1 },
    trend: null, lecturers: [],
    terms: [{ year: 2026, term: 'a', mean: 81.5, median: 83, std: 9, students: 120, pass_rate: 92, lecturers: [], bins: [{ from: 0, to: 100, percent: 100 }], source: 'src' }],
  }),
  syllabus: async (courseId, board) => ({ course_id: courseId, board, live: null, live_unavailable_reason: 'no_syllabus_url' }),
}

test('the course panel runs the co-pilot engine in course mode: read-only tools, history and focus course forwarded', async () => {
  const model = new FakeAgentModel([
    [{ tool: 'get_course_details', args: { course_id: 'BETA', target_semester: null } }],
    [{ text: 'בטא הוא קורס ליבה של 4 שעות ' }, { text: 'ללא דרישות קדם.' }],
  ])
  const advisor = await streamCourseAdvisor(
    {
      message: 'מה צריך לפני בטא?', programId: PROGRAM_ID, planContext, courseContext: 'קוד קורס: BETA', courseId: 'BETA',
      history: [{ role: 'user', content: 'שאלה קודמת על בטא' }, { role: 'assistant', content: 'תשובה קודמת' }],
    },
    { model, insights: fakeInsights },
  )
  let text = ''
  const reader = advisor.textStream.getReader()
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) text += chunk.value
  await advisor.completed

  expect(text).toBe('בטא הוא קורס ליבה של 4 שעות ללא דרישות קדם.')
  const toolNames = (model.requests[0].tools ?? []).map((tool: any) => tool.name).sort()
  expect(toolNames).toEqual([...READ_ONLY_AGENT_TOOLS].sort())
  for (const mutating of ['build_plan', 'add_course', 'update_preferences', 'record_completed_courses', 'submit_proposal']) {
    expect(toolNames).not.toContain(mutating)
  }
  const input = JSON.stringify(model.requests[0].input)
  expect(input).toContain('קוד קורס: BETA')
  expect(input).toContain('Course in focus: BETA')
  expect(input.indexOf('שאלה קודמת על בטא')).toBeLessThan(input.indexOf('מה צריך לפני בטא?'))
  expect(input).toContain('תשובה קודמת')
})

test('running out of turns is a conversation reply, not an unavailable assistant', async () => {
  const model = new FakeAgentModel(Array.from({ length: 40 }, () => [{ tool: 'get_student_context' }]))
  const result = await runPlannerAgent({ transcript, session: await newSession() }, { model })

  expect(result.outcome).toBe('conversation')
  expect(result.messageHe).toContain('עצרתי לפני שסיימתי')
  expect(result.events).toEqual(expect.arrayContaining([
    { type: 'tool_status', tool: 'get_student_context', status: 'completed' },
  ]))
  // Only the "stopped early" note reached the student: nothing billable.
  expect((result as { usage?: unknown }).usage).toBeUndefined()
})

test('running out of turns after streaming text carries usage, so the partial answer is charged', async () => {
  const model = new FakeAgentModel(Array.from({ length: 40 }, () => [{ text: 'בודק. ' }, { tool: 'get_student_context' }]))
  const result = await runPlannerAgent({ transcript, session: await newSession() }, { model })

  expect(result.outcome).toBe('conversation')
  expect(result.messageHe).toContain('בודק.')
  expect(result.messageHe).toContain('עצרתי לפני שסיימתי')
  expect((result as { usage?: unknown }).usage).toBeDefined()
})

test('get_course_grades and get_course_syllabus answer from the insights provider', async () => {
  const session = new PlanningSession({ ...(await newSession()).input, insights: fakeInsights })
  const batch = await callTool(session, 'get_course_grades', { course_ids: ['BETA', 'ALPHA', 'BETA'], max_terms: null })
  expect(batch.courses.map((course: { course_id: string }) => course.course_id)).toEqual(['BETA', 'ALPHA'])
  const grades = batch.courses[0]
  expect(grades).toEqual(expect.objectContaining({ course_id: 'BETA', name_he: 'בטא', has_data: true }))
  expect(grades.overall.mean).toBe(81.5)
  expect(grades.terms[0]).not.toHaveProperty('bins')

  const syllabus = await callTool(session, 'get_course_syllabus', { course_id: 'BETA' })
  expect(syllabus).toEqual(expect.objectContaining({ course_id: 'BETA', name_he: 'בטא', live: null }))
  expect(syllabus.board).toEqual(expect.objectContaining({ topics_he: expect.any(Array) }))
  expect(await callTool(session, 'get_course_syllabus', { course_id: 'NOPE' })).toEqual({ course_id: 'NOPE', known: false })
})

describe('courses to leave out: asked at most twice, silence then counts as none', () => {
  const noPrefs = {
    max_weekly_hours: null, add_wanted_course_ids: null, remove_wanted_course_ids: null,
    add_avoided_course_ids: null, remove_avoided_course_ids: null,
    semester_distribution: null, focus_areas: null, free_days: null, preferred_courses_answered: null,
  }
  const askLeaveOut = { question_he: 'יש קורסים שתרצה להוציא?', options_he: [], question_id: 'excluded_courses', asks_preferred_courses: null }

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
    const output = await callTool(session, 'record_completed_courses', { include_years: [1, 2], add_course_ids: null, remove_course_ids: null })

    expect(output).toEqual(expect.objectContaining({ accepted: true, completed_count: 24 }))
    expect(output.completed_credit_hours).toBeGreaterThan(85)
    expect(output.degree_hours_counted).toBeGreaterThan(85)
    expect(session.academicStatusChanged).toBe(true)
    expect(session.missingCriticalInputs().map((input) => input.field)).not.toContain('completedCourses')
  })

  test('"I finished year 1" records only the official Year 1 courses', async () => {
    const session = await meSession()
    const output = await callTool(session, 'record_completed_courses', { include_years: [1], add_course_ids: null, remove_course_ids: null })
    expect(output).toEqual(expect.objectContaining({ accepted: true, completed_count: 13 }))
    expect(session.completedCourseIds()).toContain('0542-1510') // official id, not the retired 0509-1510
    expect(session.completedCourseIds()).not.toContain('0542-2110') // Year 2
  })

  test('a first-semester student records "nothing completed" and is not asked again', async () => {
    const session = await meSession()
    const output = await callTool(session, 'record_completed_courses', { include_years: null, add_course_ids: null, remove_course_ids: null })
    expect(output).toEqual(expect.objectContaining({ accepted: true, completed_count: 0 }))
    expect(session.missingCriticalInputs().map((input) => input.field)).not.toContain('completedCourses')
  })

  test('the student context carries the degree year and the semester they are in', async () => {
    const context = { semesters: [], personal_status: { completed: [], currently_taking: [], planned: [] } }
    const session = new PlanningSession({
      programId: ME, programBoard: loadLocalBoardJson(ME), planContext: context, committedContext: context, currentDegreeYear: 2,
      preferences: {}, clarification: { needsClarification: false, missingInputs: [], questions: [] },
    })
    const { data: output } = await callTool(session, 'get_student_context', {})
    expect(output.current_degree_year).toBe(2)
    expect(output.current_semester_id).toMatch(/^year_2_semester_[ab]$/)
    expect(output.planning_window).toBe('years_3_4')
  })

  test('a course the student has not finished can be taken out, and unknown ids are refused', async () => {
    const session = await meSession()
    await callTool(session, 'record_completed_courses', { include_years: [1, 2], add_course_ids: null, remove_course_ids: null })
    const output = await callTool(session, 'record_completed_courses', { include_years: null, add_course_ids: null, remove_course_ids: ['0509-2846'] })
    expect(output.completed_count).toBe(23)
    expect(session.completedCourseIds()).not.toContain('0509-2846')
    expect(await callTool(session, 'record_completed_courses', { include_years: null, add_course_ids: ['NOPE'], remove_course_ids: null }))
      .toEqual(expect.objectContaining({ accepted: false, unknown_course_ids: ['NOPE'] }))
  })

  test('removing a completed course lowers the credit, while hand-entered extra credit is kept', () => {
    const withTwo = withCompletedCredit({ personal_status: { completed: [{ course_id: '0542-1510' }, { course_id: '0509-1624' }] } }, ME, null)
    expect(withTwo.total_hours_progress).toEqual(expect.objectContaining({ known_completed_hours: 10.5 }))
    const withOne = withCompletedCredit({ ...withTwo, personal_status: { completed: [{ course_id: '0542-1510' }] } }, ME, null)
    expect(withOne.total_hours_progress).toEqual(expect.objectContaining({ known_completed_hours: 4 }))

    const manual = { ...withTwo, total_hours_progress: { ...(withTwo.total_hours_progress as object), known_completed_hours: 120 } }
    const stillManual = withCompletedCredit({ ...manual, personal_status: { completed: [{ course_id: '0542-1510' }] } }, ME, null)
    expect(stillManual.total_hours_progress).toEqual(expect.objectContaining({ known_completed_hours: 120 }))
  })

  test('a context saved before the credit marker still lowers credit on removal', () => {
    // Stored by the previous release: derived 10.5h, no marker.
    const legacy = {
      personal_status: { completed: [{ course_id: '0542-1510' }] },
      total_hours_progress: { known_completed_hours: 10.5 },
    }
    const next = withCompletedCredit(legacy, ME, null, ['0542-1510', '0509-1624'])
    expect(next.total_hours_progress).toEqual(expect.objectContaining({ known_completed_hours: 4, completed_courses_credit_hours: 4 }))
    // …and a later edit does not resurrect the old total as "manual" credit.
    const later = withCompletedCredit({ ...next, personal_status: { completed: [{ course_id: '0542-1510' }, { course_id: '0509-1815' }] } }, ME, null)
    expect(later.total_hours_progress).toEqual(expect.objectContaining({ known_completed_hours: 7 }))
  })

  test('withCompletedCredit keeps larger hand-entered credit', () => {
    const base = { personal_status: { completed: [{ course_id: '0542-1510' }] } }
    expect(withCompletedCredit(base, ME, null).total_hours_progress).toEqual(expect.objectContaining({ known_completed_hours: 4 }))
    expect(withCompletedCredit({ ...base, total_hours_progress: { known_completed_hours: 100 } }, ME, null).total_hours_progress)
      .toEqual(expect.objectContaining({ known_completed_hours: 100 }))
  })
})

test('a run past its deadline answers with what it has instead of cutting the stream', async () => {
  const started = Date.now()
  const result = await runPlannerAgent(
    { transcript, session: await newSession() },
    { model: new HangingAgentModel(), deadlineMs: 200 },
  )

  expect(Date.now() - started).toBeLessThan(5_000)
  expect(result.outcome).toBe('conversation')
  expect(result.messageHe).toContain('עצרתי לפני שסיימתי')
  expect(result.events.at(-1)).toEqual(expect.objectContaining({ type: 'assistant_message' }))
})

describe('committed courses are locked', () => {
  // The board already holds MAND and ALPHA.
  const placed = { ...planContext, semesters: [{ id: 'year_3_semester_a', courses: [{ course_id: 'MAND' }, { course_id: 'ALPHA' }] }] }
  // ALPHA is offered in year 4 only: `placed` holds it in a semester it is not offered in.
  const legal = { ...planContext, semesters: [{ id: 'year_3_semester_a', courses: [{ course_id: 'MAND' }] }, { id: 'year_4_semester_a', courses: [{ course_id: 'ALPHA' }] }] }
  const submit = { summary_he: 'החלפה', tradeoffs_he: [], extra_hours_reason_he: null }

  test('a locked course in a semester it is not offered in stays put, the rest is planned, and the plan is never valid', async () => {
    const session = await newSession(KNOWN_COURSE_PREFERENCES, placed)
    expect(session.lockConflicts).toEqual([expect.objectContaining({
      code: 'locked_course_wrong_semester', courseIds: ['ALPHA'], semesterId: 'year_3_semester_a', blocksValidity: true,
      resolutionsHe: expect.arrayContaining(['לאשר העברה ל־שנה ד׳ סמסטר א׳']),
    })])
    const built = await callTool(session, 'build_plan', { only_years: null })
    expect(built).toMatchObject({ accepted: false, lock_conflicts: [expect.objectContaining({ blocks_validity: true })] })
    expect(built.validation.valid).toBe(false)
    expect(session.worker.getPlan().semesters.year_3_semester_a).toEqual(expect.arrayContaining(['MAND', 'ALPHA']))
    expect(await callTool(session, 'submit_proposal', submit)).toMatchObject({ accepted: false })
  })

  test('once the student releases it, the course can move to a semester it is offered in and the plan validates', async () => {
    const session = await newSession(KNOWN_COURSE_PREFERENCES, placed)
    await callTool(session, 'unlock_courses', { course_ids: ['ALPHA'], student_words_he: 'תעביר את אלפא לשנה ד' })
    expect(await callTool(session, 'move_course', { course_id: 'ALPHA', to_semester_id: 'year_4_semester_a' })).toMatchObject({ accepted: true })
    expect(session.hasInvalidLockedPlacement()).toBe(false)
    expect(await callTool(session, 'submit_proposal', submit)).toMatchObject({ accepted: true })
  })

  test('the agent cannot remove, move or replace a committed course on its own', async () => {
    const session = await newSession({}, placed)
    for (const [tool, args] of [
      ['remove_course', { course_id: 'ALPHA' }],
      ['move_course', { course_id: 'ALPHA', to_semester_id: 'year_4_semester_a' }],
      ['replace_course', { out_course_id: 'ALPHA', in_course_id: 'BETA', semester_id: null }],
    ] as const) {
      expect(await callTool(session, tool, args)).toMatchObject({ accepted: false, locked: true })
    }
    expect(session.worker.getPlan().semesters.year_3_semester_a).toEqual(['MAND', 'ALPHA'])
  })

  test('building a plan keeps every committed course exactly where the student put it', async () => {
    const session = await newSession(KNOWN_COURSE_PREFERENCES, placed)
    await callTool(session, 'build_plan', { only_years: null })
    expect(session.worker.getPlan().semesters.year_3_semester_a).toEqual(expect.arrayContaining(['MAND', 'ALPHA']))
    expect(session.lockViolations()).toEqual([])
    expect((await callTool(session, 'get_student_context', {})).data.locked_course_ids).toEqual(['MAND', 'ALPHA'])
  })

  test('only the courses the student released may change, and the draft survives the unlock', async () => {
    const session = await newSession({}, placed)
    await callTool(session, 'add_course', { course_id: 'BETA', semester_id: 'year_4_semester_a' })
    expect(await callTool(session, 'unlock_courses', { course_ids: ['ALPHA'], student_words_he: 'אפשר להוריד את אלפא' }))
      .toMatchObject({ accepted: true })
    expect(placedCourseIds(session.worker.getPlan())).toContain('BETA')
    expect(await callTool(session, 'remove_course', { course_id: 'MAND' })).toMatchObject({ accepted: false, locked: true })
    await callTool(session, 'remove_course', { course_id: 'ALPHA' })
    expect(placedCourseIds(session.worker.getPlan())).not.toContain('ALPHA')
    expect(await callTool(session, 'submit_proposal', submit)).toMatchObject({ accepted: true })
  })

  test('a draft that lost a locked course cannot be submitted, whatever changed it', async () => {
    const session = await newSession({}, placed)
    session.worker.removeCourse('ALPHA')
    session.worker.addCourse('BETA')
    const refused = await callTool(session, 'submit_proposal', submit)
    expect(refused).toMatchObject({ accepted: false, locked_courses_changed: [expect.objectContaining({ course_id: 'ALPHA' })] })
  })

  test('avoiding a course that is already on the board keeps it and reports the conflict', async () => {
    const session = await newSession({ disallowed_course_ids: ['ALPHA'], __preferred_courses_answered: true }, legal)
    expect(session.lockConflicts).toEqual([expect.objectContaining({ code: 'locked_course_avoided', courseIds: ['ALPHA'] })])
    const built = await callTool(session, 'build_plan', { only_years: null })
    expect(built).toMatchObject({ accepted: true, lock_conflicts: [expect.objectContaining({ code: 'locked_course_avoided' })] })
    expect(placedCourseIds(session.worker.getPlan())).toContain('ALPHA')
    await callTool(session, 'submit_proposal', submit)
    expect(session.submission?.tradeoffsHe.join(' ')).toContain('אלפא')
  })

  test('a course unlocked for removal is avoided again, so the planner does not re-add it', async () => {
    const session = await newSession({ disallowed_course_ids: ['ALPHA'], __preferred_courses_answered: true }, placed)
    await callTool(session, 'unlock_courses', { course_ids: ['ALPHA'], student_words_he: 'כן, תוריד את אלפא' })
    expect(session.lockConflicts).toEqual([])
    expect(session.model.disallowedCourseIds.has('ALPHA')).toBe(true)
  })

  test('unlock_courses refuses courses that are not on the committed board', async () => {
    const session = await newSession({}, placed)
    expect(await callTool(session, 'unlock_courses', { course_ids: ['BETA'], student_words_he: 'x' })).toMatchObject({ accepted: false })
  })
})

describe('preferred and avoided courses come before any build', () => {
  const noPrefs = {
    max_weekly_hours: null, add_wanted_course_ids: null, remove_wanted_course_ids: null,
    add_avoided_course_ids: null, remove_avoided_course_ids: null,
    semester_distribution: null, focus_areas: null, free_days: null, excluded_courses_answered: null, preferred_courses_answered: null,
  }
  const ask = { question_he: 'אילו קורסים חשוב לך לכלול, ואילו להשאיר בחוץ?', options_he: [], question_id: 'excluded_courses', asks_preferred_courses: true }

  test('build_plan is refused until the student was asked, then never asks again', async () => {
    const session = await newSession()
    const refused = await callTool(session, 'build_plan', { only_years: null })
    expect(refused).toMatchObject({ accepted: false, missing: ['preferred_courses', 'avoided_courses'] })
    expect(placedCourseIds(session.worker.getPlan())).toEqual([]) // nothing was planned

    expect(await callTool(session, 'ask_student', ask)).toEqual({ asked: true })
    // The answers are stored with the preferences, so the next turn of the conversation has them.
    const next = await newSession(session.preferences)
    await callTool(next, 'update_preferences', { ...noPrefs, add_wanted_course_ids: ['BETA'], excluded_courses_answered: true, preferred_courses_answered: true })
    expect(next.preferredCoursesKnown()).toBe(true)
    expect(next.excludedCoursesKnown()).toBe(true)
    const built = await callTool(next, 'build_plan', { only_years: null })
    expect(built.accepted).toBe(true)
    expect(placedCourseIds(next.worker.getPlan())).toContain('BETA') // preferred = in the plan

    const later = await newSession(next.preferences)
    expect(await callTool(later, 'ask_student', ask)).toMatchObject({ accepted: false })
    expect(await callTool(later, 'ask_student', { ...ask, question_id: null })).toMatchObject({ accepted: false })
    expect((await callTool(later, 'get_student_context', {})).data).toMatchObject({ preferred_courses_known: true, avoided_courses_known: true })
  })

  test('a question asked in an earlier turn and left unanswered counts as "none"; in the same turn it does not', async () => {
    const session = await newSession({ disallowed_course_ids: [] })
    await callTool(session, 'ask_student', { ...ask, question_id: null })
    expect(session.preferredCoursesKnown()).toBe(false)
    expect((await newSession(session.preferences)).preferredCoursesKnown()).toBe(true)
  })

  test('an avoided course the degree requires stays in the plan and is reported back', async () => {
    const session = await newSession(KNOWN_COURSE_PREFERENCES)
    const output = await callTool(session, 'update_preferences', { ...noPrefs, add_avoided_course_ids: ['MAND', 'ALPHA'] })
    expect(output.required_courses_kept).toEqual([expect.objectContaining({ course_id: 'MAND' })])
    expect(output.required_courses_note).toMatch(/required for the degree/)
    expect(session.preferences.disallowed_course_ids).toEqual(['ALPHA'])
    await callTool(session, 'build_plan', { only_years: null })
    const placed = placedCourseIds(session.worker.getPlan())
    expect(placed).toContain('MAND')
    expect(placed).not.toContain('ALPHA')
  })
})

describe('a partial request plans only the years the student asked for', () => {
  const yearOf = (semesterId: string) => Number(/^year_(\d+)_/.exec(semesterId)?.[1])
  const inYear = (session: PlanningSession, year: number) =>
    Object.entries(session.worker.getPlan().semesters).filter(([id]) => yearOf(id) === year).flatMap(([, ids]) => ids)
  const submit = { summary_he: 'שנה ד בלבד', tradeoffs_he: [], extra_hours_reason_he: null }
  // The year-3 mandatory course is already on the board; year 4 is still empty.
  const withYear3 = { ...planContext, semesters: [{ id: 'year_3_semester_a', courses: [{ course_id: 'MAND' }] }] }

  test('"year 4 only": new courses land only in year 4, year 3 is untouched, and the proposal passes the scope check', async () => {
    const session = await newSession(KNOWN_COURSE_PREFERENCES, withYear3)
    const built = await callTool(session, 'build_plan', { only_years: [4] })
    expect(built).toMatchObject({ accepted: true, scope_years: [4] })
    expect(inYear(session, 3)).toEqual(['MAND'])
    expect(inYear(session, 4).length).toBeGreaterThan(0)
    expect(session.outOfScopePlacements()).toEqual([])
    expect(await callTool(session, 'submit_proposal', submit)).toMatchObject({ accepted: true })
  })

  test('a requirement that only fits another year is reported, never placed there', async () => {
    // Unscoped, the planner fills year 3 with the mandatory course; scoped to year 4 it must not.
    const whole = await newSession(KNOWN_COURSE_PREFERENCES)
    await callTool(whole, 'build_plan', { only_years: null })
    expect(inYear(whole, 3)).toContain('MAND')

    const session = await newSession(KNOWN_COURSE_PREFERENCES)
    const built = await callTool(session, 'build_plan', { only_years: [4] })
    expect(inYear(session, 3)).toEqual([])
    expect(built).toMatchObject({ accepted: false, scope_years: [4] })
    expect(built.scope_note).toMatch(/Do NOT place courses in other years/)
    expect(built.validation.missing_mandatory_course_ids).toEqual(['MAND'])
    expect(await callTool(session, 'submit_proposal', submit)).toMatchObject({ accepted: false })
  })

  test('a draft that reaches outside the scope cannot be submitted', async () => {
    const session = await newSession(KNOWN_COURSE_PREFERENCES, withYear3)
    await callTool(session, 'build_plan', { only_years: [4] })
    // The final draft is checked whatever built it: against a year-3 scope these year-4 additions are outside.
    session.scopeYears = [3]
    expect(session.outOfScopePlacements().map((item) => yearOf(item.semester_id))).toEqual(expect.arrayContaining([4]))
    const refused = await callTool(session, 'submit_proposal', submit)
    expect(refused).toMatchObject({ accepted: false, out_of_scope_placements: expect.any(Array) })
    expect(refused.out_of_scope_placements.length).toBeGreaterThan(0)
  })

  test('a course the student placed in another year cannot be taken out, even when removal is allowed', async () => {
    const session = await newSession(KNOWN_COURSE_PREFERENCES, withYear3)
    await callTool(session, 'build_plan', { only_years: [4] })
    expect(session.outOfScopeRemovals()).toEqual([])
    await callTool(session, 'unlock_courses', { course_ids: ['MAND'], student_words_he: 'אפשר להוריד' })
    await callTool(session, 'remove_course', { course_id: 'MAND' })
    expect(session.outOfScopeRemovals()).toEqual([{ course_id: 'MAND', semester_id: 'year_3_semester_a' }])
    const refused = await callTool(session, 'submit_proposal', submit)
    expect(refused).toMatchObject({ accepted: false, out_of_scope_removals: [expect.objectContaining({ course_id: 'MAND' })] })
  })

  test('a year the board does not have is refused, and null plans the whole board again', async () => {
    const session = await newSession(KNOWN_COURSE_PREFERENCES)
    expect(await callTool(session, 'build_plan', { only_years: [7] })).toMatchObject({ accepted: false })
    await callTool(session, 'build_plan', { only_years: [4] })
    await callTool(session, 'build_plan', { only_years: null })
    expect(session.scopeYears).toBeUndefined()
  })
})

test('highlight_element points at known elements only and reaches the client as an event', async () => {
  const placed = { ...planContext, semesters: [{ id: 'year_3_semester_a', courses: [{ course_id: 'MAND' }] }] }
  const session = await newSession({}, placed)
  expect(await callTool(session, 'highlight_element', { target: 'course:MAND', label_he: 'מבוא' })).toMatchObject({ accepted: true })
  expect(await callTool(session, 'highlight_element', { target: 'filter:grade', label_he: 'סינון לפי ממוצע' })).toMatchObject({ accepted: true })
  expect(await callTool(session, 'highlight_element', { target: 'course:NOPE', label_he: 'x' })).toMatchObject({ accepted: false })
  expect(await callTool(session, 'highlight_element', { target: 'course:BETA', label_he: 'בטא' })).toMatchObject({ accepted: false }) // not on the board
  expect(await callTool(session, 'highlight_element', { target: 'catalog-course:BETA', label_he: 'בטא' })).toMatchObject({ accepted: true })
  expect(await callTool(session, 'highlight_element', { target: 'button:launch', label_he: 'x' })).toMatchObject({ accepted: false })
  expect(session.events.filter((event) => event.type === 'ui_highlight')).toEqual([
    { type: 'ui_highlight', target: 'course:MAND', label_he: 'מבוא' },
    { type: 'ui_highlight', target: 'filter:grade', label_he: 'סינון לפי ממוצע' },
    { type: 'ui_highlight', target: 'catalog-course:BETA', label_he: 'בטא' },
  ])
})
