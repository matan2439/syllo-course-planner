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

// ── Catalog integrity (test 3) ────────────────────────────────────────────────
// A course that lacks an AUTHORITATIVE Hebrew name has no valid catalog record
// to display or validate against. It must never be silently placed into an
// applicable proposal (which would render a "פרטי הקורס אינם זמינים" card the
// student could then Apply). It is kept in the universe (never dropped, so the
// trace can still explain it) but flagged excluded so isExcluded() keeps it out
// of every ADD/REPLACE candidate — the same mechanism explicit user exclusion
// already uses. A required (mandatory/category) course flagged this way surfaces
// through the existing missing-mandatory / unsatisfied-category gates, i.e. it
// BLOCKS rather than silently placing an unnamed card.
describe('buildCourseProfiles — catalog integrity (test 3)', () => {
  it('flags a name-less repository elective excluded WITHOUT any user exclusion', () => {
    const profiles = buildCourseProfiles(TINY_BOARD as any, {}); // no disallow at all
    const x = profiles.get('0542-9999') as CourseProfile;
    expect(x).toBeDefined();            // kept in the universe, never dropped
    expect(x.excluded).toBe(true);      // …but not a legal ADD candidate
    expect(typeof x.exclusion_reason).toBe('string');
    expect((x.exclusion_reason ?? '').length).toBeGreaterThan(0);
  });

  it('leaves a fully-named elective addable (excluded=false)', () => {
    const profiles = buildCourseProfiles(TINY_BOARD as any, {});
    const e = profiles.get('0542-4123') as CourseProfile;
    expect(e.excluded).toBe(false);
  });

  it('a user-disallowed course keeps its explicit-exclusion reason (precedence over catalog gate)', () => {
    const profiles = buildCourseProfiles(TINY_BOARD as any, { disallowedCourseIds: ['0542-4123'] });
    const e = profiles.get('0542-4123') as CourseProfile;
    expect(e.excluded).toBe(true);
    expect(e.exclusion_reason).toMatch(/חריגה|לא-זמין/); // the user-exclusion wording, not the catalog one
  });

  it('marks EVERY name-less OR hours-less universe course excluded on the real ME-2027 board', () => {
    const profiles = buildCourseProfiles(REAL_BOARD, {});
    let checked = 0;
    for (const p of profiles.values()) {
      const named = typeof p.name_he === 'string' && p.name_he.trim().length > 0;
      const houred = typeof p.hours === 'number' && Number.isFinite(p.hours);
      if (!named || !houred) {
        expect(p.excluded).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0); // fixture really does contain such courses
  });

  it('a course with no authoritative weekly-hours is excluded even when it HAS a name', () => {
    const board = {
      semesters: [{ semester_id: 'year_3_semester_a', courses: [] }],
      metadata: {
        program_repository_courses: [
          { course_id: 'HRS', name_he: 'קורס עם שם בלי שעות', weekly_hours: null, source: 'elective' },
        ],
        program_requirements_categories: { categories: [] },
      },
    };
    const p = buildCourseProfiles(board as any, {}).get('HRS') as CourseProfile;
    expect(p.name_he).toBe('קורס עם שם בלי שעות'); // name kept for the trace
    expect(p.excluded).toBe(true);                 // …but not a legal ADD candidate
    expect(p.exclusion_reason).toMatch(/שעות|נקודות/);
  });

  it('a course with no canonical course ID never becomes a profile', () => {
    const board = {
      semesters: [{ semester_id: 'year_3_semester_a', courses: [{ name_he: 'ללא מזהה', weekly_hours: 3 }] }],
      metadata: { program_requirements_categories: { categories: [] } },
    };
    const profiles = buildCourseProfiles(board as any, {});
    expect(profiles.size).toBe(0); // a non-string/absent course_id is skipped, never planned over
  });

  it('an authoritative EMPTY prerequisites list ([] = "no prerequisites") never excludes a course', () => {
    // TINY_BOARD's 0542-4123 has no prerequisites key → parsed as [] → must stay addable.
    const e = buildCourseProfiles(TINY_BOARD as any, {}).get('0542-4123') as CourseProfile;
    expect(e.prerequisites).toEqual([]); // authoritative "no prerequisites", not missing metadata
    expect(e.excluded).toBe(false);      // a valid, applicable course
  });
});
