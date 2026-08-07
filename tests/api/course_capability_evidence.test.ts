/**
 * Course-knowledge layer: evidence about what a course actually teaches, extracted
 * from the OFFICIAL syllabus text carried in the board (syllabus_summary_he +
 * provenance), NOT from the course title. A title may locate a course but is never
 * proof of its content.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  extractCourseCapabilityEvidence,
  type CourseCapabilityEvidence,
} from '../../api/ai/course_capability_evidence';

const BOARD = JSON.parse(readFileSync(join(__dirname, '..', '..', 'data', 'boards', 'mechanical_engineering_2027.json'), 'utf8'));
const byId = new Map<string, any>();
for (const s of BOARD.semesters) for (const c of (s.courses || [])) byId.set(c.course_id, c);
for (const c of (BOARD.metadata?.program_repository_courses || [])) byId.set(c.course_id, c);
const ev = (id: string): CourseCapabilityEvidence => extractCourseCapabilityEvidence(byId.get(id), 'mechanical_design');

describe('real official-syllabus evidence for mechanical_design', () => {
  test('0542-4425 (3D-print & plastic part design) — EXPLICIT design evidence from official syllabus, with provenance', () => {
    const e = ev('0542-4425');
    expect(e.inferenceLevel).toBe('explicit');
    expect(e.strength).toBeGreaterThan(0.5);
    expect(e.sourceType).toBe('official_syllabus');
    expect(e.sourceUrl).toContain('ims.tau.ac.il');
    expect(e.extractedEvidence).toContain('שיטות התכן'); // the actual quote, not the title
    expect(e.retrievedAt).toBeTruthy();
    expect(e.confidence).toBeGreaterThan(0);
  });

  test('0542-2400 (mechanical design 1) — EXPLICIT design evidence from official syllabus', () => {
    const e = ev('0542-2400');
    expect(e.inferenceLevel).toBe('explicit');
    expect(e.extractedEvidence).toContain('תכן');
    expect(e.strength).toBeGreaterThan(0.5);
  });

  test('0542-4420 (theory of machines) — NO design evidence: its syllabus is machine THEORY, not design (title "מכונות" is not proof)', () => {
    const e = ev('0542-4420');
    expect(e.inferenceLevel).toBe('missing');
    expect(e.strength).toBe(0);
    expect(e.extractedEvidence).toBeNull();
  });

  test('0542-4422 (engineering design: intro & methods) — MISSING: title says design but the official summary is boilerplate; not fabricated into high-confidence evidence', () => {
    const e = ev('0542-4422');
    expect(e.inferenceLevel).toBe('missing');
    expect(e.strength).toBe(0);
  });
});

describe('inference-level distinctions (deterministic, from supplied official text only)', () => {
  const mk = (courseId: string, summary: string, over: any = {}) =>
    extractCourseCapabilityEvidence(
      { course_id: courseId, name_he: 'IRRELEVANT TITLE מכונות תכן', syllabus_summary_he: summary, syllabus_source_url: 'https://ims.tau.ac.il/x', syllabus_confidence: 0.8, syllabus_last_fetched_at: '2026-06-10T00:00:00Z', ...over },
      'mechanical_design',
    );

  test('explicit vs derived vs missing are distinguishable', () => {
    expect(mk('X', 'הקורס עוסק בשיטות תכן הנדסי ובתהליך תכן').inferenceLevel).toBe('explicit');
    expect(mk('X', 'הקורס משתמש בתוכנת SOLIDWORKS ובהדפסת אב טיפוס').inferenceLevel).toBe('derived');
    expect(mk('X', 'הקורס עוסק במכניזמים ובתורת המכונות').inferenceLevel).toBe('missing');
  });

  test('the content-sense of תכן ("תכן הקורס" = course content) is NOT design evidence (false-friend guard)', () => {
    expect(mk('X', 'תכן הקורס: הגדרות יסוד, ערך ממוצע, וערך RMS').inferenceLevel).toBe('missing');
  });

  test('low source confidence downgrades a derived mention to estimated (never presented as certain)', () => {
    expect(mk('X', 'הקורס משתמש בתוכנת CAD', { syllabus_confidence: 0.3 }).inferenceLevel).toBe('estimated');
  });

  test('the title is NEVER read as evidence (title full of מכונות/תכן, but empty syllabus → missing)', () => {
    const e = mk('X', '');
    expect(e.inferenceLevel).toBe('missing');
    expect(e.sourceType).toBe('none');
  });

  test('a non-design capability has no extractor yet → honest missing, never fabricated', () => {
    const e = extractCourseCapabilityEvidence(byId.get('0542-4425'), 'robotics');
    expect(e.inferenceLevel).toBe('missing');
  });
});
