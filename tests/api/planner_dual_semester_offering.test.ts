/**
 * Dual-Semester Course Placement Flexibility — unit + worker level.
 *
 * Board data records term-of-year offerings as letters (offered_semesters:
 * ["A", "B"]) while the board's real semester ids are full ids
 * (year_3_semester_a …). getLegalSemesters must map the letters onto the known
 * semester ids; otherwise a course whose only availability data is
 * offered_semesters is unplaceable (every ADD/MOVE targets a nonexistent
 * semester) and gets locked into whichever semester the live board happened to
 * put it in — always Semester A in practice.
 */

import { getLegalSemesters } from '../../api/ai/completion_analysis';
import { buildConstraintModel, planContextToState } from '../../api/ai/planner_model';
import { legalSemestersFor } from '../../api/ai/planner_actions';
import { PlannerWorker } from '../../api/ai/planner_worker';

const SEMS = ['year_3_semester_a', 'year_3_semester_b', 'year_4_semester_a', 'year_4_semester_b'];

function board(courses: any[], categories: any[] = [], totalHours = 4, semesterIds: string[] = SEMS) {
  return {
    semesters: semesterIds.map(id => ({ semester_id: id, courses: [] })),
    metadata: {
      completed_course_ids: [],
      program_requirements_categories: { total_required_hours: totalHours, categories },
      program_repository_courses: courses,
    },
  };
}

const DUAL_TERM_LETTERS = {
  course_id: 'DUAL', name_he: 'דואלי', weekly_hours: 4, is_mandatory: false,
  course_type: 'elective', placement_policy: 'elective',
  offered_semesters: ['A', 'B'], program_category_id: 'dualcat', prerequisites: [],
};
const DUAL_CATEGORY = { category_id: 'dualcat', name_he: 'קטגוריה דואלית', min_courses: 1, course_ids: ['DUAL'] };

describe('getLegalSemesters — offered_semesters term letters map onto known semester ids', () => {
  test('1. offered ["A","B"] with year-style known ids → every matching _a/_b id, not the raw letters', () => {
    const course: any = { course_type: 'elective', placement_policy: 'elective', offered_semesters: ['A', 'B'] };
    const { semesters, confident } = getLegalSemesters(course, SEMS);
    expect(semesters.sort()).toEqual([...SEMS].sort());
    expect(confident).toBe(false);
  });

  test('2. offered ["B"] only → only the _b semesters', () => {
    const course: any = { course_type: 'elective', placement_policy: 'elective', offered_semesters: ['B'] };
    const { semesters } = getLegalSemesters(course, SEMS);
    expect(semesters.sort()).toEqual(['year_3_semester_b', 'year_4_semester_b']);
  });

  test('3. control: exact-match vocabulary is unchanged (offered ["A"] with known ids ["A","B"])', () => {
    const course: any = { offered_semesters: ['A'], effective_allowed_semesters: null };
    const { semesters, confident } = getLegalSemesters(course, ['A', 'B']);
    expect(semesters).toEqual(['A']);
    expect(confident).toBe(false);
  });

  test('4. control: unmappable values are kept verbatim (no silent widening)', () => {
    const course: any = { course_type: 'elective', placement_policy: 'elective', offered_semesters: ['SUMMER'] };
    const { semesters, confident } = getLegalSemesters(course, SEMS);
    expect(semesters).toEqual(['SUMMER']);
    expect(confident).toBe(false);
  });

  test('4b. Hebrew half-letters map like their Latin equivalents (same vocabulary the viewer accepts)', () => {
    const course: any = { course_type: 'elective', placement_policy: 'elective', offered_semesters: ['א', 'ב'] };
    const { semesters, confident } = getLegalSemesters(course, SEMS);
    expect(semesters.sort()).toEqual([...SEMS].sort());
    expect(confident).toBe(false);
  });

  test('5. mandatory/flexible branch maps term letters too', () => {
    const course: any = { course_type: 'mandatory', placement_policy: 'flexible', offered_semesters: ['B'] };
    const { semesters, confident } = getLegalSemesters(course, SEMS);
    expect(semesters.sort()).toEqual(['year_3_semester_b', 'year_4_semester_b']);
    expect(confident).toBe(false);
  });
});

describe('planner — a term-letter dual-offered course is placeable, movable, and semester-chosen dynamically', () => {
  test('6. legalSemestersFor returns real board ids for a term-letter-only profile', () => {
    const model = buildConstraintModel(board([DUAL_TERM_LETTERS], [DUAL_CATEGORY]));
    expect(legalSemestersFor(model, 'DUAL').sort()).toEqual([...SEMS].sort());
  });

  test('7. product: a category course with only offered_semesters ["A","B"] gets placed (was unplaceable)', () => {
    const model = buildConstraintModel(board([DUAL_TERM_LETTERS], [DUAL_CATEGORY], 4));
    const w = new PlannerWorker(model);
    w.run(100);
    const placed = Object.values(w.getPlan().semesters).flat();
    expect(placed).toContain('DUAL');
    expect(w.validateCandidate().valid).toBe(true);
  });

  test('8. dynamic choice: Semester B is chosen when A is blocked by the hard cap', () => {
    const fix = {
      course_id: 'FIX', name_he: 'קבוע', weekly_hours: 6, is_mandatory: true,
      course_type: 'mandatory', placement_policy: 'fixed',
      effective_allowed_semesters: ['year_3_semester_a'], recommended_semester: 'year_3_semester_a', prerequisites: [],
    };
    const dual = { ...DUAL_TERM_LETTERS, weekly_hours: 6 };
    const b = board([fix, dual], [DUAL_CATEGORY], 12, ['year_3_semester_a', 'year_3_semester_b']);
    const model = buildConstraintModel(b, { hardCap: 8, maxHoursPerSemester: 8 });
    const w = new PlannerWorker(model);
    w.run(100);
    expect(w.getPlan().semesters['year_3_semester_a']).toEqual(['FIX']);
    expect(w.getPlan().semesters['year_3_semester_b']).toEqual(['DUAL']);
    expect(w.validateCandidate().valid).toBe(true);
  });

  test('9. repair: a term-letter dual course stuck in an overloaded Semester A moves to B', () => {
    const fix = {
      course_id: 'FIX', name_he: 'קבוע', weekly_hours: 6, is_mandatory: true,
      course_type: 'mandatory', placement_policy: 'fixed',
      effective_allowed_semesters: ['year_3_semester_a'], prerequisites: [],
    };
    const dual = { ...DUAL_TERM_LETTERS, weekly_hours: 6 };
    const b: any = board([fix, dual], [DUAL_CATEGORY], 12, ['year_3_semester_a', 'year_3_semester_b']);
    b.semesters[0].courses = [fix, dual]; // live board has both in Semester A → 12h > hardCap 8
    const model = buildConstraintModel(b, { hardCap: 8, maxHoursPerSemester: 8 });
    const initial = planContextToState(
      { semesters: [{ id: 'year_3_semester_a', courses: [{ course_id: 'FIX' }, { course_id: 'DUAL' }] }] },
      model,
    );
    const w = new PlannerWorker(model, initial);
    w.run(100);
    expect(w.getPlan().semesters['year_3_semester_b']).toContain('DUAL');
    expect(w.validateCandidate().valid).toBe(true);
  });

  test('10. control: full-id effective_allowed_semesters behavior is unchanged (B chosen when A blocked)', () => {
    const fix = {
      course_id: 'FIX', name_he: 'קבוע', weekly_hours: 6, is_mandatory: true,
      course_type: 'mandatory', placement_policy: 'fixed',
      effective_allowed_semesters: ['year_3_semester_a'], recommended_semester: 'year_3_semester_a', prerequisites: [],
    };
    const dual = {
      ...DUAL_TERM_LETTERS, weekly_hours: 6,
      effective_allowed_semesters: ['year_3_semester_a', 'year_3_semester_b'],
    };
    const b = board([fix, dual], [DUAL_CATEGORY], 12, ['year_3_semester_a', 'year_3_semester_b']);
    const model = buildConstraintModel(b, { hardCap: 8, maxHoursPerSemester: 8 });
    const w = new PlannerWorker(model);
    w.run(100);
    expect(w.getPlan().semesters['year_3_semester_b']).toEqual(['DUAL']);
    expect(w.validateCandidate().valid).toBe(true);
  });
});
