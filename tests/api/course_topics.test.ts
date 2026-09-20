/**
 * T3 — normalized topic knowledge from the official course-content field.
 *
 * The K8A audit rejected topic alignment on `נושאי לימוד` coverage of 1/7
 * courses. That measurement was right about that sub-label and wrong about the
 * source: the official syllabus carries a labelled `תוכן הקורס ומטרתו` section,
 * present on 23/23 acquired documents, which is what actually describes content.
 *
 * The danger this suite exists to pin down is that the section ALSO contains
 * prerequisite and recommendation clauses naming other subjects. Reading
 * "דרישות קדם: מכניקת הזורמים" as "this course teaches fluid mechanics" is
 * exactly the inference the pipeline forbids, so those clauses are excluded by a
 * deterministic rule, and that exclusion is tested against real corpus wording.
 *
 * Every excerpt below is a short official phrase, retained verbatim precisely so
 * a mapping can be audited against the source.
 */
import {
  extractCourseTopics,
  TOPIC_MAPPER_VERSION,
  TOPIC_IDS,
  type TopicId,
} from '../../api/ai/course_topics';
import type { SyllabusDocument } from '../../api/ai/syllabus_source';

const YEAR = 2025;

function doc(courseId: string, content: string, over: Partial<SyllabusDocument> = {}): SyllabusDocument {
  return {
    institutionId: 'tau.ac.il', courseId, academicYear: YEAR,
    sourceUrl: `https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=${courseId.replace('-', '')}01&year=${YEAR}`,
    contentHash: `sha_${courseId}`, retrievedAt: '2026-08-14T00:00:00.000Z',
    labeledFields: { 'מספר קורס': [`${courseId}-01`] },
    text: `מספר קורס ${courseId}-01 תוכן הקורס ומטרתו ${content} מטלות הקורס`,
    ...over,
  };
}

const topicsOf = (d: SyllabusDocument): TopicId[] =>
  [...new Set(extractCourseTopics(d).assertions.map((a) => a.topicId))].sort();

// ── the assertion contract ───────────────────────────────────────────────────

describe('T3 — every topic assertion is auditable back to official wording', () => {
  const d = doc('0542-4624', 'הכרת זרוע רובוטית, קינמטיקה ישירה והפוכה, תכנון מסלול פולינומיאלי.');
  const a = extractCourseTopics(d).assertions[0];

  test('it carries the raw official wording, verbatim', () => {
    expect(d.text).toContain(a.rawWording);
  });

  test('it carries topic id, evidence id, source, year and mapper version', () => {
    expect(TOPIC_IDS).toContain(a.topicId);
    expect(a.evidenceId).toBe(d.contentHash);
    expect(a.sourceRef).toContain('ims.tau.ac.il');
    expect(a.academicYear).toBe(YEAR);
    expect(a.mapperVersion).toBe(TOPIC_MAPPER_VERSION);
  });

  test('it records language, confidence, ambiguity and status', () => {
    expect(a.language).toBe('he');
    expect(a.confidence).toBeGreaterThan(0);
    expect(a.ambiguous).toBe(false);
    expect(a.status).toBe('current');
  });

  test('content is COURSE-scoped — the corpus publishes it identically per group', () => {
    expect(a.scope).toBe('course');
  });

  test('extraction is deterministic and order-stable', () => {
    expect(JSON.stringify(extractCourseTopics(d))).toBe(JSON.stringify(extractCourseTopics(d)));
  });
});

// ── controlled mapping, on real corpus wording ───────────────────────────────

describe('T3 — controlled mappings over official wording', () => {
  test.each<[string, string, TopicId[]]>([
    ['robotics + control lab', 'הכרת זרוע רובוטית, קינמטיקה ישירה והפוכה, תכנון תנועה לרובוט נייד בעזרת RRT, משוב כוח.', ['control', 'robotics']],
    ['engineering design', 'תכן (עיצוב) הנדסי הוא אוסף של רעיונות, שיטות, כלים ודרכי חשיבה.', ['engineering_design']],
    ['materials lab', 'ניסויים בהבנת עולם החומר, בדיקת המבנה המטלוגרפי של נתכי נחושת-אבץ, טיפולים תרמיים.', ['materials']],
    ['thermofluids + energy systems lab', 'מערכות קירור ומיזוג אוויר, זרימה בנחיר, נדגים את תופעת גל הלם, מחליפי החום.', ['energy_systems', 'thermofluids']],
    ['3D printing + FEA + materials', 'לימוד הטכנולוגיות להדפסה תלת-מימדית, לימוד פולימרים, שימוש בכלי האנליזה (FEA) לתכן מתקדם.', ['finite_element_analysis', 'manufacturing', 'materials']],
    ['mechatronics', 'תכן מכני, תכנות בקרים, ותכן מעגל חשמלי בשילוב חיישנים ומפעילים, מיקרו-בקר.', ['control', 'engineering_design', 'programming_electronics']],
    ['manufacturing from design', 'נלמדים סוגים שונים של תהליכי ייצור, הקורס עוסק בתהליכי עיבוד שבבי.', ['manufacturing']],
  ])('%s', (_label, content, expected) => {
    expect(topicsOf(doc('0542-0001', content))).toEqual(expected);
  });

  test('English official wording is supported alongside Hebrew', () => {
    const a = extractCourseTopics(doc('0542-0002', 'Injection Molding technologies and product design.')).assertions;
    expect(a.map((x) => x.topicId)).toContain('manufacturing');
    expect(a.find((x) => x.topicId === 'manufacturing')!.language).toBe('en');
  });

  test('the taxonomy contains no entry that the corpus never evidenced', () => {
    // Guards against adding an id because a USER asked for it rather than
    // because an official document says it.
    expect([...TOPIC_IDS].sort()).toEqual([
      'control', 'energy_systems', 'engineering_design', 'finite_element_analysis', 'manufacturing',
      'materials', 'programming_electronics', 'robotics', 'solid_mechanics', 'thermofluids',
    ]);
  });
});

// ── what must NOT be mapped ──────────────────────────────────────────────────

describe('T3 — inference is refused', () => {
  test('bare conservation-of-energy wording does not become an energy-systems claim', () => {
    expect(topicsOf(doc('0542-0003', 'יישום משוואת שימור אנרגיה בבעיה מכנית.'))).not.toContain('energy_systems');
  });

  test('a PREREQUISITE clause never becomes a topic of this course', () => {
    // Real 0542-3792 wording: these are prerequisites, not what the course covers.
    const content = 'דרישות קדם: מבוא להסתברות וסטטיסטיקה;מכניקת המוצקים (1) ו-מכניקת הזורמים (1). נושאי לימוד: כיולים.';
    expect(topicsOf(doc('0542-3792', content))).not.toContain('solid_mechanics');
    expect(topicsOf(doc('0542-3792', content))).not.toContain('thermofluids');
  });

  test('a RECOMMENDATION clause never becomes a topic of this course', () => {
    // Real 0542-3792 wording — a recommendation about OTHER courses.
    const content = 'מומלץ ללמוד אלקטרוניקה בסיסית ומעבר חום במקביל לקורס.';
    expect(topicsOf(doc('0542-3792', content))).toEqual([]);
  });

  test('the real prerequisite line of the numerical-simulation lab is excluded', () => {
    const only = 'שעות: 2 ש\', 3 מ\' משקל: 3.5 דרישות קדם: מכניקת הזורמים (1), מעבר חום.';
    expect(topicsOf(doc('0542-4391', only))).toEqual([]);
  });

  test('a line-delimited prerequisite without punctuation does not erase the next content paragraph', () => {
    // Real 0542-4422 shape: the prerequisite line has no full stop, while the
    // next paragraph begins the authoritative course content.
    const content = 'דרישות קדם: אלגברה לינארית\n\nתכן הנדסי הוא אוסף של רעיונות ושיטות.';
    expect(topicsOf(doc('0542-4422', content))).toContain('engineering_design');
  });

  test('the course TITLE is never used as content evidence', () => {
    const titled = doc('0542-4624', 'הקורס יתקיים במעבדה.', {
      labeledFields: { 'מספר קורס': ['0542-4624-01'], 'שם הקורס': ['מעבדה ברובוטיקה ובקרה של מערכות'] },
    });
    expect(topicsOf(titled)).toEqual([]);
  });

  test('a document with NO content section yields no topics and is flagged unavailable', () => {
    const bare = doc('0542-0003', '');
    const r = extractCourseTopics({ ...bare, text: 'מספר קורס 0542-0003-01 מטלות הקורס' });
    expect(r.assertions).toEqual([]);
    expect(r.contentAvailable).toBe(false);
  });

  test('an off-domain course yields NO engineering topics', () => {
    // Real 0555-4000 (ethics) wording.
    const content = 'זהו קורס אינטרדיסציפלינרי למנהיגות, קבלת החלטות ויישום האתיקה לבעיות בעולם האמיתי.';
    expect(topicsOf(doc('0555-4000', content))).toEqual([]);
  });

  test('a bare ambiguous word stays inert and is disclosed, not mapped', () => {
    // Real 0542-4391 wording: "בקרה" here means control OF THE SOLUTION PROCESS.
    const content = 'כלים לבקרה על מהלך הפתרון, בדיקת התכנסות.';
    const r = extractCourseTopics(doc('0542-4391', content));
    expect(r.assertions).toEqual([]);
    expect(r.ambiguousPhrases.length).toBeGreaterThan(0);
  });

  test('an unambiguous control phrase IS mapped, so ambiguity is not blanket suppression', () => {
    expect(topicsOf(doc('0542-4624', 'זיהוי מערכת, בקרה, תכנון תנועה לרובוט נייד.'))).toContain('control');
  });

  test('substrings inside unrelated words do not match', () => {
    // "החומר הנלמד" = the studied MATERIAL(=subject matter), not materials science.
    expect(topicsOf(doc('0542-0004', 'בחינה סופית על כל החומר הנלמד בהרצאות.'))).toEqual([]);
  });
});

// ── multi-topic and duplicate evidence ───────────────────────────────────────

describe('T3 — multi-topic courses and duplicate evidence', () => {
  test('a course may support several topics, with no forced primary', () => {
    const r = extractCourseTopics(doc('0542-4559', 'תכן מכני, הדפסת תלת-מימד, תכנות בקרים, תכן מעגל חשמלי בשילוב חיישנים.'));
    const ids = [...new Set(r.assertions.map((a) => a.topicId))];
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(r).not.toHaveProperty('primaryTopic');
  });

  test('the SAME topic stated twice in one document is one supported topic', () => {
    const r = extractCourseTopics(doc('0542-4624', 'זרוע רובוטית ורובוטיקה ניידת, רובוט נייד.'));
    expect(r.assertions.filter((a) => a.topicId === 'robotics').length).toBeGreaterThan(1);
    expect(new Set(r.assertions.map((a) => a.topicId)).size).toBe(1);
  });

  test('a stale document (another year) is marked stale, never current', () => {
    const old = doc('0542-4624', 'זרוע רובוטית.', { academicYear: 2019 });
    const r = extractCourseTopics(old, { academicYear: YEAR });
    expect(r.assertions.every((a) => a.status === 'stale')).toBe(true);
  });
});
