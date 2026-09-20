/**
 * Authoritative syllabus snapshot — canonical, versioned by content hash so a
 * changed syllabus invalidates any derived profile. Built ONLY from the official
 * syllabus text the board already carries (title excluded).
 */
import { buildSyllabusSnapshot, sha256, type SyllabusSnapshot } from '../../api/ai/syllabus_snapshot';

const course = (over: any = {}) => ({
  course_id: '0542-4425',
  name_he: 'הדפסת תלת מימד ותכן חלקי פלסטיקה',
  syllabus_summary_he: 'לימוד שיטות התכן של חלקי פלסטיקה ושימוש בתוכנת SOLIDWORKS',
  syllabus_structure_he: '2.0 שעות הרצאה',
  syllabus_source_url: 'https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0542442501&year=2025',
  syllabus_last_fetched_at: '2026-06-10T21:32:17Z',
  syllabus_confidence: 0.8,
  ...over,
});

test('snapshot captures provenance + normalized official content, title excluded', () => {
  const s = buildSyllabusSnapshot(course(), 'mechanical_engineering_2027');
  expect(s.courseId).toBe('0542-4425');
  expect(s.institution).toBe('TAU');
  expect(s.programOrCatalog).toBe('mechanical_engineering_2027');
  expect(s.sourceType).toBe('official_syllabus');
  expect(s.sourceUrl).toContain('ims.tau.ac.il');
  expect(s.sourceYear).toBe(2025);
  expect(s.language).toBe('he');
  expect(s.retrievedAt).toBe('2026-06-10T21:32:17Z');
  expect(s.normalizedContent).toContain('שיטות התכן');
  expect(s.normalizedContent).not.toContain('הדפסת תלת מימד ותכן חלקי פלסטיקה'); // the TITLE is not in the snapshot content
  expect(s.contentHash).toMatch(/^[0-9a-f]{64}$/);
});

test('content hash is deterministic and changes when the syllabus content changes', () => {
  const a = buildSyllabusSnapshot(course(), 'mech');
  const b = buildSyllabusSnapshot(course(), 'mech');
  const c = buildSyllabusSnapshot(course({ syllabus_summary_he: 'תוכן אחר לגמרי' }), 'mech');
  expect(a.contentHash).toBe(b.contentHash);
  expect(a.contentHash).not.toBe(c.contentHash);
  expect(sha256('x')).not.toBe(sha256('y'));
});

test('a course with no substantive official text yields an empty-content snapshot (sourceType none)', () => {
  const s = buildSyllabusSnapshot(course({ syllabus_summary_he: 'שעות: 4 ש"ס משקל: 4', syllabus_structure_he: '' }), 'mech');
  expect(s.sourceType).toBe('none');
  expect(s.normalizedContent).toBe('');
});
