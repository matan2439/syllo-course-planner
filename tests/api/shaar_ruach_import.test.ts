import {
  parseShaarRuachCoursesFromHtml,
  mergeShaarRuachCourses,
  buildShaarRuachRepository,
  normalizeShaarRuachCourseId,
  SHAAR_RUACH_SOURCE_URL,
  SHAAR_RUACH_SOURCE_URLS,
  SHAAR_RUACH_CREDITS_RULE,
  SHAAR_RUACH_DEFAULT_CREDITS,
  SHAAR_RUACH_CATEGORY,
} from '../../app/analysis/shaar_ruach_import';
import { buildCompletionAnalysis } from '../../api/ai/completion_analysis';
import { compareShaarRuachCatalogs } from '../../scripts/audit_shaar_ruach';

const STANDARD_HTML_A = `
  <h2 dir="rtl">תולדות האנושות - 3,000 השנים הראשונות</h2>
  <h3 dir="rtl">פרופ' יורם כהן | מס' קורס 0609-1005-01&nbsp;</h3>
  <p>&nbsp;</p>
  <h2 dir="rtl">מהי תרבות? בין מערב למזרח</h2>
  <h3 dir="rtl">ד"ר דנה כהן | מס' קורס 0609-1003-01&nbsp;&nbsp;</h3>
`;

const STANDARD_HTML_B = `
  <h2 dir="rtl">תולדות האנושות - 3,000 השנים הראשונות</h2>
  <h3 dir="rtl">פרופ' יורם כהן | מס' קורס 0609-1005-02&nbsp;</h3>
  <p>&nbsp;</p>
  <h2 dir="rtl">קורס חדש לסמסטר ב</h2>
  <h3 dir="rtl">ד"ר משה לוי | מס' קורס 0609-1099-01&nbsp;</h3>
`;

const FRONTAL_HTML = `
  <div dir="rtl">
  <table cellspacing="0">
    <tbody>
      <tr>
        <td><h3>שם הקורס</h3></td>
        <td><h3>מורה</h3></td>
        <td><h3>מס' קורס</h3></td>
        <td><h3>קישור לסילבוס</h3></td>
      </tr>
      <tr>
        <td><p><strong>רטוריקה ומסר במקרא</strong></p></td>
        <td><p>ד"ר יוסי לוי</p></td>
        <td><p>0612-6041-01</p></td>
        <td><p><a href="https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0612604101&amp;year=2025">לסילבוס המלא&gt;&gt;</a></p></td>
      </tr>
      <tr>
        <td><p><strong>מבוא לאסתטיקה ולפילוסופיה של האמנות</strong></p></td>
        <td><p>פרופ' רינה כהן</p></td>
        <td><p>0618-1059-01</p></td>
        <td><p><a href="https://www.ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0618105901&amp;year=2025">לסילבוס המלא&gt;&gt;</a></p></td>
      </tr>
    </tbody>
  </table>
  </div>
`;

describe('שער רוח importer (app/analysis/shaar_ruach_import.ts)', () => {
  it('1. importer is configured with all 8 source URLs', () => {
    expect(SHAAR_RUACH_SOURCE_URLS.length).toBe(8);
    expect(SHAAR_RUACH_SOURCE_URLS.filter(u => /\/shar_ruach\/courses(\?|$)/.test(u)).length).toBe(4);
    expect(SHAAR_RUACH_SOURCE_URLS.filter(u => /\/shar_ruach\/courses_2/.test(u)).length).toBe(4);
    expect(SHAAR_RUACH_SOURCE_URLS).toContain(SHAAR_RUACH_SOURCE_URL);
  });

  it('2. parser handles standard ##/### course blocks and extracts real names', () => {
    const courses = parseShaarRuachCoursesFromHtml(STANDARD_HTML_A, SHAAR_RUACH_SOURCE_URL);
    expect(courses.length).toBe(2);
    const names = courses.map(c => c.name_he);
    expect(names).toContain('תולדות האנושות - 3,000 השנים הראשונות');
    expect(names).toContain('מהי תרבות? בין מערב למזרח');
    expect(courses.every(c => c.format === 'standard')).toBe(true);
    expect(courses.every(c => c.source_type === 'shaar_ruach')).toBe(true);
    expect(courses.every(c => c.credits === SHAAR_RUACH_DEFAULT_CREDITS)).toBe(true);
    expect(courses.every(c => c.credits_rule === SHAAR_RUACH_CREDITS_RULE)).toBe(true);
  });

  it('3. parser handles frontal table/list format and extracts real names (not link text)', () => {
    const courses = parseShaarRuachCoursesFromHtml(FRONTAL_HTML, SHAAR_RUACH_SOURCE_URL);
    expect(courses.length).toBe(2);
    expect(courses.every(c => c.format === 'frontal')).toBe(true);

    const names = courses.map(c => c.name_he);
    expect(names).toContain('רטוריקה ומסר במקרא');
    expect(names).toContain('מבוא לאסתטיקה ולפילוסופיה של האמנות');
    // must NOT extract generic syllabus link text as the course name
    expect(names.some(n => n.includes('לסילבוס'))).toBe(false);

    const c0 = courses.find(c => c.course_id_base === '0612-6041')!;
    expect(c0.teacher_he).toBe('ד"ר יוסי לוי');
    expect(c0.syllabus_url).toContain('course=0612604101');
    expect(c0.source_confidence).toBe('high');
  });

  it('4. for a fixture with >8 courses, imported count > 8', () => {
    const combined = parseShaarRuachCoursesFromHtml(STANDARD_HTML_A + FRONTAL_HTML, SHAAR_RUACH_SOURCE_URL);
    const moreStandard = `
      <h2 dir="rtl">קורס נוסף 1</h2><h3 dir="rtl">מורה א | מס' קורס 0609-2001-01</h3>
      <h2 dir="rtl">קורס נוסף 2</h2><h3 dir="rtl">מורה ב | מס' קורס 0609-2002-01</h3>
      <h2 dir="rtl">קורס נוסף 3</h2><h3 dir="rtl">מורה ג | מס' קורס 0609-2003-01</h3>
      <h2 dir="rtl">קורס נוסף 4</h2><h3 dir="rtl">מורה ד | מס' קורס 0609-2004-01</h3>
      <h2 dir="rtl">קורס נוסף 5</h2><h3 dir="rtl">מורה ה | מס' קורס 0609-2005-01</h3>
      <h2 dir="rtl">קורס נוסף 6</h2><h3 dir="rtl">מורה ו | מס' קורס 0609-2006-01</h3>
    `;
    const all = parseShaarRuachCoursesFromHtml(STANDARD_HTML_A + FRONTAL_HTML + moreStandard, SHAAR_RUACH_SOURCE_URL);
    expect(combined.length).toBe(4);
    expect(all.length).toBeGreaterThan(8);
  });

  it('5. normalizeShaarRuachCourseId handles dash/dot formats, all mapping to base 0609-1007', () => {
    expect(normalizeShaarRuachCourseId('0609-1007-02')).toEqual({ course_id_base: '0609-1007', section_id: '02', course_id_display: '0609-1007-02' });
    expect(normalizeShaarRuachCourseId('0609.1007.02')).toEqual({ course_id_base: '0609-1007', section_id: '02', course_id_display: '0609.1007.02' });
    expect(normalizeShaarRuachCourseId('0609-1007')).toEqual({ course_id_base: '0609-1007', section_id: null, course_id_display: '0609-1007' });
    expect(normalizeShaarRuachCourseId('0609-1007-01')).toEqual({ course_id_base: '0609-1007', section_id: '01', course_id_display: '0609-1007-01' });
  });

  it('6. duplicate base IDs across semester groups merge offered_semesters instead of overwriting', () => {
    const pageA = parseShaarRuachCoursesFromHtml(STANDARD_HTML_A, SHAAR_RUACH_SOURCE_URL);
    const pageB = parseShaarRuachCoursesFromHtml(STANDARD_HTML_B, 'https://humanities.tau.ac.il/shar_ruach/courses_2');

    const merged = mergeShaarRuachCourses([pageA, pageB]);

    // 0609-1005 appears in both A and B -> merged into a single entry
    const shared = merged.find(c => c.course_id_base === '0609-1005')!;
    expect(shared).toBeDefined();
    expect(shared.offered_semesters.sort()).toEqual(['A', 'B']);

    // 0609-1003 (A only) and 0609-1099 (B only) remain distinct
    expect(merged.find(c => c.course_id_base === '0609-1003')?.offered_semesters).toEqual(['A']);
    expect(merged.find(c => c.course_id_base === '0609-1099')?.offered_semesters).toEqual(['B']);

    // total unique base ids: 1005 (merged), 1003, 1099
    expect(merged.length).toBe(3);
  });

  it('9. audit:shaar-ruach reports missing courses when local JSON has only the old 8', () => {
    // "Official" fixture: old 8 (from STANDARD_HTML_A-like courses) plus
    // several new courses found via the frontal table format.
    const officialPages = [
      parseShaarRuachCoursesFromHtml(STANDARD_HTML_A, SHAAR_RUACH_SOURCE_URL),
      parseShaarRuachCoursesFromHtml(FRONTAL_HTML, SHAAR_RUACH_SOURCE_URL),
    ];

    // Local repo only has the old 8 — represented here by just the
    // 0609-1005 / 0609-1003 courses from STANDARD_HTML_A (none of the
    // frontal-format courses).
    const localOnlyOld8 = buildShaarRuachRepository(
      parseShaarRuachCoursesFromHtml(STANDARD_HTML_A, SHAAR_RUACH_SOURCE_URL),
      SHAAR_RUACH_SOURCE_URLS,
    );

    const result = compareShaarRuachCatalogs(officialPages, localOnlyOld8);

    expect(result.officialCount).toBeGreaterThan(result.localCount);
    expect(result.missing.length).toBeGreaterThan(0);
    expect(result.missing.some(c => c.course_id_base === '0612-6041')).toBe(true);
    expect(result.missing.some(c => c.course_id_base === '0618-1059')).toBe(true);
    expect(result.extra.length).toBe(0);
  });

  it('does not throw on empty/malformed HTML and returns []', () => {
    expect(parseShaarRuachCoursesFromHtml('')).toEqual([]);
    expect(parseShaarRuachCoursesFromHtml('<div><p>not a course list</p></div>')).toEqual([]);
    expect(parseShaarRuachCoursesFromHtml(undefined as any)).toEqual([]);
  });

  it('imported courses are marked as a general requirement, separate category', () => {
    const courses = parseShaarRuachCoursesFromHtml(STANDARD_HTML_A, SHAAR_RUACH_SOURCE_URL);
    for (const c of courses) {
      expect(c.is_general_requirement).toBe(true);
      expect(c.category).toBe(SHAAR_RUACH_CATEGORY);
      expect(c.counts_toward_degree_hours).toBe(true);
      expect(c.does_not_count_as_engineering_elective).toBe(true);
    }
  });

  it('buildShaarRuachRepository produces the data/general_courses_shaar_ruach.json shape', () => {
    const courses = parseShaarRuachCoursesFromHtml(STANDARD_HTML_A, SHAAR_RUACH_SOURCE_URL);
    const repo = buildShaarRuachRepository(courses, SHAAR_RUACH_SOURCE_URLS);
    expect(repo._source).toBe(SHAAR_RUACH_SOURCE_URLS[0]);
    expect(repo._sources).toEqual(SHAAR_RUACH_SOURCE_URLS);
    expect(repo.credits_rule).toBe(SHAAR_RUACH_CREDITS_RULE);
    expect(repo.category).toBe(SHAAR_RUACH_CATEGORY);
    expect(repo.courses.length).toBe(courses.length);
    for (const c of repo.courses) {
      expect(c.credits).toBe(2);
      expect(c.is_general_requirement).toBe(true);
      expect(c.does_not_count_as_engineering_elective).toBe(true);
      expect(c.counts_toward_degree_hours).toBe(true);
      expect(c.course_id_base).toMatch(/^\d{4}-\d{4}$/);
    }
  });

  it('imported שער רוח courses are not counted as engineering electives, and engineering electives are not counted as שער רוח', () => {
    const imported = parseShaarRuachCoursesFromHtml(STANDARD_HTML_A, SHAAR_RUACH_SOURCE_URL);
    const generalCandidates = imported.map(c => ({ course_id: c.course_id, name_he: c.name_he, hours: c.credits }));

    const ctx: any = {
      semesters: [],
      general_course_requirements: { name: 'קורסי שער רוח', required_credits: 6, candidates: generalCandidates },
      category_requirements: [
        {
          name: 'בחירה כללית',
          category_id: 'elective',
          required: 1,
          placed: 0,
          candidates: [...generalCandidates, { course_id: 'E1', name_he: 'בחירה הנדסית', hours: 3 }],
        },
      ],
      total_hours_progress: { known_completed_hours: 0, degree_required_hours: 185, manual_completed_degree_hours: 175, completed_general_hours: 0 },
    };

    const analysis = buildCompletionAnalysis(ctx);

    const generalIds = new Set(generalCandidates.map(c => c.course_id));
    expect(analysis.elective_pool.every((c: any) => !generalIds.has(c.course_id))).toBe(true);
    expect(analysis.elective_pool.map((c: any) => c.course_id)).toEqual(['E1']);
    expect(analysis.general_requirement?.candidates.some((c: any) => c.course_id === 'E1')).toBe(false);
  });
});
