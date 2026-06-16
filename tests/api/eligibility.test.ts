/**
 * Issue 1 — course eligibility / exclusion layer (api/ai/relevance.ts) and
 * Issue 4 — difficulty estimator (api/ai/completion_analysis.ts).
 *
 * Verifies (general, name-driven — not a single hardcoded id):
 *   - honors courses ("מצטיינים") are ineligible unless the student is honors,
 *   - the pattern generalizes to a SECOND מצטיינים-named course,
 *   - the explicit excluded name ("פרויקט יישומי בהנדסה מכנית") is ineligible
 *     for everyone,
 *   - pickBestCandidate / repairAddMissingElectives never pick an ineligible
 *     course when an eligible alternative exists,
 *   - estimateCourseDifficulty returns a bounded >0 value from signals for a
 *     course with no explicit difficulty/workload score (incl. mandatory).
 */

import {
  isCourseEligible,
  resolveIneligibleCourseIds,
  EXCLUDED_COURSE_NAME_PATTERNS,
  EXCLUDED_COURSE_NAMES,
} from '../../api/ai/relevance';
import {
  pickBestCandidate,
  repairAddMissingElectives,
  estimateCourseDifficulty,
} from '../../api/ai/completion_analysis';

describe('Issue 1 — isCourseEligible (general, name-driven)', () => {
  const honors1 = { course_id: '0542-4011', name_he: 'פרויקט מחקר למצטיינים (1)' };
  const honors2 = { course_id: '0542-4012', name_he: 'פרוייקט מחקר למצטיינים (2)' };
  const excluded = { course_id: '0542-3112', name_he: 'פרויקט יישומי בהנדסה מכנית' };
  const normal = { course_id: 'X1', name_he: 'מבוא לבקרה' };

  test('honors course ineligible when student is NOT honors', () => {
    expect(isCourseEligible(honors1, { is_honors_student: false })).toBe(false);
    expect(isCourseEligible(honors1, undefined)).toBe(false);
  });

  test('honors course eligible when student IS honors', () => {
    expect(isCourseEligible(honors1, { is_honors_student: true })).toBe(true);
  });

  test('pattern generalizes to a SECOND מצטיינים-named course', () => {
    expect(isCourseEligible(honors2, { is_honors_student: false })).toBe(false);
    expect(isCourseEligible(honors2, { is_honors_student: true })).toBe(true);
  });

  test('explicit excluded name is ineligible for everyone', () => {
    expect(isCourseEligible(excluded, { is_honors_student: false })).toBe(false);
    expect(isCourseEligible(excluded, { is_honors_student: true })).toBe(false);
  });

  test('normal course always eligible', () => {
    expect(isCourseEligible(normal, { is_honors_student: false })).toBe(true);
  });

  test('config is data-driven and extensible', () => {
    expect(EXCLUDED_COURSE_NAME_PATTERNS).toContain('מצטיינים');
    expect(EXCLUDED_COURSE_NAMES).toContain('פרויקט יישומי בהנדסה מכנית');
  });

  test('resolveIneligibleCourseIds returns all ineligible ids by name', () => {
    const ids = resolveIneligibleCourseIds([honors1, honors2, excluded, normal], { is_honors_student: false });
    expect(ids.has('0542-4011')).toBe(true);
    expect(ids.has('0542-4012')).toBe(true);
    expect(ids.has('0542-3112')).toBe(true);
    expect(ids.has('X1')).toBe(false);
  });
});

describe('Issue 1 — selection paths skip ineligible courses', () => {
  const cands = [
    { course_id: '0542-4012', name_he: 'פרויקט מחקר למצטיינים (2)' },
    { course_id: 'GOOD', name_he: 'מבוא למוצקים' },
  ];

  test('pickBestCandidate chooses the eligible alternative, not the honors course', () => {
    const picked = pickBestCandidate(cands, new Set(), null, { is_honors_student: false });
    expect(picked?.course_id).toBe('GOOD');
  });

  test('repairAddMissingElectives does not add the honors course; picks eligible alt', () => {
    const analysis: any = {
      categories: [{ name: 'בחירה', missing: 1, candidates: cands }],
      missing_mandatory: [],
    };
    const { proposal, added } = repairAddMissingElectives(
      { semesters: [{ semester_id: 's1', course_ids: [] }] },
      analysis,
      {
        courses: { '0542-4012': { hours: 4 }, GOOD: { hours: 4 } },
        knownSemesterIds: ['s1'],
        eligibilityPrefs: { is_honors_student: false },
      },
    );
    const allIds = proposal.semesters.flatMap(s => s.course_ids);
    expect(allIds).toContain('GOOD');
    expect(allIds).not.toContain('0542-4012');
    expect(added.map(a => a.course_id)).toEqual(['GOOD']);
  });
});

describe('Issue 4 — estimateCourseDifficulty (bounded, null-guarded)', () => {
  test('mandatory course with no explicit score gets a >0 estimate from signals', () => {
    const c = {
      weekly_hours: 14,
      syllabus_summary_he: 'קורס הכולל מעבדה ופרויקט גמר ומבחן מסכם',
      prerequisite_course_ids: ['A', 'B', 'C'],
    };
    const est = estimateCourseDifficulty(c);
    expect(est).not.toBeNull();
    expect(est!).toBeGreaterThan(0);
    expect(est!).toBeLessThanOrEqual(5);
  });

  test('returns null when no signal at all', () => {
    expect(estimateCourseDifficulty({})).toBeNull();
    expect(estimateCourseDifficulty(null)).toBeNull();
  });

  test('a heavier course estimates higher than a light one', () => {
    const heavy = estimateCourseDifficulty({ weekly_hours: 16, syllabus_summary_he: 'מעבדה פרויקט גמר מבחן '.repeat(20), prerequisite_course_ids: ['a', 'b', 'c'] })!;
    const light = estimateCourseDifficulty({ weekly_hours: 2 })!;
    expect(heavy).toBeGreaterThan(light);
  });
});
