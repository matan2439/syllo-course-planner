/**
 * Tests for api/ai/planner_tools.ts — rank_candidates sort order.
 * Also covers PlannerWorker.rankActions() which backs the tool.
 */

import { PlannerWorker } from '../../api/ai/planner_worker';
import { buildPlannerTools } from '../../api/ai/planner_tools';
import { compareScore } from '../../api/ai/planner_goals';
import { type ConstraintModel, emptyState } from '../../api/ai/planner_types';
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

function buildModel(): ConstraintModel {
  const profiles = new Map<string, CourseProfile>();
  profiles.set('MAND', profile('MAND', {
    is_mandatory: true, course_type: 'mandatory', placement_policy: 'fixed',
    effective_allowed_semesters: ['year_3_semester_a'], hours: 5,
  }));
  for (let i = 0; i < 8; i++) profiles.set(`E${i}`, profile(`E${i}`, { hours: 4 }));
  return {
    profiles, knownSemesterIds: SEMS,
    completedCourseIds: new Set(),
    requiredMandatoryCourseIds: ['MAND'],
    categories: [],
    degreeRequiredHours: 20, priorHours: 0,
    maxHoursPerSemester: 22, hardCap: 26,
    disallowedCourseIds: new Set(), pinnedCourseIds: new Set(), wantedCourseIds: new Set(),
  };
}

describe('PlannerWorker.rankActions', () => {
  it('returns actions sorted by resulting plan score descending', () => {
    const w = new PlannerWorker(buildModel());
    const ranked = w.rankActions();

    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.length).toBeLessThanOrEqual(20);

    // Every action must carry a score array.
    for (const a of ranked) {
      expect(Array.isArray(a.score)).toBe(true);
      expect(a.score.length).toBeGreaterThan(0);
    }

    // Adjacent pairs must be non-increasing (higher-score first).
    for (let i = 0; i < ranked.length - 1; i++) {
      expect(compareScore(ranked[i].score, ranked[i + 1].score)).toBeGreaterThanOrEqual(0);
    }
  });

  it('rank_candidates tool returns sorted, scored actions', async () => {
    const w = new PlannerWorker(buildModel());
    const tools = buildPlannerTools(w);
    const result = await tools.rank_candidates.execute({}, undefined as any);

    expect(Array.isArray(result.actions)).toBe(true);
    expect(result.actions.length).toBeLessThanOrEqual(20);

    for (let i = 0; i < result.actions.length - 1; i++) {
      expect(
        compareScore(result.actions[i].score, result.actions[i + 1].score),
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it('exposes grounded read-only academic tools without mutating the worker', async () => {
    const w = new PlannerWorker(buildModel(), {
      semesters: {
        year_3_semester_a: ['MAND'], year_3_semester_b: [],
        year_4_semester_a: [], year_4_semester_b: [],
      },
    });
    const tools = buildPlannerTools(w);

    const status = await tools.get_academic_status.execute({}, undefined as any);
    expect(status.fact).toEqual(expect.objectContaining({ source: 'planner_model', confidence: 1 }));
    expect(status.data).toEqual(expect.objectContaining({
      completed_course_ids: [], currently_taking_course_ids: [],
      planned_course_ids: ['MAND'],
    }));

    const requirements = await tools.get_requirements_gap.execute({}, undefined as any);
    expect(requirements.fact).toEqual(expect.objectContaining({ source: 'planner_model' }));
    expect(requirements.data).toEqual(expect.objectContaining({
      degree_hours_required: 20, degree_hours_current: 5, degree_hours_remaining: 15,
      mandatory_remaining: 0,
    }));

    const details = await tools.get_course_details.execute({ courseId: 'MAND' }, undefined as any);
    expect(details.fact).toEqual(expect.objectContaining({ source: 'planner_model', confidence: 0.5 }));
    expect(details.data).toEqual(expect.objectContaining({ course_id: 'MAND', hours: 5, name_he: 'MAND' }));

    const offerings = await tools.get_offerings.execute({ courseId: 'MAND' }, undefined as any);
    expect(offerings.data).toEqual(expect.objectContaining({
      course_id: 'MAND', allowed_semesters: ['year_3_semester_a'], known: true,
    }));

    const prereqs = await tools.check_prerequisites.execute({ courseId: 'MAND' }, undefined as any);
    expect(prereqs.data).toEqual(expect.objectContaining({ course_id: 'MAND', missing_course_ids: [] }));

    const simulated = await tools.simulate_move.execute({ courseId: 'MAND', toSemester: 'year_3_semester_b' }, undefined as any);
    expect(simulated.data).toEqual(expect.objectContaining({ accepted: false, course_id: 'MAND' }));
    expect(w.getPlan().semesters.year_3_semester_a).toEqual(['MAND']);

    const compared = await tools.compare_candidates.execute({ courseIds: ['E0', 'E1'] }, undefined as any);
    expect(compared.fact).toEqual(expect.objectContaining({ source: 'planner_model' }));
    expect(compared.data.candidates).toHaveLength(2);

    const explanation = await tools.explain_constraint.execute({ courseId: 'MAND', constraint: 'offering' }, undefined as any);
    expect(explanation.data).toEqual(expect.objectContaining({
      course_id: 'MAND', constraint: 'offering', allowed_semesters: ['year_3_semester_a'],
    }));
  });
});
