import {
  parseShaarRuachCoursesFromHtml,
  buildShaarRuachRepository,
  SHAAR_RUACH_SOURCE_URL,
  SHAAR_RUACH_CREDITS_RULE,
  SHAAR_RUACH_DEFAULT_CREDITS,
  SHAAR_RUACH_CATEGORY,
} from '../../app/analysis/shaar_ruach_import';
import { buildCompletionAnalysis } from '../../api/ai/completion_analysis';

describe('שער רוח importer (app/analysis/shaar_ruach_import.ts)', () => {
  const htmlWithSyllabus = `
    <div class="courses-list">
      <a href="/Tal/Syllabus/Syllabus_L.aspx?course=0609100501&year=2025">תולדות האנושות - 3,000 השנים הראשונות</a>
      <a href="/Tal/Syllabus/Syllabus_L.aspx?course=0609100301&year=2025">מהי תרבות? בין מערב למזרח</a>
    </div>
  `;

  it('1. the שער רוח source URL is handled by this separate parser/importer', () => {
    const courses = parseShaarRuachCoursesFromHtml(htmlWithSyllabus, SHAAR_RUACH_SOURCE_URL);
    expect(courses.length).toBeGreaterThan(0);
    expect(courses.every(c => c.source_url === SHAAR_RUACH_SOURCE_URL)).toBe(true);
  });

  it('2. source_type is "shaar_ruach"', () => {
    const courses = parseShaarRuachCoursesFromHtml(htmlWithSyllabus);
    expect(courses.every(c => c.source_type === 'shaar_ruach')).toBe(true);
  });

  it('3. credits default to the known value 2', () => {
    const courses = parseShaarRuachCoursesFromHtml(htmlWithSyllabus);
    expect(courses.length).toBe(2);
    expect(courses.every(c => c.credits === SHAAR_RUACH_DEFAULT_CREDITS)).toBe(true);
    expect(courses.every(c => c.credits_rule === SHAAR_RUACH_CREDITS_RULE)).toBe(true);
  });

  it('4. missing syllabus link does not crash the import — kept as a low-confidence fallback', () => {
    const htmlMixed = `
      <div class="courses-list">
        <a href="/Tal/Syllabus/Syllabus_L.aspx?course=0609100701&year=2025">תעלומת הבלש</a>
        <a href="/shar_ruach/courses/some-course-without-syllabus">קורס בלי סילבוס</a>
      </div>
    `;
    const courses = parseShaarRuachCoursesFromHtml(htmlMixed);
    expect(courses.length).toBe(2);

    const withSyllabus = courses.find(c => c.course_id === '0609-1007')!;
    expect(withSyllabus.syllabus_text_available).toBe(true);
    expect(withSyllabus.source_confidence).toBe('high');
    expect(withSyllabus.credits).toBe(2);

    const fallback = courses.find(c => c.name_he.includes('קורס בלי סילבוס'))!;
    expect(fallback).toBeDefined();
    expect(fallback.syllabus_text_available).toBe(false);
    expect(['medium', 'low']).toContain(fallback.source_confidence);
    expect(fallback.credits).toBe(2);
  });

  it('does not throw on empty/malformed HTML and returns []', () => {
    expect(parseShaarRuachCoursesFromHtml('')).toEqual([]);
    expect(parseShaarRuachCoursesFromHtml('<div><p>not a course list</p></div>')).toEqual([]);
    expect(parseShaarRuachCoursesFromHtml(undefined as any)).toEqual([]);
  });

  it('5. imported courses are marked as a general requirement, separate category', () => {
    const courses = parseShaarRuachCoursesFromHtml(htmlWithSyllabus);
    for (const c of courses) {
      expect(c.is_general_requirement).toBe(true);
      expect(c.category).toBe(SHAAR_RUACH_CATEGORY);
      expect(c.counts_toward_degree_hours).toBe(true);
      expect(c.does_not_count_as_engineering_elective).toBe(true);
    }
  });

  it('buildShaarRuachRepository produces the data/general_courses_shaar_ruach.json shape', () => {
    const courses = parseShaarRuachCoursesFromHtml(htmlWithSyllabus);
    const repo = buildShaarRuachRepository(courses);
    expect(repo._source).toBe(SHAAR_RUACH_SOURCE_URL);
    expect(repo.credits_rule).toBe(SHAAR_RUACH_CREDITS_RULE);
    expect(repo.category).toBe(SHAAR_RUACH_CATEGORY);
    expect(repo.courses.length).toBe(courses.length);
    for (const c of repo.courses) {
      expect(c.credits).toBe(2);
      expect(c.is_general_requirement).toBe(true);
      expect(c.does_not_count_as_engineering_elective).toBe(true);
      expect(c.counts_toward_degree_hours).toBe(true);
    }
  });

  it('6. imported שער רוח courses are not counted as engineering electives, and 7. engineering electives are not counted as שער רוח', () => {
    const imported = parseShaarRuachCoursesFromHtml(htmlWithSyllabus);
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

    // imported שער רוח courses must not appear in the engineering elective pool
    const generalIds = new Set(generalCandidates.map(c => c.course_id));
    expect(analysis.elective_pool.every(c => !generalIds.has(c.course_id))).toBe(true);
    expect(analysis.elective_pool.map(c => c.course_id)).toEqual(['E1']);

    // the engineering elective E1 must not appear in the שער רוח candidate pool
    expect(analysis.general_requirement?.candidates.some(c => c.course_id === 'E1')).toBe(false);
  });
});
