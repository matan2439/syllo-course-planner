/**
 * Historical grade statistics from the configured community sources, normalized
 * into one record shape, merged and summarized for the co-pilot and the course
 * panel. Sources are data (course_insight_sources.json); each adapter only knows
 * its source's payload FORMAT. Every number shown comes from a source record.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { REPO_ROOT, type GradeSourceConfig } from './config';
import type { HttpFetcher } from './http';
import { TtlCache } from './http';
import type { CourseGradeSummary, GradeAggregate, GradeBin, GradeSourceStatus, TermStats } from './types';

export type { CourseGradeSummary, GradeAggregate, GradeBin, GradeSourceStatus, TermStats } from './types';

export interface GradeRecord {
  source: string;
  /** 8-digit course key (faculty + course number). */
  courseKey: string;
  /** Year exactly as the source labels it (both sources share the convention). */
  year: number;
  /** 'a' | 'b' | 'summer' | … as the source labels it. */
  term: string;
  group: number;
  moed: number;
  /** Individual lecturer names (a source may list several per sitting). */
  lecturers: string[];
  mean: number;
  median: number | null;
  std: number | null;
  students: number | null;
  bins: GradeBin[];
  updatedAt: string | null;
}

/** The course key both sources use: digits only, faculty+course (group suffix dropped). */
export function gradeCourseKey(courseId: string): string {
  return courseId.replace(/\D/g, '').slice(0, 8);
}

/** 'A, B, A' → ['A', 'B']. */
function splitNames(list: string): string[] {
  return [...new Set(list.split(/[,;]/).map((name) => name.replace(/\s+/g, ' ').trim()).filter(Boolean))];
}

/**
 * Identity of a person's name regardless of word order or title: the same
 * lecturer appears as "פרופ' יורם רייך" and "פרופ' רייך יורם". Titles are the
 * short or punctuated tokens (פרופ', ד"ר, מר, גב').
 */
export function personKey(name: string): string {
  return name.split(' ')
    .filter((token) => token.length > 2 && !/['"׳״.]/.test(token))
    .sort()
    .join(' ') || name;
}

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

// ── adapters (payload format → GradeRecord) ─────────────────────────────────

/** TAU+ numbers semesters 1/2/3; the other source spells them a/b/summer. */
const TAUPLUS_TERMS: Record<number, string> = { 1: 'a', 2: 'b', 3: 'summer' };
const PERCENT_BIN_KEY = /^percent_(\d+)_(\d+)$/;

export function parseTauPlus(sourceId: string, courseKey: string, payload: unknown): GradeRecord[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((row: any): GradeRecord[] => {
    const mean = finite(row?.avgGrade);
    const year = finite(row?.year);
    if (mean === null || mean <= 0 || year === null) return [];
    const bins = Object.entries(row)
      .flatMap(([key, value]) => {
        const match = PERCENT_BIN_KEY.exec(key);
        const percent = finite(value);
        return match && percent !== null ? [{ from: Number(match[1]), to: Number(match[2]), percent }] : [];
      })
      .sort((a, b) => a.from - b.from);
    return [{
      source: sourceId,
      courseKey,
      year,
      term: TAUPLUS_TERMS[row.semester] ?? String(row.semester),
      group: finite(row.group) ?? 0,
      moed: finite(row.dueIn) ?? 0,
      lecturers: typeof row.teacher === 'string' ? splitNames(row.teacher) : [],
      mean,
      median: finite(row.medGrade) || null,
      std: finite(row.stdGrade) || null,
      students: finite(row.totalStudents),
      bins,
      updatedAt: typeof row.updateDate === 'string' ? row.updateDate : null,
    }];
  });
}

const ARAZIM_TERM = /^(\d{4})(.+)$/;

/** One course's entry of the Arazim grades file: {term: {group: [sitting…]}}. */
export function parseArazim(sourceId: string, courseKey: string, entry: unknown): GradeRecord[] {
  if (!entry || typeof entry !== 'object') return [];
  return Object.entries(entry as Record<string, unknown>).flatMap(([termCode, groups]) => {
    const match = ARAZIM_TERM.exec(termCode);
    if (!match || !groups || typeof groups !== 'object') return [];
    return Object.entries(groups as Record<string, unknown>).flatMap(([group, sittings]) =>
      (Array.isArray(sittings) ? sittings : []).flatMap((sitting: any): GradeRecord[] => {
        const mean = finite(sitting?.mean);
        const counts: number[] = Array.isArray(sitting?.distribution)
          ? sitting.distribution.map((n: unknown) => finite(n) ?? 0) : [];
        const total = counts.reduce((sum, n) => sum + n, 0);
        if (mean === null || mean <= 0 || total === 0) return [];
        // Equal-width bins over 0–100, as many as the source sent.
        const width = 100 / counts.length;
        const bins = counts.map((n, i) => ({
          from: Math.round(i * width),
          to: i === counts.length - 1 ? 100 : Math.round((i + 1) * width) - 1,
          percent: (n / total) * 100,
        }));
        return [{
          source: sourceId,
          courseKey,
          year: Number(match[1]),
          term: match[2],
          group: Number(group) || 0,
          moed: finite(sitting.moed) ?? 0,
          lecturers: [],
          mean,
          median: finite(sitting.median),
          std: finite(sitting.standard_deviation),
          students: total,
          bins,
          updatedAt: null,
        }];
      }));
  });
}

// ── fetching ────────────────────────────────────────────────────────────────

export interface GradeSourceResult {
  source: GradeSourceConfig;
  status: GradeSourceStatus;
  records: GradeRecord[];
  /** Why the live source failed (e.g. "HTTP 403"); absent when it answered live. */
  detail?: string;
  /** Set when the records came from the committed snapshot: when it was taken. */
  snapshotAt?: string;
}

/** A committed per-program copy of a source, in the source's own payload format. */
export interface GradeSnapshot {
  source: string;
  generated_at: string;
  /** 8-digit course key → the source's native payload for that course. */
  courses: Record<string, unknown>;
}

const parserFor = (source: GradeSourceConfig) =>
  source.kind === 'tauplus_butterknife' ? parseTauPlus : parseArazim;

export class GradeStore {
  private readonly live = new TtlCache<unknown>();
  private readonly files = new TtlCache<Record<string, unknown>>();
  private readonly snapshots = new Map<string, GradeSnapshot | null>();

  constructor(private readonly fetcher: HttpFetcher, private readonly root: string = REPO_ROOT) {}

  /**
   * One course from one source. A source marked prefer_snapshot answers from its
   * snapshot when the course is in it; otherwise live first, and the snapshot
   * when the live source fails (e.g. a host that refuses server traffic).
   */
  async fetchCourse(source: GradeSourceConfig, courseKey: string): Promise<GradeSourceResult> {
    const parse = parserFor(source);
    const snapshot = this.snapshot(source);
    const fromSnapshot = (detail?: string): GradeSourceResult | null => {
      if (!snapshot || !(courseKey in snapshot.courses)) return null;
      const records = parse(source.id, courseKey, snapshot.courses[courseKey]);
      return { source, status: records.length ? 'ok' : 'no_data', records, snapshotAt: snapshot.generated_at, ...(detail ? { detail } : {}) };
    };
    if (source.prefer_snapshot) {
      const hit = fromSnapshot();
      if (hit) return hit;
    }
    try {
      const records = parse(source.id, courseKey, await this.fetchRaw(source, courseKey));
      return { source, status: records.length ? 'ok' : 'no_data', records };
    } catch (error) {
      const detail = String((error as Error)?.message ?? error).slice(0, 200);
      console.warn(`[course-insights] grade source ${source.id} failed: ${detail}`);
      return fromSnapshot(detail) ?? { source, status: 'error', records: [], detail };
    }
  }

  /** The source's native payload for one course, fetched live (cached per TTL). */
  async fetchRaw(source: GradeSourceConfig, courseKey: string): Promise<unknown> {
    if (source.kind === 'tauplus_butterknife') {
      return this.live.get(`${source.id}:${courseKey}`, source.ttl_seconds, async () => {
        const url = `${source.url.replace(/\/+$/, '')}/grades?courseNumber=${encodeURIComponent(courseKey)}`;
        const res = await this.fetcher(url, { timeoutMs: source.timeout_ms });
        if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}: ${res.body.replace(/\s+/g, ' ').slice(0, 80)}`);
        return JSON.parse(res.body);
      });
    }
    const file = await this.files.get(source.id, source.ttl_seconds, async () => {
      const res = await this.fetcher(source.url, { timeoutMs: source.timeout_ms });
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
      return JSON.parse(res.body);
    });
    return file[courseKey];
  }

  private snapshot(source: GradeSourceConfig): GradeSnapshot | null {
    if (!source.snapshot_path) return null;
    if (!this.snapshots.has(source.id)) {
      try {
        this.snapshots.set(source.id, JSON.parse(readFileSync(join(this.root, source.snapshot_path), 'utf8')));
      } catch {
        this.snapshots.set(source.id, null);
      }
    }
    return this.snapshots.get(source.id) ?? null;
  }
}

// ── merge + summary ─────────────────────────────────────────────────────────

function uniquePeople(names: string[]): string[] {
  const seen = new Map<string, string>();
  for (const name of names) if (!seen.has(personKey(name))) seen.set(personKey(name), name);
  return [...seen.values()];
}

const TERM_ORDER = (term: string) => ({ a: 1, b: 2, summer: 3 } as Record<string, number>)[term] ?? 9;
const termKey = (r: { year: number; term: string }) => `${r.year}:${r.term}`;
const newestFirst = (a: { year: number; term: string }, b: { year: number; term: string }) =>
  b.year - a.year || TERM_ORDER(b.term) - TERM_ORDER(a.term);

function passRate(bins: GradeBin[], passingGrade: number): number | null {
  if (!bins.length) return null;
  const total = bins.reduce((sum, bin) => sum + bin.percent, 0);
  if (total <= 0) return null;
  return (bins.filter((bin) => bin.from >= passingGrade).reduce((sum, bin) => sum + bin.percent, 0) / total) * 100;
}

/** Student-weighted mean of `pick` over rows that carry it (plain mean when no counts). */
function weighted<T extends { students: number | null }>(rows: T[], pick: (row: T) => number | null): number | null {
  const valued = rows.map((row) => ({ value: pick(row), weight: row.students ?? 1 })).filter((row) => row.value !== null);
  const weight = valued.reduce((sum, row) => sum + row.weight, 0);
  return weight > 0 ? valued.reduce((sum, row) => sum + (row.value as number) * row.weight, 0) / weight : null;
}

function aggregate(terms: TermStats[]): GradeAggregate | null {
  if (!terms.length) return null;
  const counts = terms.map((term) => term.students).filter((n): n is number => n !== null);
  return {
    mean: round(weighted(terms, (t) => t.mean) as number),
    median: (() => { const m = weighted(terms, (t) => t.median); return m === null ? null : round(m); })(),
    pass_rate: (() => { const p = weighted(terms, (t) => t.pass_rate); return p === null ? null : round(p); })(),
    students: counts.length ? counts.reduce((sum, n) => sum + n, 0) : null,
    terms: terms.length,
  };
}

/**
 * One row per (year, term): for each source keep the largest sitting per group,
 * drop a group-0 roll-up when real groups exist, take the first configured source
 * that has the term, then combine its groups student-weighted.
 */
export function summarizeCourseGrades(
  courseKey: string,
  results: GradeSourceResult[],
  opts: { recentTerms: number; passingGrade: number },
): CourseGradeSummary {
  const termsBySource = new Map<string, Map<string, GradeRecord[]>>();
  for (const { source, records } of results) {
    const perGroup = new Map<string, GradeRecord>();
    for (const record of records) {
      const key = `${termKey(record)}:${record.group}`;
      const kept = perGroup.get(key);
      if (!kept || (record.students ?? 0) > (kept.students ?? 0)) perGroup.set(key, record);
    }
    const byTerm = new Map<string, GradeRecord[]>();
    for (const record of perGroup.values()) byTerm.set(termKey(record), [...(byTerm.get(termKey(record)) ?? []), record]);
    for (const [key, rows] of byTerm) {
      if (rows.some((row) => row.group !== 0)) byTerm.set(key, rows.filter((row) => row.group !== 0));
    }
    termsBySource.set(source.id, byTerm);
  }

  const chosen = new Map<string, GradeRecord[]>();
  for (const { source } of results) {
    for (const [key, rows] of termsBySource.get(source.id) ?? []) if (!chosen.has(key)) chosen.set(key, rows);
  }

  const terms: TermStats[] = [...chosen.values()].map((rows) => {
    const students = rows.every((row) => row.students === null) ? null : rows.reduce((sum, row) => sum + (row.students ?? 0), 0);
    // Bins combine only when every group uses the same edges.
    const edges = (row: GradeRecord) => row.bins.map((bin) => `${bin.from}-${bin.to}`).join(',');
    const sameEdges = rows.every((row) => edges(row) === edges(rows[0]));
    const bins = sameEdges ? rows[0].bins.map((bin, i) => ({
      ...bin,
      percent: round(weighted(rows, (row) => row.bins[i]?.percent ?? null) ?? 0),
    })) : [];
    const median = weighted(rows, (row) => row.median);
    const std = weighted(rows, (row) => row.std);
    return {
      year: rows[0].year,
      term: rows[0].term,
      mean: round(weighted(rows, (row) => row.mean) as number),
      median: median === null ? null : round(median),
      std: std === null ? null : round(std),
      students,
      pass_rate: (() => { const p = passRate(bins, opts.passingGrade); return p === null ? null : round(p); })(),
      lecturers: uniquePeople(rows.flatMap((row) => row.lecturers)),
      bins,
      source: rows[0].source,
    };
  }).sort(newestFirst);

  const recentTerms = terms.slice(0, opts.recentTerms);
  const olderTerms = terms.slice(opts.recentTerms);
  const recent = aggregate(recentTerms);
  const older = aggregate(olderTerms);
  const delta = recent && older ? round(recent.mean - older.mean) : null;

  const byLecturer = new Map<string, { name: string; rows: TermStats[] }>();
  for (const term of terms) {
    for (const name of term.lecturers) {
      const entry = byLecturer.get(personKey(name)) ?? { name, rows: [] };
      entry.rows.push(term);
      byLecturer.set(personKey(name), entry);
    }
  }

  return {
    course_key: courseKey,
    has_data: terms.length > 0,
    passing_grade: opts.passingGrade,
    sources: results.map(({ source, status, detail, snapshotAt }) => ({
      ...(detail ? { detail } : {}),
      ...(snapshotAt ? { snapshot_at: snapshotAt } : {}),
      id: source.id,
      label_he: source.label_he,
      attribution_url: source.attribution_url,
      status,
      terms: [...chosen.values()].filter((rows) => rows[0].source === source.id).length,
    })),
    overall: aggregate(terms),
    recent,
    trend: recent && older && delta !== null ? {
      // Within one point is noise, not a trend.
      direction: delta > 1 ? 'up' : delta < -1 ? 'down' : 'flat',
      recent_mean: recent.mean,
      older_mean: older.mean,
      delta,
    } : null,
    // Most-taught first.
    lecturers: [...byLecturer.values()].map(({ name, rows }) => ({
      name,
      mean: round(weighted(rows, (row) => row.mean) as number),
      students: rows.every((row) => row.students === null) ? null : rows.reduce((sum, row) => sum + (row.students ?? 0), 0),
      terms: rows.length,
    })).sort((a, b) => b.terms - a.terms || (b.students ?? 0) - (a.students ?? 0)),
    terms,
  };
}
