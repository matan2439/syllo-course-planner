/**
 * K3 — grounded, rule-based course-feature extraction (no LLM).
 *
 * Every feature carries its supporting evidence and a confidence. The central
 * discipline under test: ABSENCE IS NOT FALSEHOOD. A feature may only be
 * concluded false when the official source field is schema-complete (an
 * enumerated field the institution always populates); free-text absence yields
 * `unknown`, never `false`.
 *
 * Fixtures: the genuine official TAU syllabus tracked in this repo, plus minimal
 * hand-written stubs in the same label/value shape (no third-party content
 * copied) covering an exam-based course, a missing section, and conflicting
 * evidence.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { acquireSyllabus, type HttpFetcher, type SyllabusDocument } from '../../api/ai/syllabus_source';
import {
  RuleBasedFeatureExtractor,
  TOPIC_VOCABULARY_VERSION,
  FEATURE_EXTRACTION_VERSION,
  normalizeTopics,
  type CourseFeatures,
  type FeatureExtractor,
} from '../../api/ai/course_features';

const REAL_HTML = readFileSync(
  join(__dirname, '..', '..', 'data', 'raw_html', 'syllabus', 'syllabus_05423792.html'),
  'utf-8',
);
const RETRIEVED_AT = '2026-08-14T00:00:00.000Z';

async function docFrom(html: string, courseId = '0542-3792', academicYear = 2025): Promise<SyllabusDocument> {
  const fetcher: HttpFetcher = async () => ({
    status: 200,
    finalUrl: `https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=${courseId.replace(/\D/g, '')}00&year=${academicYear}`,
    contentType: 'text/html',
    body: html,
  });
  const r = await acquireSyllabus(
    { institutionId: 'tau.ac.il', courseId, academicYear, retrievedAt: RETRIEVED_AT },
    fetcher,
  );
  if (r.status !== 'acquired') throw new Error(`fixture did not acquire: ${r.reason}`);
  return r.document;
}

/** Minimal hand-written stub in the official label/value shape. No copied content. */
function stub(opts: { courseNumber: string; delivery?: string; assignments?: string; content?: string }): string {
  const cell = (label: string, value: string) =>
    `<div class="data-table-cell"><small class="data-table-cell-label">${label}</small><span>${value}</span></div>`;
  return `<div class="data-table">
    ${cell('מספר קורס', opts.courseNumber)}
    ${cell('שם הקורס', 'קורס בדיקה')}
    ${opts.delivery ? cell('אופן ההוראה', opts.delivery) : ''}
    ${opts.assignments ? cell('מטלות הקורס', opts.assignments) : ''}
  </div>
  ${opts.content ? `<h2>תוכן הקורס ומטרתו</h2><p>${opts.content}</p>` : ''}`;
}

const extractor: FeatureExtractor = new RuleBasedFeatureExtractor();
const extract = async (html: string, courseId?: string) => extractor.extract(await docFrom(html, courseId));

// ── the real official document ───────────────────────────────────────────────

describe('extraction from the REAL official syllabus', () => {
  let f: CourseFeatures;
  beforeAll(async () => { f = await extract(REAL_HTML); });

  test('laboratory is TRUE, grounded in the official delivery-mode field', () => {
    expect(f.laboratory.value).toBe(true);
    expect(f.laboratory.evidence.length).toBeGreaterThan(0);
    expect(f.laboratory.evidence[0].sourceClass).toBe('official_syllabus');
    expect(f.laboratory.evidence[0].sourceRef).toContain('ims.tau.ac.il');
    expect(f.laboratory.evidence[0].academicYear).toBe(2025);
    expect(f.laboratory.confidence).toBeGreaterThan(0.8);
  });

  test('the official delivery mode is preserved verbatim alongside the normalized flag', () => {
    expect(f.deliveryMode.value).toBe('מעבדה');
  });

  test('the supporting excerpt is a short locator-bearing quote, not the whole document', () => {
    const e = f.laboratory.evidence[0];
    expect(e.excerpt ?? '').toContain('מעבדה');
    expect((e.excerpt ?? '').length).toBeLessThan(200); // copyright-safe
    expect(e.locator).toBeTruthy();
  });

  test('every feature is versioned and traceable to the extraction rule', () => {
    expect(f.extractionVersion).toBe(FEATURE_EXTRACTION_VERSION);
    expect(f.laboratory.rule).toMatch(/delivery_mode/);
    expect(f.laboratory.evidence[0].extractionMethod).toMatch(/rule:/);
  });

  test('the official prerequisite TEXT is retained as evidence only', () => {
    expect(typeof f.prerequisiteText.value).toBe('string');
    expect(f.prerequisiteText.value).toContain('מכניקת הזורמים');
    expect(f.prerequisiteText.authoritativeForPlanning).toBe(false); // never overrides the prerequisite engine
  });
});

// ── contrasting fixtures ─────────────────────────────────────────────────────

describe('contrasting course shapes', () => {
  test('an exam-based lecture course: laboratory FALSE, final exam TRUE', async () => {
    const f = await extract(stub({
      courseNumber: '0542-1111-01',
      delivery: 'שיעור',
      assignments: 'בחינה סופית 100%',
    }), '0542-1111');
    expect(f.laboratory.value).toBe(false); // schema-complete enumerated field
    expect(f.finalExam.value).toBe(true);
    expect(f.finalExam.evidence.length).toBeGreaterThan(0);
  });

  test('a project course: project TRUE from the official assignments field', async () => {
    const f = await extract(stub({
      courseNumber: '0542-2222-01',
      delivery: 'שיעור',
      assignments: 'פרויקט גמר והגשת דוח',
    }), '0542-2222');
    expect(f.project.value).toBe(true);
    expect(f.coursework.value).toBe(true);
  });

  test('an official assignments value rendered as a text node is preserved before its disclaimer', async () => {
    const html = `<div class="data-table">
      <div class="data-table-cell">
        <small class="data-table-cell-label">מספר קורס</small><span>0542-2223-01</span>
      </div>
      <div class="data-table-cell">
        <small class="data-table-cell-label">מטלות הקורס</small>
        פרוייקט
        <p class="disclaimer">ייתכנו מטלות נוספות<br>רשימת המטלות המלאה תופיע בסילבוס המפורט של הקורס.</p>
      </div>
    </div>`;

    const f = await extract(html, '0542-2223');

    expect(f.project.value).toBe(true);
    expect(f.project.evidence[0]?.locator).toBe('field:מטלות הקורס');
    expect(f.project.evidence[0]?.excerpt).toContain('פרוייקט');
    expect(f.project.evidence[0]?.excerpt).not.toContain('ייתכנו מטלות נוספות');
  });

  test('a legacy cached document recovers only the explicitly bounded assignments section', async () => {
    const acquired = await docFrom(stub({
      courseNumber: '0542-2224-01',
      delivery: 'שיעור',
    }), '0542-2224');
    const legacy = {
      ...acquired,
      text: `${acquired.text}\nמטלות הקורס\nפרוייקט\nייתכנו מטלות נוספות\nרשימת המטלות המלאה תופיע בסילבוס המפורט של הקורס.\nקורסי קדם נדרשים`,
    };

    const f = extractor.extract(legacy);

    expect(f.project.value).toBe(true);
    expect(f.project.evidence[0]?.locator).toBe('field:מטלות הקורס');
    expect(f.project.evidence[0]?.excerpt).toContain('פרוייקט');
    expect(f.project.evidence[0]?.excerpt).not.toContain('ייתכנו מטלות נוספות');
  });

  test('a prose mention of the assignments label cannot override the later official section', async () => {
    const acquired = await docFrom(stub({
      courseNumber: '0542-2225-01',
      delivery: 'שיעור',
    }), '0542-2225');
    const legacy = {
      ...acquired,
      text: `${acquired.text}\nתיאור הקורס מסביר כי מטלות הקורס כוללות פרויקט לדוגמה.\nמטלות הקורס\nאחר\nייתכנו מטלות נוספות`,
    };

    const f = extractor.extract(legacy);

    expect(f.project.value).toBe(false);
  });

  test('a laboratory course is detected from the official delivery mode alone', async () => {
    const f = await extract(stub({ courseNumber: '0542-3333-01', delivery: 'מעבדה' }), '0542-3333');
    expect(f.laboratory.value).toBe(true);
  });
});

// ── absence is not falsehood ─────────────────────────────────────────────────

describe('unknown handling — absence is never proof of absence', () => {
  test('a missing delivery-mode field yields UNKNOWN, not false', async () => {
    const f = await extract(stub({ courseNumber: '0542-4444-01' }), '0542-4444');
    expect(f.laboratory.value).toBe('unknown');
    expect(f.deliveryMode.value).toBe('unknown');
    expect(f.laboratory.evidence).toEqual([]); // no evidence, no claim
  });

  test('a missing assignments field yields UNKNOWN for exam/project/coursework', async () => {
    const f = await extract(stub({ courseNumber: '0542-5555-01', delivery: 'שיעור' }), '0542-5555');
    expect(f.finalExam.value).toBe('unknown');
    expect(f.project.value).toBe('unknown');
    expect(f.coursework.value).toBe('unknown');
  });

  test('free text that merely fails to mention a project does NOT make project false', async () => {
    const f = await extract(stub({
      courseNumber: '0542-6666-01',
      delivery: 'שיעור',
      content: 'הקורס עוסק בתרמודינמיקה ובמעבר חום.',
    }), '0542-6666');
    // No assignments field: free text is not schema-complete, so nothing is falsified.
    expect(f.project.value).toBe('unknown');
  });

  test('no subjective or unsupported dimension is ever produced', async () => {
    const f = await extract(REAL_HTML);
    const keys = Object.keys(f);
    for (const banned of ['difficulty', 'workload', 'teachingQuality', 'careerValue', 'gradingGenerosity']) {
      expect(keys).not.toContain(banned);
    }
  });
});

// ── topic normalization ──────────────────────────────────────────────────────

describe('topic normalization', () => {
  test('raw syllabus wording is preserved separately from the normalized id', async () => {
    const f = await extract(REAL_HTML);
    expect(f.topics.value.length).toBeGreaterThan(0);
    for (const t of f.topics.value) {
      expect(typeof t.rawText).toBe('string');
      expect(t.rawText.length).toBeGreaterThan(0);
    }
    const mapped = f.topics.value.filter((t) => t.state === 'mapped');
    expect(mapped.every((t) => typeof t.topicId === 'string')).toBe(true);
  });

  test('the vocabulary is versioned and mappings are testable in isolation', () => {
    expect(TOPIC_VOCABULARY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    const mapped = normalizeTopics(['מעבר חום', 'בקרה אוטומטית']);
    expect(mapped.find((t) => t.rawText === 'מעבר חום')?.topicId).toBe('heat_transfer');
    expect(mapped.find((t) => t.rawText === 'בקרה אוטומטית')?.topicId).toBe('control');
  });

  test('an unrecognised topic stays UNCERTAIN with its raw text, never invented', () => {
    const [t] = normalizeTopics(['נושא שאינו מוכר לחלוטין']);
    expect(t.state).toBe('uncertain');
    expect(t.topicId).toBeUndefined();
    expect(t.rawText).toBe('נושא שאינו מוכר לחלוטין');
  });

  test('the vocabulary is generic — it encodes no user preference and no course id', () => {
    const mapped = normalizeTopics(['0542-3792', 'הקורס המועדף עליי']);
    expect(mapped.every((t) => t.state === 'uncertain')).toBe(true);
  });
});

// ── determinism + injectable boundary ────────────────────────────────────────

describe('determinism and the extractor boundary', () => {
  test('extraction is deterministic for the same document', async () => {
    const doc = await docFrom(REAL_HTML);
    expect(JSON.stringify(extractor.extract(doc))).toBe(JSON.stringify(extractor.extract(doc)));
  });

  test('a future extractor can be injected without changing consumers', async () => {
    const doc = await docFrom(REAL_HTML);
    const custom: FeatureExtractor = {
      extract: (d) => ({ ...new RuleBasedFeatureExtractor().extract(d), extractionVersion: 'test-9.9.9' }),
    };
    expect(custom.extract(doc).extractionVersion).toBe('test-9.9.9');
  });
});
