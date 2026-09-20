/**
 * K2 — deterministic, bounded OFFICIAL-SOURCE syllabus adapter.
 *
 * Acquisition is real (real official URL shape, real official markup, real HTTP
 * semantics) but the transport is INJECTED, so no test depends on live network
 * availability and no test performs a network call.
 *
 * The primary fixture is the genuine official TAU syllabus page already recorded
 * and tracked in this repo at data/raw_html/syllabus/syllabus_05423792.html —
 * a real document from https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx.
 * The synthetic fixtures below are minimal hand-written stubs used only to prove
 * mismatch/failure handling; they copy no third-party content.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DEFAULT_OFFICIAL_HOST_ALLOWLIST,
  buildSyllabusUrl,
  acquireSyllabus,
  selectCurrentSyllabus,
  syllabusToEvidence,
  buildEvidenceSnapshot,
  type HttpFetcher,
  type HttpResponse,
  type SyllabusDocument,
} from '../../api/ai/syllabus_source';

const REAL_HTML = readFileSync(
  join(__dirname, '..', '..', 'data', 'raw_html', 'syllabus', 'syllabus_05423792.html'),
  'utf-8',
);

const RETRIEVED_AT = '2026-08-14T00:00:00.000Z';
const REQ = {
  institutionId: 'tau.ac.il',
  courseId: '0542-3792',
  academicYear: 2025,
  retrievedAt: RETRIEVED_AT,
} as const;

function ok(body: string, over: Partial<HttpResponse> = {}): HttpResponse {
  return {
    status: 200,
    finalUrl: buildSyllabusUrl({ courseId: '0542-3792', academicYear: 2025 }),
    contentType: 'text/html; charset=utf-8',
    body,
    ...over,
  };
}
const fetcherReturning = (res: HttpResponse | (() => HttpResponse)): HttpFetcher =>
  async () => (typeof res === 'function' ? res() : res);

/** Minimal hand-written stub in the official label/value shape. No copied content. */
function stubSyllabus(opts: { courseNumber: string; semesterYearHe?: string; delivery?: string }): string {
  return `<div class="data-table">
    <div class="data-table-cell"><small class="data-table-cell-label">מספר קורס</small><span>${opts.courseNumber}</span></div>
    <div class="data-table-cell"><small class="data-table-cell-label">שם הקורס</small><span>קורס בדיקה</span></div>
    <div class="data-table-cell"><small class="data-table-cell-label">אופן ההוראה</small><span>${opts.delivery ?? 'שיעור'}</span></div>
    <div class="data-table-cell"><small class="data-table-cell-label">סמסטר</small><span>${opts.semesterYearHe ?? "א' תשפ\"ו"}</span></div>
  </div>`;
}

// ── allowlist + URL ──────────────────────────────────────────────────────────

describe('official-domain allowlist', () => {
  test('the default allowlist contains the official institution host only', () => {
    expect(DEFAULT_OFFICIAL_HOST_ALLOWLIST).toContain('ims.tau.ac.il');
    expect(DEFAULT_OFFICIAL_HOST_ALLOWLIST.some((h) => /blog|wiki|reddit|medium/.test(h))).toBe(false);
  });

  test('builds the real official syllabus URL shape', () => {
    const url = buildSyllabusUrl({ courseId: '0542-3792', academicYear: 2025 });
    expect(url).toBe('https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0542379200&year=2025');
  });

  test('a non-allowlisted host is refused before any fetch is attempted', async () => {
    let called = false;
    const spy: HttpFetcher = async () => { called = true; return ok(REAL_HTML); };
    const r = await acquireSyllabus({ ...REQ, url: 'https://notes.example.com/syllabus/0542-3792' }, spy);
    expect(r.status).toBe('unavailable');
    expect(r.status === 'unavailable' && r.reason).toBe('host_not_allowlisted');
    expect(called).toBe(false); // never even contacted
  });

  test('a redirect that lands OFF the allowlist is classified, not accepted', async () => {
    const r = await acquireSyllabus(
      REQ,
      fetcherReturning(ok(REAL_HTML, { finalUrl: 'https://mirror.example.com/copy.html' })),
    );
    expect(r.status === 'unavailable' && r.reason).toBe('redirect_off_allowlist');
  });
});

// ── bounded transport ────────────────────────────────────────────────────────

describe('bounded, credential-free transport', () => {
  test('the configured timeout is passed to the transport', async () => {
    let seen = -1;
    const spy: HttpFetcher = async (_u, o) => { seen = o.timeoutMs; return ok(REAL_HTML); };
    await acquireSyllabus({ ...REQ, config: { timeoutMs: 7000 } }, spy);
    expect(seen).toBe(7000);
  });

  test('an oversized response is refused', async () => {
    const r = await acquireSyllabus({ ...REQ, config: { maxBytes: 100 } }, fetcherReturning(ok(REAL_HTML)));
    expect(r.status === 'unavailable' && r.reason).toBe('response_too_large');
  });

  test('a non-HTML content type is refused', async () => {
    const r = await acquireSyllabus(REQ, fetcherReturning(ok(REAL_HTML, { contentType: 'application/pdf' })));
    expect(r.status === 'unavailable' && r.reason).toBe('unsupported_content_type');
  });

  test('an HTTP error is a typed unavailable state, never fabricated knowledge', async () => {
    const r = await acquireSyllabus(REQ, fetcherReturning(ok('', { status: 404 })));
    expect(r.status).toBe('unavailable');
    expect(r.status === 'unavailable' && r.reason).toBe('http_error');
    expect((r as { document?: unknown }).document).toBeUndefined();
  });

  test('a transport throw becomes a typed network_error, never an exception', async () => {
    const boom: HttpFetcher = async () => { throw new Error('ENOTFOUND'); };
    const r = await acquireSyllabus(REQ, boom);
    expect(r.status === 'unavailable' && r.reason).toBe('network_error');
  });

  test('retry is deterministic: bounded attempts, only for transient failures', async () => {
    let attempts = 0;
    const flaky: HttpFetcher = async () => { attempts++; throw new Error('transient'); };
    const r = await acquireSyllabus({ ...REQ, config: { maxAttempts: 3 } }, flaky);
    expect(attempts).toBe(3);
    expect(r.status === 'unavailable' && r.attempts).toBe(3);

    // A permanent failure is NOT retried.
    let permanent = 0;
    const notFound: HttpFetcher = async () => { permanent++; return ok('', { status: 404 }); };
    await acquireSyllabus({ ...REQ, config: { maxAttempts: 3 } }, notFound);
    expect(permanent).toBe(1);
  });

  test('no credential header is ever sent', async () => {
    let opts: Record<string, unknown> = {};
    const spy: HttpFetcher = async (_u, o) => { opts = o as unknown as Record<string, unknown>; return ok(REAL_HTML); };
    await acquireSyllabus(REQ, spy);
    expect(JSON.stringify(opts).toLowerCase()).not.toMatch(/authorization|cookie|token|password/);
  });
});

// ── real official document ───────────────────────────────────────────────────

describe('acquisition from the REAL recorded official syllabus', () => {
  test('acquires and parses the genuine official page', async () => {
    const r = await acquireSyllabus(REQ, fetcherReturning(ok(REAL_HTML)));
    expect(r.status).toBe('acquired');
    const doc = (r as { document: SyllabusDocument }).document;
    expect(doc.courseId).toBe('0542-3792');
    expect(doc.institutionId).toBe('tau.ac.il');
    expect(doc.academicYear).toBe(2025);
    expect(doc.sourceUrl).toContain('ims.tau.ac.il');
    expect(doc.retrievedAt).toBe(RETRIEVED_AT);
  });

  test('extracts the official labelled fields deterministically', async () => {
    const r = await acquireSyllabus(REQ, fetcherReturning(ok(REAL_HTML)));
    const doc = (r as { document: SyllabusDocument }).document;
    // Real values from the real official page:
    expect(doc.labeledFields['שם הקורס']?.[0]).toContain('הנדסת ניסויים ומדידות');
    expect(doc.labeledFields['אופן ההוראה']?.[0]).toBe('מעבדה');
    expect(doc.labeledFields['מספר קורס']?.[0]).toBe('0542-3792-05');
    expect(doc.labeledFields['סמסטר']?.length).toBeGreaterThan(0);
  });

  test('content hash is stable and content-addressed', async () => {
    const a = await acquireSyllabus(REQ, fetcherReturning(ok(REAL_HTML)));
    const b = await acquireSyllabus(REQ, fetcherReturning(ok(REAL_HTML)));
    const ha = (a as { document: SyllabusDocument }).document.contentHash;
    expect(ha).toBe((b as { document: SyllabusDocument }).document.contentHash);
    const c = await acquireSyllabus(REQ, fetcherReturning(ok(REAL_HTML + '<!--x-->')));
    expect((c as { document: SyllabusDocument }).document.contentHash).not.toBe(ha);
  });
});

// ── version applicability ────────────────────────────────────────────────────

describe('version applicability', () => {
  test('a document for a DIFFERENT course id is rejected, not accepted', async () => {
    const r = await acquireSyllabus(REQ, fetcherReturning(ok(stubSyllabus({ courseNumber: '0999-1111-01' }))));
    expect(r.status === 'unavailable' && r.reason).toBe('course_id_mismatch');
  });

  test('a response whose URL year differs from the requested year is rejected', async () => {
    const r = await acquireSyllabus(REQ, fetcherReturning(ok(REAL_HTML, {
      finalUrl: 'https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0542379200&year=2019',
    })));
    expect(r.status === 'unavailable' && r.reason).toBe('academic_year_mismatch');
  });

  test('a missing course number in the document is unavailable, never guessed', async () => {
    const r = await acquireSyllabus(REQ, fetcherReturning(ok('<html><body>אין סילבוס</body></html>')));
    expect(r.status).toBe('unavailable');
    expect((r as { document?: unknown }).document).toBeUndefined();
  });

  test('an OLDER syllabus never silently becomes the current one', () => {
    const older = { courseId: 'C1', academicYear: 2019, contentHash: 'h1' } as SyllabusDocument;
    const current = { courseId: 'C1', academicYear: 2025, contentHash: 'h2' } as SyllabusDocument;
    expect(selectCurrentSyllabus([older, current], 2025)?.academicYear).toBe(2025);
    // No document for the requested year → nothing current, NOT the newest available.
    expect(selectCurrentSyllabus([older], 2025)).toBeUndefined();
  });
});

// ── evidence + snapshot ──────────────────────────────────────────────────────

describe('evidence and snapshot', () => {
  test('an acquired document becomes official_syllabus evidence with full provenance', async () => {
    const r = await acquireSyllabus(REQ, fetcherReturning(ok(REAL_HTML)));
    const doc = (r as { document: SyllabusDocument }).document;
    const e = syllabusToEvidence(doc, { factType: 'descriptive_feature', value: 'laboratory', confidence: 0.9, extractionMethod: 'rule:delivery_mode', extractionVersion: '1.0.0' });
    expect(e.sourceClass).toBe('official_syllabus');
    expect(e.authoritative).toBe(true);
    expect(e.academicYear).toBe(2025);
    expect(e.courseId).toBe('0542-3792');
    expect(e.sourceRef).toContain('ims.tau.ac.il');
    expect(e.retrievedAt).toBe(RETRIEVED_AT);
  });

  test('a snapshot is deterministic and content-addressed, so every consumer sees one version', async () => {
    const r = await acquireSyllabus(REQ, fetcherReturning(ok(REAL_HTML)));
    const doc = (r as { document: SyllabusDocument }).document;
    const s1 = buildEvidenceSnapshot([doc]);
    const s2 = buildEvidenceSnapshot([doc]);
    expect(s1.snapshotId).toBe(s2.snapshotId);
    expect(s1.documents).toHaveLength(1);
    // A different document set is a different snapshot id.
    const other = { ...doc, contentHash: 'different' };
    expect(buildEvidenceSnapshot([other]).snapshotId).not.toBe(s1.snapshotId);
  });

  test('snapshot lookup is by course id — planning reads it, never the network', () => {
    const doc = { courseId: 'C1', academicYear: 2025, contentHash: 'h', labeledFields: {} } as unknown as SyllabusDocument;
    const snap = buildEvidenceSnapshot([doc]);
    expect(snap.byCourseId.get('C1')).toBe(doc);
    expect(snap.byCourseId.get('NOPE')).toBeUndefined();
  });
});
