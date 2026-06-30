/**
 * Tests for api/ai/planner_candidates.ts — generateCandidates produces MULTIPLE
 * valid candidate plans (not one), exploring alternative legal A/B placements for
 * flexible courses. Every returned candidate must be valid (legal + complete),
 * candidates are ranked by the goal stack, and none stops below the degree target.
 */

import { generateCandidates } from '../../api/ai/planner_candidates';
import { compareScore } from '../../api/ai/planner_goals';
import { type ConstraintModel, semesterOf } from '../../api/ai/planner_types';
import type { CourseProfile } from '../../api/ai/course_profile';

const SEMS = ['year_3_semester_a', 'year_3_semester_b', 'year_4_semester_a', 'year_4_semester_b'];

function profile(id: string, over: Partial<CourseProfile> = {}): CourseProfile {
  return {
    course_id: id, name_he: id, category_id: null, category_name_he: null,
    is_mandatory: false, course_type: 'elective', placement_policy: 'elective',
    hours: 4, offered_semesters: null, effective_allowed_semesters: null,
    recommended_semester: null, allowed_semesters: null, program_allowed_semesters: null,
    prerequisites: [], corequisites: [], syllabus_url: null, syllabus_available: false,
    syllabus_summary_he: null, syllabus_topics_he: [], assessment_type: null,
    workload_score: null, difficulty_score: 3, difficulty_level: null, grade_average: null,
    is_wanted: false, is_unwanted: false, excluded: false, exclusion_reason: null,
    data_confidence: 0.5,
    provenance: { source: null, data_quality: null, offering_source_url: null, name_source: null },
    ...over,
  };
}

/** FLEX is legal in both y4a and y4b; a pool of plain electives fills the rest. */
function model(): ConstraintModel {
  const profiles = new Map<string, CourseProfile>();
  profiles.set('FLEX', profile('FLEX', {
    hours: 4, effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'],
  }));
  for (let i = 0; i < 8; i++) profiles.set(`E${i}`, profile(`E${i}`, { hours: 4 }));
  return {
    profiles, knownSemesterIds: SEMS, completedCourseIds: new Set(),
    requiredMandatoryCourseIds: [], categories: [],
    degreeRequiredHours: 24, priorHours: 0, maxHoursPerSemester: 22, hardCap: 26,
    disallowedCourseIds: new Set(), pinnedCourseIds: new Set(['FLEX']), wantedCourseIds: new Set(['FLEX']),
  };
}

describe('generateCandidates', () => {
  it('returns at least one candidate, every one valid (test 8)', () => {
    const cands = generateCandidates(model());
    expect(cands.length).toBeGreaterThanOrEqual(1);
    for (const c of cands) expect(c.report.valid).toBe(true);
  });

  it('every candidate meets the degree target (never stops below it, test 5)', () => {
    for (const c of generateCandidates(model())) {
      expect(c.report.degreeMet).toBe(true);
    }
  });

  it('explores both A/B placements of a flexible course', () => {
    const cands = generateCandidates(model(), { maxCandidates: 4 });
    const flexSemesters = new Set(cands.map(c => semesterOf(c.state, 'FLEX')));
    expect(flexSemesters.size).toBeGreaterThanOrEqual(2); // FLEX placed in y4a in one, y4b in another
  });

  it('ranks candidates by the goal stack (best first) and bounds the count', () => {
    const cands = generateCandidates(model(), { maxCandidates: 3 });
    expect(cands.length).toBeLessThanOrEqual(3);
    for (let i = 0; i + 1 < cands.length; i++) {
      expect(compareScore(cands[i].score, cands[i + 1].score)).toBeGreaterThanOrEqual(0);
    }
  });
});
