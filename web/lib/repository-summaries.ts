/** Server-only batch enrichment. Reads each committed snapshot once; never performs per-course HTTP. */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { applyEnvOverrides, type CourseInsightConfig, type GradeSourceConfig } from '../../api/ai/course_insights/config'
import { gradeCourseKey, parseArazim, parseTauPlus, summarizeCourseGrades } from '../../api/ai/course_insights/grades'
import type { RawBoard } from './board'
import { adaptRepository, type RepositoryGradeSummary, type RepositoryVM } from './repository'

type Snapshot = { generated_at: string; courses: Record<string, unknown> }
type SourceSnapshot = { source: GradeSourceConfig; snapshot: Snapshot | null }

export function summarizeRepositorySnapshots(courseIds: readonly string[], sources: readonly SourceSnapshot[], options: { recentTerms: number; passingGrade: number }): Record<string, RepositoryGradeSummary | null> {
  return Object.fromEntries(courseIds.map((id) => {
    const key = gradeCourseKey(id)
    const results = sources.map(({ source, snapshot }) => {
      const parse = source.kind === 'tauplus_butterknife' ? parseTauPlus : parseArazim
      const records = parse(source.id, key, snapshot?.courses[key])
      return { source, records, status: records.length ? 'ok' as const : 'no_data' as const, ...(snapshot?.generated_at ? { snapshotAt: snapshot.generated_at } : {}) }
    })
    const summary = summarizeCourseGrades(key, results, options)
    const overall = summary.overall
    if (!overall || !Number.isFinite(overall.mean) || overall.mean < 0 || overall.mean > 100) return [id, null]
    return [id, {
      mean: overall.mean, students: overall.students, terms: overall.terms,
      years: [...new Set(summary.terms.map((term) => term.year))].sort((a, b) => a - b),
      sources: summary.sources.filter((source) => source.terms > 0).map((source) => ({ label: source.label_he, url: source.attribution_url, snapshotAt: source.snapshot_at ?? null })),
    } satisfies RepositoryGradeSummary]
  }))
}

let snapshots: Promise<{ sources: SourceSnapshot[]; options: { recentTerms: number; passingGrade: number } }> | undefined
async function readSnapshots() {
  const root = path.resolve(process.cwd(), '..') // same root convention as board-data.ts
  const config = applyEnvOverrides(JSON.parse(await readFile(path.join(root, 'data/config/course_insight_sources.json'), 'utf8')) as CourseInsightConfig)
  const sources = await Promise.all(config.grade_sources.filter((source) => source.enabled && source.snapshot_path).map(async (source): Promise<SourceSnapshot> => {
    try {
      const parsed = JSON.parse(await readFile(path.join(root, source.snapshot_path!), 'utf8')) as Snapshot
      return { source, snapshot: parsed?.courses && typeof parsed.courses === 'object' ? parsed : null }
    } catch { return { source, snapshot: null } }
  }))
  return { sources, options: { recentTerms: config.insights.recent_terms, passingGrade: config.insights.passing_grade } }
}

export async function adaptRepositoryWithSummaries(raw: RawBoard): Promise<RepositoryVM> {
  try {
    const { sources, options } = await (snapshots ??= readSnapshots())
    const ids = ((raw.metadata?.program_repository_courses ?? []) as Array<{ course_id: string }>).map((course) => course.course_id)
    return adaptRepository(raw, summarizeRepositorySnapshots(ids, sources, options))
  } catch {
    // The board's own grade evidence remains available when optional snapshots are absent.
    return adaptRepository(raw)
  }
}
