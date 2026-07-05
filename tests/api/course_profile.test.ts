/**
 * Tests for api/ai/course_profile.ts — buildCourseProfiles over the FULL
 * eligible course universe (plan tests 1 & 2).
 *
 * The "universe" of a program board is the union of:
 *   - every course placed in a semester, and
 *   - every course in metadata.program_repository_courses (the elective pool).
 * buildCourseProfiles must produce a CourseProfile for EVERY such course — no
 * truncation, no top-N, no category pre-filter. Pre-filtering is allowed only
 * for explicit user exclusion (recorded as excluded=true, never dropped).
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { buildCourseProfiles, type CourseProfile } from '../../api/ai/course_profile';

const REAL_BOARD = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', 'data', 'parsed_json', 'mechanical_semester_board_2027.json'),
    'utf8',
  ),
);

/** course_ids that make up the real eligible universe, computed from raw JSON. */
function universeIds(board: any): Set<string> {
  const ids = new Set<string>();
  for (const sem of board.semesters ?? []) {
    for (const c of sem.courses ?? []) ids.add(c.course_id);
  }
  for (const c of board.metadata?.program_repository_courses ?? []) ids.add(c.course_id);
  return ids;
}

// ── A small synthetic board for controlled field-level assertions ─────────────

const TINY_BOARD = {
  semesters: [
    {
      semester_id: 'year_3_semester_a',
      display_name: "שנה ג׳ — סמסטר א׳",
      courses: [
        {
          course_id: '0540-0001',
          name_he: 'מתמטיקה',
          weekly_hours: 5,
          course_type: 'mandatory',
          is_mandatory: true,
          placement_policy: 'fixed',
          recommended_semester: 'year_3_semester_a',
          effective_allowed_semesters: ['year_3_semester_a'],
          prerequisites: [],
          difficulty_score: 4,
          difficulty_level: 'קשה',
          difficulty_confidence: 0.9,
          syllabus_text_available: true,
          syllabus_summary_he: 'סיכום',
          syllabus_topics_he: ['נושא א', 'נושא ב'],
          syllabus_confidence: 0.8,
          program_category_id: null,
          source: 'program',
        },
      ],
    },
  ],
  metadata: {
    program_repository_courses: [
      {
        // an elective with almost no data — must still get a profile, low confidence
        course_id: '0542-9999',
        name_he: null,
        weekly_hours: null,
        category_id: 'fluids',
        program_category_name_he: 'זורמים',
        offered_semesters: ['year_4_semester_a', 'year_4_semester_b'],
        source: 'elective',
      },
      {
        course_id: '0542-4123',
        name_he: 'תהליכי מעבר',
        weekly_hours: 3,
        category_id: 'fluids',
        offered_semesters: ['year_4_semester_a', 'year_4_semester_b'],
        effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'],
        difficulty_score: 3,
        difficulty_confidence: 0.7,
        offering_source_confidence: 0.9,
        source: 'elective',
      },
    ],
    program_requirements_categories: { categories: [] },
  },
};

describe('buildCourseProfiles — full universe coverage (test 1)', () => {
  it('produces a profile for every course in the real ME-2027 universe', () => {
    const profiles = buildCourseProfiles(REAL_BOARD, {});
    const expected = universeIds(REAL_BOARD);
    // Every universe course has a profile…
    for (const id of expected) {
      expect(profiles.has(id)).toBe(true);
    }
    // …and the profile set is exactly the universe (no extras, no truncation).
    expect(profiles.size).toBe(expected.size);
    expect(expected.size).toBeGreaterThan(40); // sanity: this is not a tiny subset
  });

  it('does not drop courses just because they have no category or are elective', () => {
    const profiles = buildCourseProfiles(TINY_BOARD as any, {});
    expect(profiles.has('0542-9999')).toBe(true); // data-poor elective kept
    expect(profiles.has('0540-0001')).toBe(true);
    expect(profiles.size).toBe(3);
  });
});

describe('buildCourseProfiles — profile coverage & fields (test 2)', () => {
  const profiles = buildCourseProfiles(TINY_BOARD as any, {
    wantedCourseIds: ['0542-4123'],
    unwantedCourseIds: [],
    disallowedCourseIds: ['0542-9999'],
  });

  it('maps core identity, hours, category and mandatory flags', () => {
    const m = profiles.get('0540-0001') as CourseProfile;
    expect(m.course_id).toBe('0540-0001');
    expect(m.name_he).toBe('מתמטיקה');
    expect(m.hours).toBe(5);
    expect(m.is_mandatory).toBe(true);
    expect(m.placement_policy).toBe('fixed');
  });

  it('captures offering, prerequisites, syllabus and workload signals', () => {
    const m = profiles.get('0540-0001') as CourseProfile;
    expect(m.effective_allowed_semesters).toEqual(['year_3_semester_a']);
    expect(m.prerequisites).toEqual([]);
    expect(m.syllabus_available).toBe(true);
    expect(m.syllabus_topics_he).toEqual(['נושא א', 'נושא ב']);
    expect(m.difficulty_score).toBe(4);
  });

  it('records the category bucket for repository electives', () => {
    const e = profiles.get('0542-4123') as CourseProfile;
    expect(e.category_id).toBe('fluids');
    expect(e.hours).toBe(3);
  });

  it('reflects user preference relations', () => {
    const e = profiles.get('0542-4123') as CourseProfile;
    expect(e.is_wanted).toBe(true);
  });

  it('marks an explicitly disallowed course as excluded WITH a reason, never dropped', () => {
    const x = profiles.get('0542-9999') as CourseProfile;
    expect(x).toBeDefined();
    expect(x.excluded).toBe(true);
    expect(typeof x.exclusion_reason).toBe('string');
    expect((x.exclusion_reason ?? '').length).toBeGreaterThan(0);
  });

  it('assigns low data_confidence (<0.6) to a data-poor course and high to a rich one', () => {
    const poor = profiles.get('0542-9999') as CourseProfile;
    const rich = profiles.get('0540-0001') as CourseProfile;
    expect(poor.data_confidence).toBeGreaterThanOrEqual(0);
    expect(poor.data_confidence).toBeLessThan(0.6);
    expect(rich.data_confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('every profile carries provenance', () => {
    for (const p of profiles.values()) {
      expect(p.provenance).toBeDefined();
      expect('source' in p.provenance).toBe(true);
    }
  });
});
