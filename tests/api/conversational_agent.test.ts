import { runConversationalAgent } from '../../api/ai/conversational_agent'
import { PlannerWorker } from '../../api/ai/planner_worker'
import type { ConstraintModel } from '../../api/ai/planner_types'
import type { CourseProfile } from '../../api/ai/course_profile'

const SEMESTER = 'year_3_semester_a'

function profile(id: string): CourseProfile {
  return {
    course_id: id, name_he: id, category_id: null, category_name_he: null,
    is_mandatory: false, course_type: 'elective', placement_policy: 'elective',
    hours: 4, offered_semesters: null, effective_allowed_semesters: [SEMESTER],
    recommended_semester: SEMESTER, allowed_semesters: null, program_allowed_semesters: null,
    prerequisites: [], corequisites: [], syllabus_url: null, syllabus_available: false,
    syllabus_summary_he: null, syllabus_topics_he: [], assessment_type: null,
    workload_score: null, difficulty_score: 3, difficulty_level: null, grade_average: null,
    is_wanted: false, is_unwanted: false, excluded: false, exclusion_reason: null,
    data_confidence: 1,
    provenance: { source: null, data_quality: null, offering_source_url: null, name_source: null },
  }
}

function createWorker() {
  const profiles = new Map<string, CourseProfile>([['E-1', profile('E-1')]])
  const model: ConstraintModel = {
    profiles, knownSemesterIds: [SEMESTER], completedCourseIds: new Set(),
    requiredMandatoryCourseIds: [], categories: [], degreeRequiredHours: 4, priorHours: 0,
    maxHoursPerSemester: 22, hardCap: 26, disallowedCourseIds: new Set(),
    pinnedCourseIds: new Set(), wantedCourseIds: new Set(),
  }
  return new PlannerWorker(model)
}

const transcript = [{ role: 'user' as const, text: 'תציע לי תוכנית מאוזנת' }]

test('the model can orchestrate deterministic tools and returns only a draft plan', async () => {
  const result = await runConversationalAgent({ transcript, createWorker }, {
    model: {} as never,
    generate: async ({ tools }) => {
      await tools.add_course.execute!({ courseId: 'E-1', semesterId: SEMESTER }, {} as never)
      await tools.finalize_plan.execute!({}, {} as never)
      return { text: 'הכנתי חלופה חוקית ומאוזנת.' }
    },
  })

  expect(result.outcome).toBe('proposal')
  if (result.outcome !== 'proposal') throw new Error('expected proposal')
  expect(result.draftPlan.semesters[SEMESTER]).toEqual(['E-1'])
  expect(result.events).toEqual(expect.arrayContaining([
    { type: 'tool_status', tool: 'add_course', status: 'completed' },
  ]))
  expect(result).not.toHaveProperty('committedBoard')
})

test('an invalid tool action is rejected without corrupting worker state', async () => {
  const result = await runConversationalAgent({ transcript, createWorker }, {
    model: {} as never,
    generate: async ({ tools }) => {
      const rejected = await tools.add_course.execute!({ courseId: 'E-1', semesterId: 'unknown_semester' }, {} as never)
      expect(rejected.accepted).toBe(false)
      return { text: 'הפעולה נדחתה לפי כללי התואר.' }
    },
  })

  if (result.outcome !== 'proposal') throw new Error('expected proposal')
  expect(result.draftPlan.semesters[SEMESTER]).toEqual(['E-1'])
  expect(result.events).toContainEqual({ type: 'tool_status', tool: 'add_course', status: 'rejected' })
})

test('provider failure discards the isolated draft and returns truthful unavailability', async () => {
  const result = await runConversationalAgent({ transcript, createWorker }, {
    model: {} as never,
    generate: async ({ tools }) => {
      await tools.add_course.execute!({ courseId: 'E-1', semesterId: SEMESTER }, {} as never)
      throw new Error('secret provider detail')
    },
  })

  expect(result).toEqual(expect.objectContaining({ outcome: 'assistant_unavailable' }))
  expect(result).not.toHaveProperty('draftPlan')
  expect(JSON.stringify(result)).not.toContain('secret provider detail')
})
