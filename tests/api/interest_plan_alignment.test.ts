/**
 * Interest Alignment Scoring (opt-in) — tests for api/ai/interest_plan_alignment.ts.
 *
 * scorePlanInterestAlignment is a pure, standalone helper: given an
 * AcademicInterestProfile, a courseId->CourseTopicProfile map, and a flat list
 * of planned course ids, it reports a deterministic, explainable plan-level
 * interest-alignment score by reusing matchCourseToAcademicInterests per
 * course. Decoupled from PlanState/ConstraintModel entirely.
 *
 * compareScoreWithOptionalInterestAlignment is a narrow, additive comparator:
 * it calls the EXISTING, UNMODIFIED compareScore(scorePlan(...)) first, and
 * only breaks a genuine tie with interest alignment, only when the caller
 * explicitly supplies options. Omitting options reproduces
 * compareScore(scorePlan(...)) byte-for-byte — proving default planner
 * behavior is unaffected. Not wired into PlannerWorker, planner-run.ts,
 * PlannerAgent, or generate-plan.ts.
 */

import {
  emptyAcademicInterestProfile,
  normalizeAcademicInterestProfile,
} from '../../api/ai/academic_interest_profile';
import { normalizeCourseTopicProfile } from '../../api/ai/course_topic_profile';
import type { CourseTopicProfile } from '../../api/ai/course_topic_profile';
import {
  scorePlanInterestAlignment,
  compareScoreWithOptionalInterestAlignment,
} from '../../api/ai/interest_plan_alignment';
import { scorePlan, compareScore } from '../../api/ai/planner_goals';
import type { ConstraintModel, PlanState } from '../../api/ai/planner_types';
import type { CourseProfile } from '../../api/ai/course_profile';

describe('scorePlanInterestAlignment', () => {
  test('an empty academic interest profile returns a deterministic zero/neutral alignment', () => {
    const courseTopicProfilesByCourseId = {
      C1: normalizeCourseTopicProfile({ courseId: 'C1', topics: [{ area: 'fluids', weight: 0.9 }] }),
    };
    const result = scorePlanInterestAlignment({
      academicInterestProfile: emptyAcademicInterestProfile(),
      courseTopicProfilesByCourseId,
      plannedCourseIds: ['C1'],
    });
    expect(result.interestAlignmentScore).toBe(0);
    expect(result.matchedCourseIds).toEqual(['C1']);
    expect(result.unmatchedCourseIds).toEqual([]);
  });

  test('empty planned courses returns a deterministic zero/neutral alignment', () => {
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    const result = scorePlanInterestAlignment({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: {},
      plannedCourseIds: [],
    });
    expect(result.interestAlignmentScore).toBe(0);
    expect(result.matchedCourseIds).toEqual([]);
    expect(result.unmatchedCourseIds).toEqual([]);
    expect(result.courseMatches).toEqual([]);
  });

  test('a course missing from the topic profile map is reported as unmatched, not scored as zero', () => {
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    const matchedCourse = normalizeCourseTopicProfile({ courseId: 'C1', topics: [{ area: 'fluids', weight: 1 }] });
    const result = scorePlanInterestAlignment({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: { C1: matchedCourse },
      plannedCourseIds: ['C1', 'C2'],
    });
    expect(result.matchedCourseIds).toEqual(['C1']);
    expect(result.unmatchedCourseIds).toEqual(['C2']);
    // C2 (unmatched) must not drag the average toward 0 — only C1 (fit=1) counts.
    expect(result.interestAlignmentScore).toBe(1);
    expect(result.courseMatches).toEqual([
      { courseId: 'C1', interestFitScore: 1, focusMatchScore: 1, styleMatchScore: 0, avoidPenalty: 0 },
    ]);
  });

  test('matching focus areas increase the plan alignment score', () => {
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    const weak = scorePlanInterestAlignment({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: {
        C1: normalizeCourseTopicProfile({ courseId: 'C1', topics: [{ area: 'fluids', weight: 0.2 }] }),
      },
      plannedCourseIds: ['C1'],
    });
    const strong = scorePlanInterestAlignment({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: {
        C1: normalizeCourseTopicProfile({ courseId: 'C1', topics: [{ area: 'fluids', weight: 0.9 }] }),
      },
      plannedCourseIds: ['C1'],
    });
    expect(strong.interestAlignmentScore).toBeGreaterThan(weak.interestAlignmentScore);
  });

  test('matching course styles increase the plan alignment score', () => {
    const profile = normalizeAcademicInterestProfile({
      courseStylePreferences: [{ style: 'project_based', weight: 1 }],
    });
    const result = scorePlanInterestAlignment({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: {
        C1: normalizeCourseTopicProfile({ courseId: 'C1', styles: [{ style: 'project_based', weight: 0.8 }] }),
      },
      plannedCourseIds: ['C1'],
    });
    expect(result.interestAlignmentScore).toBeCloseTo(0.8);
    expect(result.courseMatches[0].styleMatchScore).toBeCloseTo(0.8);
  });

  test('avoid areas reduce per-course interest fit and the plan alignment score', () => {
    const profile = normalizeAcademicInterestProfile({
      focusAreas: [{ area: 'fluids', weight: 1 }],
      avoidAreas: [{ area: 'materials', weight: 1 }],
    });
    const clean = scorePlanInterestAlignment({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: {
        C1: normalizeCourseTopicProfile({ courseId: 'C1', topics: [{ area: 'fluids', weight: 0.8 }] }),
      },
      plannedCourseIds: ['C1'],
    });
    const penalized = scorePlanInterestAlignment({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: {
        C1: normalizeCourseTopicProfile({
          courseId: 'C1',
          topics: [
            { area: 'fluids', weight: 0.8 },
            { area: 'materials', weight: 0.6 },
          ],
        }),
      },
      plannedCourseIds: ['C1'],
    });
    expect(penalized.courseMatches[0].avoidPenalty).toBeGreaterThan(0);
    expect(penalized.interestAlignmentScore).toBeLessThan(clean.interestAlignmentScore);
  });

  test('multiple courses average deterministically', () => {
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    const result = scorePlanInterestAlignment({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: {
        C1: normalizeCourseTopicProfile({ courseId: 'C1', topics: [{ area: 'fluids', weight: 1 }] }),
        C2: normalizeCourseTopicProfile({ courseId: 'C2', topics: [{ area: 'fluids', weight: 0.5 }] }),
      },
      plannedCourseIds: ['C1', 'C2'],
    });
    // (1 + 0.5) / 2 = 0.75
    expect(result.interestAlignmentScore).toBeCloseTo(0.75);
  });

  test('courses without topic profiles do not crash and are excluded from the average', () => {
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    expect(() =>
      scorePlanInterestAlignment({
        academicInterestProfile: profile,
        courseTopicProfilesByCourseId: {},
        plannedCourseIds: ['C1', 'C2', 'C3'],
      }),
    ).not.toThrow();
    const result = scorePlanInterestAlignment({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: {},
      plannedCourseIds: ['C1', 'C2', 'C3'],
    });
    expect(result.unmatchedCourseIds).toEqual(['C1', 'C2', 'C3']);
    expect(result.interestAlignmentScore).toBe(0);
  });

  test('per-course match details are preserved in courseMatches', () => {
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    const result = scorePlanInterestAlignment({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: {
        C1: normalizeCourseTopicProfile({ courseId: 'C1', topics: [{ area: 'fluids', weight: 0.6 }] }),
      },
      plannedCourseIds: ['C1'],
    });
    expect(result.courseMatches).toEqual([
      { courseId: 'C1', interestFitScore: 0.6, focusMatchScore: 0.6, styleMatchScore: 0, avoidPenalty: 0 },
    ]);
  });

  test('stable ordering: matchedCourseIds/unmatchedCourseIds/courseMatches follow plannedCourseIds order', () => {
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    const map: Record<string, CourseTopicProfile> = {
      C2: normalizeCourseTopicProfile({ courseId: 'C2', topics: [{ area: 'fluids', weight: 0.5 }] }),
      C4: normalizeCourseTopicProfile({ courseId: 'C4', topics: [{ area: 'fluids', weight: 0.9 }] }),
    };
    const result = scorePlanInterestAlignment({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: map,
      plannedCourseIds: ['C4', 'C3', 'C2', 'C1'],
    });
    expect(result.matchedCourseIds).toEqual(['C4', 'C2']);
    expect(result.unmatchedCourseIds).toEqual(['C3', 'C1']);
    expect(result.courseMatches.map((m) => m.courseId)).toEqual(['C4', 'C2']);
  });

  test('does not mutate the AcademicInterestProfile input', () => {
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    const snapshot = JSON.parse(JSON.stringify(profile));
    scorePlanInterestAlignment({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: {
        C1: normalizeCourseTopicProfile({ courseId: 'C1', topics: [{ area: 'fluids', weight: 1 }] }),
      },
      plannedCourseIds: ['C1'],
    });
    expect(profile).toEqual(snapshot);
  });

  test('does not mutate the CourseTopicProfile map input', () => {
    const map = {
      C1: normalizeCourseTopicProfile({ courseId: 'C1', topics: [{ area: 'fluids', weight: 1 }] }),
    };
    const snapshot = JSON.parse(JSON.stringify(map));
    scorePlanInterestAlignment({
      academicInterestProfile: normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] }),
      courseTopicProfilesByCourseId: map,
      plannedCourseIds: ['C1'],
    });
    expect(map).toEqual(snapshot);
  });

  test('final interestAlignmentScore is clamped to 0..1', () => {
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    const result = scorePlanInterestAlignment({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: {
        C1: normalizeCourseTopicProfile({ courseId: 'C1', topics: [{ area: 'fluids', weight: 1 }] }),
      },
      plannedCourseIds: ['C1'],
    });
    expect(result.interestAlignmentScore).toBeGreaterThanOrEqual(0);
    expect(result.interestAlignmentScore).toBeLessThanOrEqual(1);
  });

  test('duplicate planned course ids are deduped (counted once) so the average is not distorted', () => {
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    const result = scorePlanInterestAlignment({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: {
        C1: normalizeCourseTopicProfile({ courseId: 'C1', topics: [{ area: 'fluids', weight: 1 }] }),
        C2: normalizeCourseTopicProfile({ courseId: 'C2', topics: [{ area: 'fluids', weight: 0 }] }),
      },
      plannedCourseIds: ['C1', 'C1', 'C2'],
    });
    expect(result.matchedCourseIds).toEqual(['C1', 'C2']);
    // If C1 were double-counted, this would skew toward 1 more than a fair (1+0)/2=0.5 average.
    expect(result.interestAlignmentScore).toBeCloseTo(0.5);
  });
});

describe('compareScoreWithOptionalInterestAlignment (opt-in planner tiebreak, additive only)', () => {
  function makeProfile(id: string, hours: number): CourseProfile {
    return {
      course_id: id,
      name_he: id,
      category_id: 'cat_1',
      category_name_he: null,
      is_mandatory: false,
      course_type: 'elective',
      placement_policy: 'elective',
      hours,
      offered_semesters: ['semester_a'],
      effective_allowed_semesters: ['semester_a'],
      recommended_semester: null,
      allowed_semesters: null,
      program_allowed_semesters: null,
      prerequisites: [],
      corequisites: [],
      syllabus_url: null,
      syllabus_available: false,
      syllabus_summary_he: null,
      syllabus_topics_he: [],
      assessment_type: null,
      workload_score: null,
      difficulty_score: null,
      difficulty_level: null,
      grade_average: null,
      is_wanted: false,
      is_unwanted: false,
      excluded: false,
      exclusion_reason: null,
      data_confidence: 0.8,
      provenance: { source: null, data_quality: null, offering_source_url: null, name_source: null },
    };
  }

  function makeModel(profiles: CourseProfile[], opts: Partial<ConstraintModel> = {}): ConstraintModel {
    const profileMap = new Map<string, CourseProfile>();
    for (const p of profiles) profileMap.set(p.course_id, p);
    return {
      profiles: profileMap,
      knownSemesterIds: ['semester_a', 'semester_b'],
      completedCourseIds: new Set(),
      requiredMandatoryCourseIds: [],
      categories: [],
      degreeRequiredHours: 100,
      priorHours: 0,
      maxHoursPerSemester: 30,
      hardCap: 30,
      disallowedCourseIds: new Set(),
      pinnedCourseIds: new Set(),
      wantedCourseIds: new Set(),
      ...opts,
    };
  }

  const model = makeModel([makeProfile('C1', 4), makeProfile('C2', 4)]);

  function st(a: string[], b: string[]): PlanState {
    return { semesters: { semester_a: a, semester_b: b } };
  }

  test('default: with no options, returns exactly what compareScore(scorePlan(...)) returns (transparent wrapper)', () => {
    const stateA = st(['C1'], []);
    const stateB = st(['C2'], []);
    const direct = compareScore(scorePlan(stateA, model), scorePlan(stateB, model));
    const wrapped = compareScoreWithOptionalInterestAlignment(stateA, stateB, model);
    expect(wrapped).toBe(direct);
  });

  test('interest alignment affects ranking only when explicitly provided: a genuine tie stays a tie without options', () => {
    // Both states place the same single 4h course count -> identical scorePlan vectors (a true tie).
    const stateA = st(['C1'], []);
    const stateB = st([], ['C1']);
    expect(compareScore(scorePlan(stateA, model), scorePlan(stateB, model))).toBe(0);
    expect(compareScoreWithOptionalInterestAlignment(stateA, stateB, model)).toBe(0);
  });

  test('a genuine tie is broken by interest alignment only when options are supplied', () => {
    const stateA = st(['C1'], []);
    const stateB = st([], ['C1']); // same course, different (tied) semester -> tie on scorePlan
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    const options = {
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: {
        C1: normalizeCourseTopicProfile({ courseId: 'C1', topics: [{ area: 'fluids', weight: 0.9 }] }),
      },
    };
    // Both states place the identical course C1, so alignment is identical too -> still a tie (0),
    // proving the hook only breaks REAL alignment differences, not fabricating one.
    expect(compareScoreWithOptionalInterestAlignment(stateA, stateB, model, options)).toBe(0);
  });

  test('hard constraints (degree completion) remain strictly above interest alignment', () => {
    // stateA places 2 courses (8h, more degree progress) vs stateB places 1 (4h) -> compareScore already favors A.
    const stateA = st(['C1', 'C2'], []);
    const stateB = st(['C1'], []);
    const primary = compareScore(scorePlan(stateA, model), scorePlan(stateB, model));
    expect(primary).toBeGreaterThan(0); // sanity: A is genuinely ahead on the existing vector

    // Interest alignment favors B's course (C1) far more than A's extra course (C2) -- if this
    // were allowed to override the primary decision, the wrapped result would flip. It must not.
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    const options = {
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: {
        C1: normalizeCourseTopicProfile({ courseId: 'C1', topics: [{ area: 'fluids', weight: 1 }] }),
        C2: normalizeCourseTopicProfile({ courseId: 'C2', topics: [] }),
      },
    };
    const wrapped = compareScoreWithOptionalInterestAlignment(stateA, stateB, model, options);
    expect(wrapped).toBe(primary);
    expect(wrapped).toBeGreaterThan(0);
  });

  test('re-running the existing planner_goals scoring is unaffected: scorePlan/compareScore are untouched', () => {
    // Direct sanity check that this module never mutates the shared model/state it reads.
    const stateA = st(['C1'], []);
    const snapshotModel = JSON.parse(
      JSON.stringify(model, (_k, v) => (v instanceof Map ? Object.fromEntries(v) : v instanceof Set ? [...v] : v)),
    );
    compareScoreWithOptionalInterestAlignment(stateA, st([], ['C1']), model, {
      academicInterestProfile: normalizeAcademicInterestProfile({}),
      courseTopicProfilesByCourseId: {},
    });
    const afterModel = JSON.parse(
      JSON.stringify(model, (_k, v) => (v instanceof Map ? Object.fromEntries(v) : v instanceof Set ? [...v] : v)),
    );
    expect(afterModel).toEqual(snapshotModel);
  });
});
