/**
 * K7 — bounded, read-only acquisition of official syllabus documents.
 *
 * Operates ONLY through the K2 adapter, so the host allowlist, redirect
 * classification, size/content-type limits, course-id and academic-year checks
 * and typed failure states all apply unchanged. This script adds nothing but a
 * course list, a rate limit, and a hard request budget.
 *
 * DECLARED BOUNDS (enforced below, not merely documented):
 *   - max 14 HTTP requests for the whole run;
 *   - strictly sequential — concurrency 1;
 *   - >= 2000 ms delay between requests;
 *   - 15 s timeout, 2 MB max response;
 *   - stop the ENTIRE run on 401/403/429 or any access restriction;
 *   - no credentials, no cookies, no form submission, no link traversal,
 *     no search engine, no browser automation.
 *
 * IMPORTANT FINDING (first live run, 13 requests): the official endpoint is
 * addressed by course + GROUP + year, not course + year. A group suffix of '00'
 * returns a 200 page reading "קבוצה לא נמצא / Group semester not found" with the
 * labels present but every value empty — which the adapter correctly classifies
 * as `no_syllabus_published` rather than inventing data. Real group numbers
 * (e.g. '01', '05') return the real document. Group numbers are per-offering
 * data and must come from the timetable/offering source, not be guessed.
 *
 * COURSE SELECTION CRITERIA (fixed before running, and deliberately NOT chosen
 * to flatter the extractor): every course id is taken from this repository's own
 * existing catalog references, and the list is picked to span contrasting course
 * shapes — a known laboratory course, project/design courses, exam-focused
 * lecture courses, and courses whose syllabus is expected to be missing or
 * incomplete. One course is additionally requested for an older academic year to
 * exercise version applicability. Failures are reported, never dropped.
 *
 * Usage:  npx tsx scripts/acquire_official_syllabi.ts [--year 2025] [--dry-run]
 * Output: writes documents into the durable evidence cache (K6) and prints a
 *         JSON acquisition report. NO syllabus body text is ever printed or
 *         committed — only metadata, hashes and coverage counts.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { acquireSyllabus, buildSyllabusUrl, type HttpFetcher, type HttpResponse, type SyllabusDocument } from '../api/ai/syllabus_source';
import { storeDocument } from '../api/ai/evidence_cache';
import { RuleBasedFeatureExtractor, FEATURE_EXTRACTION_VERSION } from '../api/ai/course_features';

// ── declared bounds ──────────────────────────────────────────────────────────
const MAX_REQUESTS = 14;
const DELAY_MS = 2000;
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 2_000_000;
/** Statuses that stop the entire run rather than moving to the next course. */
const STOP_STATUSES = new Set([401, 403, 429]);

/**
 * Selected courses, with the reason each is in the list. Ids come from this
 * repository's own catalog/offering references (scripts/add_offered_semester_fields.py
 * and data/raw_html/course_details/), not from a search.
 */
const SELECTION: Array<{ courseId: string; year: number; group: string; why: string }> = [
  { courseId: '0542-3792', year: 2025, group: '05', why: 'known LABORATORY course (delivery mode מעבדה)' },
  { courseId: '0542-3792', year: 2025, group: '01', why: 'same course, different GROUP — group addressing' },
  { courseId: '0542-3791', year: 2025, group: '01', why: 'sibling of the laboratory course — contrasting shape' },
  { courseId: '0542-3780', year: 2025, group: '01', why: 'elective referenced by the offering pipeline' },
  { courseId: '0542-4010', year: 2025, group: '01', why: 'project/design-oriented elective' },
  { courseId: '0542-4020', year: 2025, group: '01', why: 'exam-focused lecture elective' },
  { courseId: '0542-3112', year: 2025, group: '01', why: 'core lecture course — exam-focused contrast' },
  { courseId: '0509-4010', year: 2025, group: '01', why: 'different faculty prefix — layout generality probe' },
  { courseId: '0542-4093', year: 2025, group: '01', why: 'expected NOT offered this year — missing-document case' },
  { courseId: '0542-4124', year: 2025, group: '01', why: 'expected incomplete catalog record — missing/partial case' },
  { courseId: '0542-9999', year: 2025, group: '01', why: 'deliberately non-existent id — proves mismatch handling' },
  { courseId: '0542-3792', year: 2019, group: '05', why: 'OLDER year of the laboratory course — version applicability' },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Read-only GET. No credentials, no cookies, no redirect following beyond fetch's own. */
const httpFetcher = (budget: { used: number }): HttpFetcher => async (url, opts) => {
  if (budget.used >= MAX_REQUESTS) throw new Error('request budget exhausted');
  budget.used++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'syllo-course-planner/1.0 (academic planning; read-only)' },
    });
    const body = await res.text();
    return {
      status: res.status,
      finalUrl: res.url || url,
      contentType: res.headers.get('content-type') ?? '',
      body,
    } satisfies HttpResponse;
  } finally {
    clearTimeout(timer);
  }
};

interface Attempt {
  courseId: string;
  year: number;
  why: string;
  url: string;
  outcome: 'acquired' | 'unavailable';
  reason?: string;
  detail?: string;
  contentHash?: string;
  /** Feature coverage — values only, never syllabus prose. */
  features?: { laboratory: string; project: string; finalExam: string; coursework: string; deliveryMode: string };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const cacheRoot = (process.env.AI_EVIDENCE_CACHE_DIR ?? '').trim() || join(process.cwd(), 'data', 'evidence_cache');
  const budget = { used: 0 };
  const fetcher = httpFetcher(budget);
  const extractor = new RuleBasedFeatureExtractor();
  const attempts: Attempt[] = [];
  const acquired: SyllabusDocument[] = [];
  let stoppedEarly: string | null = null;

  for (const item of SELECTION) {
    if (budget.used >= MAX_REQUESTS) { stoppedEarly = 'request budget reached'; break; }
    const url = buildSyllabusUrl({ courseId: item.courseId, academicYear: item.year, group: item.group });
    if (dryRun) {
      attempts.push({ ...item, url, outcome: 'unavailable', reason: 'dry_run' });
      continue;
    }

    const r = await acquireSyllabus(
      {
        institutionId: 'tau.ac.il',
        courseId: item.courseId,
        academicYear: item.year,
        retrievedAt: new Date().toISOString(),
        url,
        config: { timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES, maxAttempts: 1 }, // no retry storm
      },
      fetcher,
    );

    if (r.status === 'acquired') {
      const f = extractor.extract(r.document);
      attempts.push({
        ...item, url, outcome: 'acquired', contentHash: r.document.contentHash,
        features: {
          laboratory: String(f.laboratory.value), project: String(f.project.value),
          finalExam: String(f.finalExam.value), coursework: String(f.coursework.value),
          deliveryMode: String(f.deliveryMode.value),
        },
      });
      acquired.push(r.document);
      storeDocument(cacheRoot, r.document, FEATURE_EXTRACTION_VERSION);
    } else {
      attempts.push({ ...item, url, outcome: 'unavailable', reason: r.reason, ...(r.detail ? { detail: r.detail } : {}) });
      if (r.reason === 'http_error' && STOP_STATUSES.has(Number(r.detail))) {
        stoppedEarly = `access restricted (HTTP ${r.detail}) — stopping the run`;
        break;
      }
    }
    await sleep(DELAY_MS);
  }

  const acquiredCount = attempts.filter((a) => a.outcome === 'acquired').length;
  const known = (v?: string) => v !== undefined && v !== 'unknown';
  const featureRows = attempts.filter((a) => a.features);
  const report = {
    generatedAt: new Date().toISOString(),
    bounds: { maxRequests: MAX_REQUESTS, delayMs: DELAY_MS, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES, concurrency: 1 },
    requestsUsed: budget.used,
    stoppedEarly,
    attempted: attempts.length,
    acquired: acquiredCount,
    unavailable: attempts.length - acquiredCount,
    failureReasons: attempts.filter((a) => a.outcome === 'unavailable')
      .reduce<Record<string, number>>((acc, a) => { acc[a.reason ?? 'unknown'] = (acc[a.reason ?? 'unknown'] ?? 0) + 1; return acc; }, {}),
    extractionVersion: FEATURE_EXTRACTION_VERSION,
    featureCoverage: {
      documentsExtracted: featureRows.length,
      laboratoryKnown: featureRows.filter((a) => known(a.features?.laboratory)).length,
      deliveryModeKnown: featureRows.filter((a) => known(a.features?.deliveryMode)).length,
      assessmentKnown: featureRows.filter((a) => known(a.features?.finalExam)).length,
    },
    // Metadata only — no syllabus body text anywhere in this report.
    attempts,
  };

  const outDir = join(process.cwd(), 'data', 'import_reports');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'official_syllabus_acquisition_report.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nreport: ${outPath}\ncache:  ${cacheRoot}\nrequests used: ${budget.used}/${MAX_REQUESTS}`);
}

main().catch((e) => { console.error('acquisition failed:', e instanceof Error ? e.message : String(e)); process.exit(1); });
