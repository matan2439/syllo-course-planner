import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, relative } from 'path'
import {
  GradeStore,
  gradeCourseKey,
  parseArazim,
  parseTauPlus,
  personKey,
  summarizeCourseGrades,
  type GradeSourceResult,
} from '../../api/ai/course_insights/grades'
import { applyEnvOverrides, REPO_ROOT, type CourseInsightConfig, type GradeSourceConfig } from '../../api/ai/course_insights/config'
import { SyllabusReader, boardSyllabusOf } from '../../api/ai/course_insights/syllabus'
import { buildCourseSuggestions, createCourseInsightsProvider } from '../../api/ai/course_insights'
import type { HttpFetcher } from '../../api/ai/course_insights/http'

// Payload shapes recorded from the live sources (2026-09-27), trimmed.
const tauPlusRow = (over: Record<string, unknown>) => ({
  courseNumber: '05424010', year: 2026, semester: 1, group: 1, dueIn: 9,
  teacher: "פרופ' אבישי סינטוב, פרופ' יורם רייך", updateDate: '2026-09-07T20:02:21',
  avgGrade: 96.37, medGrade: 97.0, stdGrade: 2.58, totalStudents: 53, percentFailed: 0,
  percent_0_49: 0, percent_50_59: 0, percent_60_64: 0, percent_65_69: 0, percent_70_74: 0,
  percent_75_79: 0, percent_80_84: 0, percent_85_89: 3.77, percent_90_94: 11.32, percent_95_100: 84.91,
  ...over,
})
const arazimEntry = {
  '2021a': {
    '00': [{ moed: 0, distribution: [0, 0, 0, 0, 0, 0, 0, 9, 17, 28], mean: 93.85 }],
    '01': [{ moed: 0, distribution: [0, 0, 0, 0, 0, 0, 0, 9, 17, 28], mean: 93.85, median: 95.5, standard_deviation: 4.54 }],
  },
  '2017a': { '01': [{ moed: 0, distribution: [0, 0, 0, 0, 0, 2, 10, 40, 50, 15], mean: 85.38 }] },
}

const source = (over: Partial<GradeSourceConfig>): GradeSourceConfig => ({
  id: 'src', kind: 'tauplus_butterknife', label_he: 'מקור', url: 'https://grades.example/api',
  attribution_url: null, enabled: true, ttl_seconds: 60, timeout_ms: 1000, ...over,
})
const opts = { recentTerms: 2, passingGrade: 60 }

describe('grade adapters', () => {
  test('course key is the digits of the board id, group suffix dropped', () => {
    expect(gradeCourseKey('0542-4010')).toBe('05424010')
    expect(gradeCourseKey('0542-4010-01')).toBe('05424010')
  })

  test('TAU+ rows: bins come from the payload keys, terms map to a/b, empty sittings are dropped, lecturers split', () => {
    const records = parseTauPlus('tauplus', '05424010', [
      tauPlusRow({}),
      tauPlusRow({ year: 2014, avgGrade: 0, medGrade: 0 }),
      tauPlusRow({ year: 2025, semester: 2, teacher: 'מר א, מר א' }),
    ])
    expect(records).toHaveLength(2)
    expect(records[0]).toEqual(expect.objectContaining({ year: 2026, term: 'a', mean: 96.37, students: 53 }))
    expect(records[0].lecturers).toEqual(["פרופ' אבישי סינטוב", "פרופ' יורם רייך"])
    expect(records[0].bins).toHaveLength(10)
    expect(records[0].bins[0]).toEqual({ from: 0, to: 49, percent: 0 })
    expect(records[0].bins[9]).toEqual({ from: 95, to: 100, percent: 84.91 })
    expect(records[1].term).toBe('b')
    expect(records[1].lecturers).toEqual(['מר א'])
  })

  test('Arazim entry: equal-width bins over 0–100 from the counts, percent of the sitting', () => {
    const records = parseArazim('arazim', '05424010', arazimEntry)
    const sitting = records.find((r) => r.year === 2021 && r.group === 1)!
    expect(sitting.students).toBe(54)
    expect(sitting.bins).toHaveLength(10)
    expect(sitting.bins[9].from).toBe(90)
    expect(sitting.bins[9].to).toBe(100)
    expect(sitting.bins.reduce((sum, bin) => sum + bin.percent, 0)).toBeCloseTo(100)
  })

  test('the same lecturer in another word order is one person', () => {
    expect(personKey("פרופ' רייך יורם")).toBe(personKey("פרופ' יורם רייך"))
    expect(personKey('מר דוד כהן')).not.toBe(personKey('מר דוד לוי'))
  })
})

describe('summarizeCourseGrades', () => {
  const results = (): GradeSourceResult[] => [
    {
      source: source({ id: 'tauplus', label_he: 'TAU+' }),
      status: 'ok',
      records: parseTauPlus('tauplus', '05424010', [
        tauPlusRow({}),
        tauPlusRow({ dueIn: 1 }), // the same sitting listed twice
        tauPlusRow({ year: 2021, avgGrade: 93.85, medGrade: 95.5, totalStudents: 54, teacher: "פרופ' רייך יורם" }),
      ]),
    },
    { source: source({ id: 'arazim', kind: 'arazim_grades_json', label_he: 'ארזים' }), status: 'ok', records: parseArazim('arazim', '05424010', arazimEntry) },
  ]

  test('one row per term: the first configured source wins an overlap, the other fills older terms', () => {
    const summary = summarizeCourseGrades('05424010', results(), opts)
    expect(summary.terms.map((t) => `${t.year}${t.term}:${t.source}`)).toEqual(['2026a:tauplus', '2021a:tauplus', '2017a:arazim'])
    expect(summary.sources.map((s) => [s.id, s.terms])).toEqual([['tauplus', 2], ['arazim', 1]])
    expect(summary.terms[0].students).toBe(53) // the duplicate sitting is not double-counted
  })

  test('student-weighted aggregates, pass rate from the bins, and a trend of recent vs older terms', () => {
    const summary = summarizeCourseGrades('05424010', results(), opts)
    expect(summary.recent?.mean).toBeCloseTo((96.37 * 53 + 93.85 * 54) / 107, 1)
    expect(summary.terms[0].pass_rate).toBe(100)
    const older = summary.terms[2]
    expect(older.pass_rate).toBeCloseTo(((117 - 2) / 117) * 100, 0)
    expect(summary.trend).toEqual(expect.objectContaining({ direction: 'up', older_mean: 85.4 }))
  })

  test('a group-0 roll-up is dropped when the term has real groups', () => {
    const summary = summarizeCourseGrades('05424010', [results()[1]], opts)
    expect(summary.terms.find((t) => t.year === 2021)?.students).toBe(54)
  })

  test('lecturers are merged across name orders and sorted by how much they taught', () => {
    const summary = summarizeCourseGrades('05424010', results(), opts)
    expect(summary.lecturers[0]).toEqual(expect.objectContaining({ name: "פרופ' יורם רייך", terms: 2 }))
    expect(summary.lecturers.map((l) => l.name)).toContain("פרופ' אבישי סינטוב")
  })

  test('no data anywhere is an explicit empty summary', () => {
    const summary = summarizeCourseGrades('0', [{ source: source({}), status: 'no_data', records: [] }], opts)
    expect(summary).toEqual(expect.objectContaining({ has_data: false, overall: null, recent: null, trend: null, terms: [] }))
  })
})

describe('GradeStore', () => {
  test('a failing source is reported, the other still answers, and TAU+ is cached per course', async () => {
    const calls: string[] = []
    const fetcher: HttpFetcher = async (url) => {
      calls.push(url)
      if (url.includes('down')) throw new Error('ECONNRESET')
      return { status: 200, finalUrl: url, contentType: 'application/json', body: JSON.stringify([tauPlusRow({})]) }
    }
    const store = new GradeStore(fetcher)
    const ok = source({ id: 'up', url: 'https://up.example/api/' })
    const [a, b] = await Promise.all([
      store.fetchCourse(ok, '05424010'),
      store.fetchCourse(source({ id: 'down', url: 'https://down.example/api' }), '05424010'),
    ])
    expect(a.status).toBe('ok')
    expect(b).toEqual(expect.objectContaining({ status: 'error', records: [] }))
    expect(calls[0]).toBe('https://up.example/api/grades?courseNumber=05424010')
    await store.fetchCourse(ok, '05424010')
    expect(calls.filter((url) => url.includes('up.example'))).toHaveLength(1)
  })

  test('a whole-file source falls back to its configured local copy when the live fetch fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grades-'))
    writeFileSync(join(dir, 'grades.json'), JSON.stringify({ '05424010': arazimEntry }))
    const store = new GradeStore(async () => { throw new Error('offline') })
    const result = await store.fetchCourse(source({
      id: 'file', kind: 'arazim_grades_json', url: 'https://file.example/grades.json',
      fallback_path: relative(REPO_ROOT, join(dir, 'grades.json')),
    }), '05424010')
    expect(result.status).toBe('ok')
    expect(result.records.length).toBeGreaterThan(0)
  })
})

test('env overrides a source URL and disables sources by id', () => {
  const config = {
    grade_sources: [source({ id: 'tauplus' }), source({ id: 'arazim' })],
    syllabus: { enabled: true, lookback_years: 1, ttl_seconds: 1, timeout_ms: 1 },
  } as unknown as CourseInsightConfig
  const out = applyEnvOverrides(config, {
    COURSE_INSIGHT_TAUPLUS_URL: 'https://mirror.example/api',
    COURSE_INSIGHT_DISABLED: 'arazim, syllabus',
  })
  expect(out.grade_sources.map((s) => [s.id, s.url, s.enabled])).toEqual([
    ['tauplus', 'https://mirror.example/api', true],
    ['arazim', 'https://grades.example/api', false],
  ])
  expect(out.syllabus.enabled).toBe(false)
})

// ── syllabus ────────────────────────────────────────────────────────────────

const syllabusPage = (course: string, withContent: boolean) => `<html><body>
<div id="div_data" class="data-table">
  <div class="data-table-cell"><small class="data-table-cell-label">מספר קורס</small><span>${course}</span></div>
  <div class="data-table-cell"><small class="data-table-cell-label">מרצה</small><span>פרופ' אבישי סינטוב</span></div>
</div></div>
<section class="main-course-contents"><div id="div_dataToc" class="container">
${withContent ? '<h2>תוכן הקורס ומטרתו</h2><p>שעות: 3<br>הפרויקט עוסק בפתרון של בעיה טכנולוגית ובתכן מערכות רובוטיות.<br></p>' : ''}
</div></section>
<section><div id="div_data_Matalot"><div class="data-table-cell is-partial"><small class="data-table-cell-label">מטלות הקורס</small>
<p><strong>פרוייקט</strong></p>
 <!-- trailing template comment --></div></div></section></body></html>`

const boardRaw = {
  syllabus_url: 'https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0542401001&year=2026',
  syllabus_summary_he: 'שעות:                3 ש"ס משקל:               4',
  syllabus_assessment_he: 'פרוייקט',
  syllabus_ai_topics: ['תכן', 'רובוטיקה'],
}

describe('SyllabusReader', () => {
  const config = { enabled: true, lookback_years: 2, ttl_seconds: 60, timeout_ms: 1000 }

  test('board syllabus keeps content fields and drops a header-only summary', () => {
    const board = boardSyllabusOf(boardRaw)
    expect(board.summary_he).toBeNull()
    expect(board.topics_he).toEqual(['תכן', 'רובוטיקה'])
    expect(board.assessment_he).toBe('פרוייקט')
  })

  test('an unpublished current year falls back to the latest published year and says so', async () => {
    const requested: string[] = []
    const fetcher: HttpFetcher = async (url) => {
      requested.push(url)
      const year = new URL(url).searchParams.get('year')
      const body = year === '2026' ? syllabusPage('', false) : syllabusPage('0542-4010-01', true)
      return { status: 200, finalUrl: url, contentType: 'text/html; charset=utf-8', body }
    }
    const reader = new SyllabusReader(fetcher, config)
    const result = await reader.read('0542-4010', boardSyllabusOf(boardRaw))
    expect(requested.map((url) => new URL(url).searchParams.get('year'))).toEqual(['2026', '2025'])
    expect(result.live).toEqual(expect.objectContaining({ academic_year: 2025, from_earlier_year: true }))
    expect(result.live?.sections).toEqual([{ title: 'תוכן הקורס ומטרתו', text: expect.stringContaining('מערכות רובוטיות') }])
    expect(result.live?.assignments_he).toEqual(['פרוייקט'])
    expect(result.live?.lecturers).toEqual(["פרופ' אבישי סינטוב"])
  })

  test('a non-official host is never contacted', async () => {
    const fetcher = jest.fn()
    const reader = new SyllabusReader(fetcher, config)
    const result = await reader.read('X', boardSyllabusOf({ syllabus_url: 'https://evil.example/s?course=0542401001&year=2026' }))
    expect(fetcher).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({ live: null, live_unavailable_reason: 'host_not_allowlisted' }))
  })
})

// ── suggestions ─────────────────────────────────────────────────────────────

describe('buildCourseSuggestions', () => {
  const config = {
    insights: { max_suggestions: 3 },
    suggestion_templates_he: {
      _note: 'ignored',
      grade_trend_up: 'עלה מ-{older} ל-{recent} ב{name}',
      grades: 'ממוצע {mean} ב{name}',
      syllabus_topic: '{name} ו{topic}',
      prerequisites: 'מוכן ל{name}?',
      no_syllabus: 'אין סילבוס ל{name}',
      no_grades: 'אין ציונים ל{name}',
    },
  } as unknown as CourseInsightConfig

  test('chips follow the data the course actually has, in configured order', async () => {
    const grades = summarizeCourseGrades('05424010', [
      { source: source({}), status: 'ok', records: parseArazim('a', '05424010', arazimEntry) },
    ], { recentTerms: 1, passingGrade: 60 })
    const reader = new SyllabusReader(async () => { throw new Error('offline') }, { enabled: false, lookback_years: 0, ttl_seconds: 1, timeout_ms: 1 })
    const syllabus = await reader.read('C', boardSyllabusOf(boardRaw))
    expect(buildCourseSuggestions({ name: 'תכן', grades, syllabus, hasPrerequisites: true }, config)).toEqual([
      `עלה מ-${grades.trend?.older_mean} ל-${grades.trend?.recent_mean} בתכן`,
      `ממוצע ${grades.overall?.mean} בתכן`,
      'תכן ותכן',
    ])
    expect(buildCourseSuggestions({ name: 'ריק', grades: null, syllabus: null, hasPrerequisites: false }, config))
      .toEqual(['אין סילבוס לריק', 'אין ציונים לריק'])
  })
})

test('the provider merges every enabled source for a board course id', async () => {
  const fetcher: HttpFetcher = async (url) => ({
    status: 200, finalUrl: url, contentType: 'application/json',
    body: url.includes('file') ? JSON.stringify({ '05424010': arazimEntry }) : JSON.stringify([tauPlusRow({})]),
  })
  const provider = createCourseInsightsProvider({
    grade_sources: [source({ id: 'live' }), source({ id: 'file', kind: 'arazim_grades_json', url: 'https://file.example/g.json' })],
    syllabus: { enabled: false, lookback_years: 0, ttl_seconds: 1, timeout_ms: 1 },
    insights: { http_cache_max_age_seconds: 1, recent_terms: 4, max_suggestions: 4, passing_grade: 60 },
    user_agent: 'test',
    suggestion_templates_he: {},
  }, fetcher)
  const summary = await provider.grades('0542-4010')
  expect(summary.terms.map((t) => `${t.year}${t.term}`)).toEqual(['2026a', '2021a', '2017a'])
})
