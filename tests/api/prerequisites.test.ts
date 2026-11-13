import {
  evaluatePrerequisites, loadPrerequisiteCatalog, prerequisiteRecord, shadowPrerequisiteAudit, unmetRequirements,
  type PrerequisiteCatalog, type PrerequisiteExpression,
} from '../../api/ai/prerequisites'

const c = (course: string): PrerequisiteExpression => ({ course })
const has = (...ids: string[]) => (id: string) => ids.includes(id)

describe('evaluating AND/OR prerequisite expressions', () => {
  const expression: PrerequisiteExpression = { all: [c('A'), { any: [c('B'), c('C')] }] }

  test('no requirement always holds', () => {
    expect(evaluatePrerequisites(null, has())).toBe(true)
  })

  test('AND needs every part; OR needs one alternative', () => {
    expect(evaluatePrerequisites(expression, has('A', 'C'))).toBe(true)
    expect(evaluatePrerequisites(expression, has('A'))).toBe(false)
    expect(evaluatePrerequisites(expression, has('B', 'C'))).toBe(false)
  })

  test('the unmet parts are reported as alternatives per requirement', () => {
    expect(unmetRequirements(expression, has())).toEqual([['A'], ['B', 'C']])
    expect(unmetRequirements(expression, has('A'))).toEqual([['B', 'C']])
    expect(unmetRequirements(expression, has('A', 'B'))).toEqual([])
  })
})

describe('the committed catalog (official syllabus pages)', () => {
  const catalog = loadPrerequisiteCatalog()

  test('the biological-manufacturing course carries its four official prerequisites', () => {
    expect(prerequisiteRecord(catalog, '0542-4124')).toMatchObject({
      status: 'verified',
      expression: { all: [c('0509-1815'), c('0542-3243'), c('0542-3620'), c('0542-2500')] },
    })
  })

  test('intro to finite elements needs Solids 1 OR Solids 2', () => {
    expect(prerequisiteRecord(catalog, '0542-4223').expression).toEqual({ any: [c('0542-2200'), c('0542-4224')] })
  })

  test('a course with no record is unknown, never "no prerequisites"', () => {
    expect(prerequisiteRecord(catalog, '9999-9999').status).toBe('unknown')
    expect(prerequisiteRecord(null, '0542-4223').status).toBe('unknown')
  })

  test('every record has a known status and verified ones a real expression', () => {
    for (const record of Object.values(catalog ?? {})) {
      expect(['verified', 'verified_none', 'none_listed', 'assumed_none_no_syllabus', 'not_in_catalog', 'unknown']).toContain(record.status)
      if (record.status === 'verified') expect(record.expression).not.toBeNull()
      if (record.status === 'verified_none' && record.catalog) expect(record.catalog.found).toBe(true)
    }
  })
})

describe('shadow audit: what strict enforcement would block', () => {
  const catalog: PrerequisiteCatalog = {
    INTRO: { status: 'verified_none', expression: null, corequisites: null },
    ADV: { status: 'verified', expression: c('INTRO'), corequisites: null },
    LAB: { status: 'verified', expression: null, corequisites: c('ADV') },
    NOSYL: { status: 'assumed_none_no_syllabus', expression: null, corequisites: null },
  }
  const audit = (semesters: string[][], completed: string[] = []) => shadowPrerequisiteAudit({
    semesters: semesters.map((courseIds, index) => ({ semesterId: `s${index + 1}`, courseIds })), completedCourseIds: completed, catalog,
  })

  test('a prerequisite must be completed or in a strictly earlier semester', () => {
    expect(audit([['INTRO'], ['ADV']]).wouldBlock).toEqual([])
    expect(audit([[], ['ADV']], ['INTRO']).wouldBlock).toEqual([])
    expect(audit([['INTRO', 'ADV']]).wouldBlock).toEqual([
      expect.objectContaining({ courseId: 'ADV', semesterId: 's1', unmetPrerequisites: [['INTRO']] }),
    ])
  })

  test('a corequisite may share the semester', () => {
    expect(audit([['INTRO'], ['ADV', 'LAB']]).wouldBlock).toEqual([])
    expect(audit([['INTRO'], ['LAB'], ['ADV']]).wouldBlock).toEqual([
      expect.objectContaining({ courseId: 'LAB', unmetCorequisites: [['ADV']] }),
    ])
  })

  test('unknown and assumed-none courses are listed separately, not blocked', () => {
    const result = audit([['NOSYL', 'MYSTERY']])
    expect(result).toMatchObject({ wouldBlock: [], unknown: ['MYSTERY'], assumedNone: ['NOSYL'] })
  })

  test('a course listed as both prerequisite and corequisite may be taken in the same semester', () => {
    const both: PrerequisiteCatalog = { X: { status: 'verified_none', expression: null, corequisites: null },
      Y: { status: 'verified', expression: c('X'), corequisites: c('X') } }
    const run = (semesters: string[][]) => shadowPrerequisiteAudit({ semesters: semesters.map((courseIds, i) => ({ semesterId: `s${i}`, courseIds })), completedCourseIds: [], catalog: both })
    expect(run([['X', 'Y']]).wouldBlock).toEqual([])
    expect(run([['Y'], ['X']]).wouldBlock).toHaveLength(1)
  })
})

describe('course pathways from official prerequisites', () => {
  // Imported lazily so the suites above stay independent of the planner model.
  const { coursePathway, buildSuccessorIndex } = require('../../api/ai/course_pathways')
  const { buildConstraintModel } = require('../../api/ai/planner_model')
  const { loadLocalBoardJson } = require('../../api/ai/board_loader')
  const model = buildConstraintModel(loadLocalBoardJson('mechanical_engineering_2027'), {})
  const catalog = loadPrerequisiteCatalog()!

  test('intro to finite elements leads to the industry-applications course, which is reported as not offered', () => {
    const pathway = coursePathway({ courseId: '0542-4223', model, catalog, satisfied: () => false })
    expect(pathway.prerequisite_status).toBe('verified')
    expect(pathway.unmet_prerequisites.map((group: Array<{ course_id: string }>) => group.map((item) => item.course_id)))
      .toEqual([['0542-2200', '0542-4224']])
    const followUp = pathway.leads_to.find((item: { course_id: string }) => item.course_id === '0542-4226')
    expect(followUp).toMatchObject({ in_program: true, offered: false })
    expect(followUp.not_offered_reason_he).toBeTruthy()
    expect(followUp.also_requires.map((item: { course_id: string }) => item.course_id)).toEqual(expect.arrayContaining(['0542-3620']))
  })

  test('met prerequisites are not listed as unmet', () => {
    const pathway = coursePathway({ courseId: '0542-4223', model, catalog, satisfied: (id: string) => id === '0542-2200' })
    expect(pathway.unmet_prerequisites).toEqual([])
  })

  test('the successor index only follows official prerequisite edges', () => {
    const index = buildSuccessorIndex({
      A: { status: 'verified_none', expression: null, corequisites: null },
      B: { status: 'verified', expression: { any: [{ course: 'A' }, { course: 'X' }] }, corequisites: { course: 'C' } },
      C: { status: 'verified_none', expression: null, corequisites: null },
    })
    expect(index.get('A')).toEqual(['B'])
    expect(index.get('C')).toBeUndefined()
  })
})
