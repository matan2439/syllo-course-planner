/**
 * PHASE-3 deterministic proof (synthetic fixture, no real-course data, no model): a
 * genuinely SEMANTIC-ONLY design signal — one the legacy lexical extractor cannot
 * detect — can change the FINAL LEGAL proposal via the planner's soft `interest_fit`
 * goal, WITHOUT ever overriding a hard academic constraint.
 *
 * `courseFitById` is exactly what a validated semantic profile contributes
 * (buildCourseFitById → evidence.strength). Here we inject it directly so the proof is
 * independent of the committed cache (which is unchanged; the real 7-course dataset
 * stays `data-blocked`).
 *
 * Goal order (planner_goals.ts GOAL_STACK): degree > mandatory > category > legality >
 * balance(peak,spread) > preferences(wanted) > unwanted_avoidance > interest_fit >
 * difficulty. interest_fit is index 8 of 10, so it is a pure tiebreaker below every
 * hard constraint — proven below by construction.
 */
import { scorePlan, compareScore } from '../../api/ai/planner_goals';
import { type ConstraintModel, type PlanState, emptyState } from '../../api/ai/planner_types';
import type { CourseProfile } from '../../api/ai/course_profile';
import { extractCourseCapabilityEvidence } from '../../api/ai/course_capability_evidence';

const SEMS = ['year_3_semester_a', 'year_3_semester_b', 'year_4_semester_a', 'year_4_semester_b'];

function profile(id: string, over: Partial<CourseProfile> = {}): CourseProfile {
  return {
    course_id: id, name_he: id, category_id: null, category_name_he: null, is_mandatory: false,
    course_type: 'elective', placement_policy: 'elective', hours: 4, offered_semesters: null,
    effective_allowed_semesters: null, recommended_semester: null, allowed_semesters: null,
    program_allowed_semesters: null, prerequisites: [], corequisites: [], syllabus_url: null,
    syllabus_available: false, syllabus_summary_he: null, syllabus_topics_he: [], assessment_type: null,
    workload_score: null, difficulty_score: 3, difficulty_level: null, grade_average: null,
    is_wanted: false, is_unwanted: false, excluded: false, exclusion_reason: null, data_confidence: 0.5,
    provenance: { source: null, data_quality: null, offering_source_url: null, name_source: null },
    ...over,
  };
}

// A course whose Hebrew name and (absent) syllabus carry NO lexical design signal:
// the legacy extractor returns `missing`, so any design fit for it is SEMANTIC-ONLY.
const SEMANTIC_ONLY_ID = 'so_course';
function model(over: Partial<ConstraintModel> = {}): ConstraintModel {
  const profiles = new Map<string, CourseProfile>();
  profiles.set(SEMANTIC_ONLY_ID, profile(SEMANTIC_ONLY_ID, { name_he: 'סמינר מחקר כללי', hours: 4, difficulty_score: 3 }));
  profiles.set('plain', profile('plain', { name_he: 'קורס בחירה', hours: 4, difficulty_score: 3 }));
  profiles.set('catCourse', profile('catCourse', { category_id: 'cat', hours: 4, difficulty_score: 3 }));
  return {
    profiles, knownSemesterIds: SEMS, completedCourseIds: new Set(), requiredMandatoryCourseIds: [],
    categories: [], degreeRequiredHours: 8, priorHours: 0, maxHoursPerSemester: 22, hardCap: 26,
    disallowedCourseIds: new Set(), pinnedCourseIds: new Set(), wantedCourseIds: new Set(),
    ...over,
  };
}
function place(map: Record<string, string[]>): PlanState {
  const s = emptyState(SEMS);
  for (const [sem, ids] of Object.entries(map)) s.semesters[sem] = ids;
  return s;
}

// (premise) the fit-carrying course is invisible to the legacy lexical extractor.
test('the semantic-only course is NOT detectable by the legacy lexical extractor (inferenceLevel=missing)', () => {
  const legacy = extractCourseCapabilityEvidence({ course_id: SEMANTIC_ONLY_ID, name_he: 'סמינר מחקר כללי' }, 'mechanical_design');
  expect(legacy.inferenceLevel).toBe('missing');
});

// (9a,b,c) semantic-only fit reaches the ranking and CHANGES the final legal selection
// when all higher goals are equal.
test('semantic-only fit flips selection between two otherwise-identical legal electives', () => {
  const m = model({ courseFitById: new Map([[SEMANTIC_ONLY_ID, 0.6]]) }); // derived-strength fit, plain=0
  const withSemanticOnly = place({ year_3_semester_a: [SEMANTIC_ONLY_ID] });
  const withPlain = place({ year_3_semester_a: ['plain'] });
  // identical degree hours / legality / balance / preferences → decided at interest_fit.
  expect(compareScore(scorePlan(withSemanticOnly, m), scorePlan(withPlain, m))).toBeGreaterThan(0);
});

// (9d) fit does NOT override an explicit avoid: an unwanted-but-high-fit course loses.
test('interest_fit does NOT override an explicit avoid (unwanted_avoidance wins)', () => {
  const m = model({ courseFitById: new Map([[SEMANTIC_ONLY_ID, 0.6]]) });
  m.profiles.get(SEMANTIC_ONLY_ID)!.is_unwanted = true; // user explicitly avoided it
  const withAvoided = place({ year_3_semester_a: [SEMANTIC_ONLY_ID] }); // fit 0.6 but unwanted
  const withPlain = place({ year_3_semester_a: ['plain'] });            // no fit, not unwanted
  expect(compareScore(scorePlan(withPlain, m), scorePlan(withAvoided, m))).toBeGreaterThan(0);
});

// (9d) fit does NOT override legality/workload: a legal no-fit plan beats an over-cap
// plan that placed the high-fit course (g1/g2 equal → legality g3 decides, above fit).
test('interest_fit does NOT override legality/workload (over-cap plan loses despite fit)', () => {
  const m = model({ maxHoursPerSemester: 6, courseFitById: new Map([[SEMANTIC_ONLY_ID, 0.6]]) });
  const fitButOverCap = place({ year_3_semester_a: [SEMANTIC_ONLY_ID, 'plain'] }); // 8h > 6 → over user cap
  const legalNoFit = place({ year_3_semester_a: ['plain'], year_3_semester_b: ['catCourse'] }); // 4h+4h legal
  // both place 8h (g1 equal), no categories required (g2 equal) → decided at legality (g3), above fit.
  expect(compareScore(scorePlan(legalNoFit, m), scorePlan(fitButOverCap, m))).toBeGreaterThan(0);
});

// (9d) fit does NOT override a degree requirement: satisfying a required category beats
// placing the high-fit elective instead.
test('interest_fit does NOT override a required-category requirement', () => {
  const m = model({
    categories: [{ id: 'cat', name: 'קטגוריה', required: 1, candidateIds: ['catCourse'] }],
    courseFitById: new Map([[SEMANTIC_ONLY_ID, 0.6]]),
  });
  const withCategory = place({ year_3_semester_a: ['catCourse'], year_3_semester_b: ['plain'] }); // satisfies category, no fit
  const withFitInstead = place({ year_3_semester_a: [SEMANTIC_ONLY_ID], year_3_semester_b: ['plain'] }); // fit, category unmet
  expect(compareScore(scorePlan(withCategory, m), scorePlan(withFitInstead, m))).toBeGreaterThan(0);
});
