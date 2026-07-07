/**
 * generate-plan interest-evaluation helper — tests for
 * api/ai/generate_plan_interest_evaluation.ts.
 *
 * extractPlannedCourseIds flattens a proposal's semesters into the planned
 * course-id list (order preserved, never reordered). buildGeneratePlanInterestEvaluation
 * normalizes the raw request profile, resolves topic profiles via the real
 * full-catalog Mechanical Engineering 2027 resolver, and runs
 * evaluateAcademicInterestFit — a pure, additive evidence package. No LLM, no
 * plan mutation.
 */

import {
  extractPlannedCourseIds,
  buildGeneratePlanInterestEvaluation,
} from '../../api/ai/generate_plan_interest_evaluation';

describe('extractPlannedCourseIds', () => {
  test('flattens course_ids across semesters in order', () => {
    const semesters = [
      { semester_id: 'year_3_semester_a', course_ids: ['C1', 'C2'] },
      { semester_id: 'year_3_semester_b', course_ids: ['C3'] },
    ];
    expect(extractPlannedCourseIds(semesters)).toEqual(['C1', 'C2', 'C3']);
  });

  test('does not reorder within or across semesters', () => {
    const semesters = [
      { semester_id: 's1', course_ids: ['Z', 'A'] },
      { semester_id: 's2', course_ids: ['M'] },
    ];
    expect(extractPlannedCourseIds(semesters)).toEqual(['Z', 'A', 'M']);
  });

  test('tolerates empty/malformed semesters without throwing', () => {
    expect(extractPlannedCourseIds([])).toEqual([]);
    expect(extractPlannedCourseIds([{ semester_id: 's1', course_ids: [] }])).toEqual([]);
    expect(extractPlannedCourseIds(undefined as any)).toEqual([]);
  });
});

describe('buildGeneratePlanInterestEvaluation — real full-catalog resolver', () => {
  test('a meaningful fluids profile over a real fluids course surfaces fluids as a matched focus area', () => {
    const semesters = [{ semester_id: 's1', course_ids: ['0542-4320'] }]; // מכניקת הזורמים (2)
    const result = buildGeneratePlanInterestEvaluation(semesters, { focusAreas: [{ area: 'fluids', weight: 1 }] });
    expect(result.hasMeaningfulAcademicInterests).toBe(true);
    expect(result.evaluatedCourseIds).toEqual(['0542-4320']);
    expect(result.unmatchedCourseIds).toEqual([]);
    expect(result.scorecard.matchedFocusAreas.map((g) => g.area)).toContain('fluids');
  });

  test('exposes alignment and scorecard on the result', () => {
    const semesters = [{ semester_id: 's1', course_ids: ['0542-4320'] }];
    const result = buildGeneratePlanInterestEvaluation(semesters, { focusAreas: [{ area: 'fluids', weight: 1 }] });
    expect(result.alignment).toBeDefined();
    expect(result.alignment.interestAlignmentScore).toBeGreaterThan(0);
    expect(result.scorecard).toBeDefined();
    expect(result.scorecard.summaryLevel).toBeDefined();
  });

  test('a missing (non-catalog) planned course id is reported as unmatched, never fabricated', () => {
    const semesters = [{ semester_id: 's1', course_ids: ['0542-4320', 'NOT-A-REAL-COURSE'] }];
    const result = buildGeneratePlanInterestEvaluation(semesters, { focusAreas: [{ area: 'fluids', weight: 1 }] });
    expect(result.unmatchedCourseIds).toEqual(['NOT-A-REAL-COURSE']);
    expect(result.evaluatedCourseIds).toEqual(['0542-4320']);
  });

  test('an empty/missing profile yields hasMeaningfulAcademicInterests=false deterministically', () => {
    const semesters = [{ semester_id: 's1', course_ids: ['0542-4320'] }];
    expect(buildGeneratePlanInterestEvaluation(semesters, {}).hasMeaningfulAcademicInterests).toBe(false);
    expect(buildGeneratePlanInterestEvaluation(semesters, undefined).hasMeaningfulAcademicInterests).toBe(false);
  });

  test('invalid/unknown profile values are normalized away (unknown focus area dropped)', () => {
    const semesters = [{ semester_id: 's1', course_ids: ['0542-4320'] }];
    const result = buildGeneratePlanInterestEvaluation(semesters, { focusAreas: [{ area: 'not_a_real_area', weight: 5 }] });
    expect(result.hasMeaningfulAcademicInterests).toBe(false);
  });

  test('a needs_review/default course does not create a strong fake focus match', () => {
    const semesters = [{ semester_id: 's1', course_ids: ['0555-4000'] }]; // אתיקה מעשית — default/needs_review
    const result = buildGeneratePlanInterestEvaluation(semesters, { focusAreas: [{ area: 'fluids', weight: 1 }] });
    expect(result.evaluatedCourseIds).toEqual(['0555-4000']);
    expect(result.scorecard.matchedFocusAreas).toEqual([]);
    expect(result.alignment.interestAlignmentScore).toBe(0);
  });
});
