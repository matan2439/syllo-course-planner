/**
 * K2 — the deterministic, bounded OFFICIAL-SOURCE syllabus adapter.
 *
 * This is a narrow point-fetch of ONE known official document per (course, year)
 * — deliberately NOT a crawler. There is no link following, no discovery, no
 * search, and no traversal: the URL is CONSTRUCTED from the course id and
 * academic year against an allowlisted official host, and exactly that one
 * document is retrieved.
 *
 * Transport is INJECTED (`HttpFetcher`), which is what lets the whole adapter be
 * proven against recorded official fixtures with no live network, and what keeps
 * planning deterministic: the planner never calls this. Planning reads a frozen
 * `EvidenceSnapshot` (below), so a candidate's ranking can never depend on
 * network availability, latency, or a source changing mid-run.
 *
 * Safety properties enforced here:
 *   - host allowlist, checked BEFORE any request is issued;
 *   - a redirect landing off the allowlist is classified, never accepted;
 *   - bounded timeout, bounded response size, content-type validation;
 *   - deterministic retry: transient failures only, fixed attempt count, no
 *     randomness/jitter;
 *   - no credentials of any kind are sent;
 *   - content-addressed caching by content hash;
 *   - every failure is a TYPED unavailable state — never fabricated knowledge.
 *
 * Nothing here is subject-specific. The institution host, course id format and
 * academic year are parameters; the default allowlist simply records the one
 * official host this repository already sources from.
 */

import { makeEvidence, type AcademicEvidence, type AcademicFactType } from './academic_evidence';

// ── configuration ────────────────────────────────────────────────────────────

/**
 * Official institution hosts. `ims.tau.ac.il` is the university's own course
 * information system — the same host the repository's existing offering-source
 * URLs already cite (scripts/add_offered_semester_fields.py). Secondary or
 * community sites are deliberately absent: they may never supply an academic
 * fact (see academic_evidence.ts's source hierarchy).
 */
export const DEFAULT_OFFICIAL_HOST_ALLOWLIST: readonly string[] = ['ims.tau.ac.il'];

export interface SyllabusSourceConfig {
  allowedHosts: readonly string[];
  timeoutMs: number;
  maxBytes: number;
  /** Total attempts for a TRANSIENT failure (1 = no retry). */
  maxAttempts: number;
  allowedContentTypes: readonly string[];
}

export const DEFAULT_CONFIG: SyllabusSourceConfig = {
  allowedHosts: DEFAULT_OFFICIAL_HOST_ALLOWLIST,
  timeoutMs: 10_000,
  maxBytes: 2_000_000,
  maxAttempts: 3,
  allowedContentTypes: ['text/html'],
};

// ── transport boundary ───────────────────────────────────────────────────────

export interface HttpResponse {
  status: number;
  /** The URL after any redirects — validated against the allowlist. */
  finalUrl: string;
  contentType: string;
  body: string;
}

/**
 * The injected transport. Deliberately minimal and credential-free: it receives
 * a URL and a timeout, nothing else. No headers parameter exists, so no caller
 * can smuggle an Authorization/Cookie header through this boundary.
 */
export type HttpFetcher = (url: string, opts: { timeoutMs: number }) => Promise<HttpResponse>;

// ── document ─────────────────────────────────────────────────────────────────

export interface SyllabusDocument {
  institutionId: string;
  programId?: string;
  /** Canonical course id in the planner's own format (e.g. '0542-3792'). */
  courseId: string;
  academicYear: number;
  syllabusVersion?: string;
  sourceUrl: string;
  /** Content-addressed hash of the retrieved body. */
  contentHash: string;
  retrievedAt: string;
  /** Label → values, extracted from the official page's own labelled fields. */
  labeledFields: Record<string, string[]>;
  /** Whitespace-normalized visible text, for rule-based feature extraction. */
  text: string;
}

export type AcquisitionFailureReason =
  | 'host_not_allowlisted'
  | 'redirect_off_allowlist'
  | 'timeout'
  | 'response_too_large'
  | 'unsupported_content_type'
  | 'http_error'
  | 'network_error'
  | 'course_id_mismatch'
  | 'academic_year_mismatch'
  | 'no_syllabus_published';

export type AcquisitionResult =
  | { status: 'acquired'; document: SyllabusDocument; attempts: number }
  | { status: 'unavailable'; reason: AcquisitionFailureReason; detail?: string; attempts: number };

// ── helpers ──────────────────────────────────────────────────────────────────

/** Digits only — '0542-3792-05' and '0542379205' both reduce to the same key. */
function digits(s: string): string {
  return (s ?? '').replace(/\D/g, '');
}

/** The 8-digit course key (faculty+course), ignoring any 2-digit group suffix. */
function courseKey(s: string): string {
  return digits(s).slice(0, 8);
}

/** Small deterministic string hash (FNV-1a) — stable across runs, no randomness. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isAllowed(url: string, allowedHosts: readonly string[]): boolean {
  const host = hostOf(url);
  if (!host) return false;
  // Exact host match only — no suffix matching, so 'ims.tau.ac.il.evil.com'
  // can never satisfy an 'ims.tau.ac.il' entry.
  return allowedHosts.some((h) => host === h.toLowerCase());
}

/**
 * The official syllabus URL for a course+year. The course parameter is the
 * 8-digit course key plus a 2-digit group suffix ('00' = the course itself).
 */
export function buildSyllabusUrl(req: { courseId: string; academicYear: number; group?: string }): string {
  const key = courseKey(req.courseId);
  const group = (req.group ?? '00').padStart(2, '0');
  return `https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=${key}${group}&year=${req.academicYear}`;
}

// ── parsing ──────────────────────────────────────────────────────────────────

function stripTags(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Extract the official page's own labelled fields. The institution's syllabus
 * template is regular: a `<small class="data-table-cell-label">LABEL</small>`
 * immediately followed by the value markup. This reads that structure directly
 * — deterministic, rule-based, no model involved.
 */
function extractLabeledFields(html: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const labelRe = /<small[^>]*class="[^"]*data-table-cell-label[^"]*"[^>]*>([\s\S]*?)<\/small>([\s\S]*?)(?=<small[^>]*class="[^"]*data-table-cell-label|<\/div>\s*<\/div>|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(html)) !== null) {
    const label = stripTags(m[1]).trim();
    if (!label) continue;
    // Every <span> that follows this label, before the next label.
    const values: string[] = [];
    const spanRe = /<span[^>]*>([\s\S]*?)<\/span>/gi;
    let s: RegExpExecArray | null;
    while ((s = spanRe.exec(m[2])) !== null) {
      const v = stripTags(s[1]).trim();
      if (v) values.push(v);
    }
    if (!values.length) continue;
    (out[label] ??= []).push(...values);
  }
  return out;
}

function yearFromUrl(url: string): number | null {
  try {
    const y = new URL(url).searchParams.get('year');
    return y != null && /^\d{4}$/.test(y) ? Number(y) : null;
  } catch {
    return null;
  }
}

// ── acquisition ──────────────────────────────────────────────────────────────

export interface AcquireRequest {
  institutionId: string;
  programId?: string;
  courseId: string;
  academicYear: number;
  /** ISO timestamp recorded on the document — supplied, never read from the clock. */
  retrievedAt: string;
  /** Override the constructed official URL (still allowlist-checked). */
  url?: string;
  config?: Partial<SyllabusSourceConfig>;
}

/** Failures worth retrying: transient transport problems only. */
const TRANSIENT: ReadonlySet<AcquisitionFailureReason> = new Set(['network_error', 'timeout']);

/**
 * Retrieve ONE official syllabus document. Every outcome is typed: on any
 * failure the caller receives an `unavailable` state with a stable reason and no
 * document — the adapter never invents, substitutes or approximates knowledge.
 */
export async function acquireSyllabus(req: AcquireRequest, fetcher: HttpFetcher): Promise<AcquisitionResult> {
  const cfg: SyllabusSourceConfig = { ...DEFAULT_CONFIG, ...(req.config ?? {}) };
  const url = req.url ?? buildSyllabusUrl(req);

  // Checked BEFORE any request is issued — a non-official host is never contacted.
  if (!isAllowed(url, cfg.allowedHosts)) {
    return { status: 'unavailable', reason: 'host_not_allowlisted', detail: hostOf(url) ?? url, attempts: 0 };
  }

  let attempts = 0;
  let last: { reason: AcquisitionFailureReason; detail?: string } = { reason: 'network_error' };

  while (attempts < Math.max(1, cfg.maxAttempts)) {
    attempts++;
    let res: HttpResponse;
    try {
      res = await fetcher(url, { timeoutMs: cfg.timeoutMs });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      last = { reason: /timeout|abort/i.test(msg) ? 'timeout' : 'network_error', detail: msg };
      continue; // transient — deterministic retry, no backoff randomness
    }

    // A redirect that leaves the official host is a classification, not a fallback.
    if (!isAllowed(res.finalUrl, cfg.allowedHosts)) {
      return { status: 'unavailable', reason: 'redirect_off_allowlist', detail: res.finalUrl, attempts };
    }
    if (res.status < 200 || res.status >= 300) {
      return { status: 'unavailable', reason: 'http_error', detail: String(res.status), attempts };
    }
    if (!cfg.allowedContentTypes.some((t) => res.contentType.toLowerCase().startsWith(t))) {
      return { status: 'unavailable', reason: 'unsupported_content_type', detail: res.contentType, attempts };
    }
    if (Buffer.byteLength(res.body, 'utf-8') > cfg.maxBytes) {
      return { status: 'unavailable', reason: 'response_too_large', attempts };
    }

    // Version applicability — checked against the RESPONSE, so a source that
    // silently serves another year or another course is refused rather than
    // becoming current authoritative evidence.
    const servedYear = yearFromUrl(res.finalUrl);
    if (servedYear !== null && servedYear !== req.academicYear) {
      return { status: 'unavailable', reason: 'academic_year_mismatch', detail: String(servedYear), attempts };
    }

    const labeledFields = extractLabeledFields(res.body);
    const documentCourse = labeledFields['מספר קורס']?.[0];
    if (!documentCourse) {
      return { status: 'unavailable', reason: 'no_syllabus_published', attempts };
    }
    if (courseKey(documentCourse) !== courseKey(req.courseId)) {
      return { status: 'unavailable', reason: 'course_id_mismatch', detail: documentCourse, attempts };
    }

    return {
      status: 'acquired',
      attempts,
      document: {
        institutionId: req.institutionId,
        ...(req.programId !== undefined ? { programId: req.programId } : {}),
        courseId: req.courseId,
        academicYear: req.academicYear,
        sourceUrl: res.finalUrl,
        contentHash: `sha_${hash(res.body)}`,
        retrievedAt: req.retrievedAt,
        labeledFields,
        text: stripTags(res.body),
      },
    };
  }

  return { status: 'unavailable', reason: last.reason, ...(last.detail ? { detail: last.detail } : {}), attempts };
}

/**
 * The document that APPLIES to `academicYear`. Returns undefined when none does
 * — deliberately NOT "the newest available", so a syllabus published for another
 * year can never silently become the current authoritative one.
 */
export function selectCurrentSyllabus(docs: SyllabusDocument[], academicYear: number): SyllabusDocument | undefined {
  return docs.find((d) => d.academicYear === academicYear);
}

/** Turn an official syllabus document into a provenance-carrying evidence record. */
export function syllabusToEvidence(
  doc: SyllabusDocument,
  fact: {
    factType: AcademicFactType;
    value: unknown;
    confidence: number;
    extractionMethod: string;
    extractionVersion: string;
    excerpt?: string;
    locator?: string;
  },
): AcademicEvidence {
  return makeEvidence({
    institutionId: doc.institutionId,
    ...(doc.programId !== undefined ? { programId: doc.programId } : {}),
    courseId: doc.courseId,
    factType: fact.factType,
    value: fact.value,
    sourceRef: doc.sourceUrl,
    sourceClass: 'official_syllabus',
    academicYear: doc.academicYear,
    ...(doc.syllabusVersion !== undefined ? { sourceVersion: doc.syllabusVersion } : {}),
    retrievedAt: doc.retrievedAt,
    extractionMethod: fact.extractionMethod,
    extractionVersion: fact.extractionVersion,
    confidence: fact.confidence,
    ...(fact.excerpt !== undefined ? { excerpt: fact.excerpt } : {}),
    ...(fact.locator !== undefined ? { locator: fact.locator } : {}),
  });
}

// ── snapshot ─────────────────────────────────────────────────────────────────

/**
 * A frozen, content-addressed set of official documents. This is the ONLY thing
 * planning ever sees: every candidate in a request is scored against the same
 * `snapshotId`, so ranking cannot drift between candidates, cannot depend on
 * network availability, and is reproducible from the snapshot alone.
 */
export interface EvidenceSnapshot {
  snapshotId: string;
  documents: SyllabusDocument[];
  byCourseId: Map<string, SyllabusDocument>;
}

export function buildEvidenceSnapshot(documents: SyllabusDocument[]): EvidenceSnapshot {
  const sorted = [...documents].sort((a, b) =>
    a.courseId < b.courseId ? -1 : a.courseId > b.courseId ? 1 : a.contentHash < b.contentHash ? -1 : 1,
  );
  const snapshotId = `snap_${hash(sorted.map((d) => `${d.courseId}@${d.academicYear}#${d.contentHash}`).join('|'))}`;
  const byCourseId = new Map<string, SyllabusDocument>();
  for (const d of sorted) if (!byCourseId.has(d.courseId)) byCourseId.set(d.courseId, d);
  return { snapshotId, documents: sorted, byCourseId };
}
