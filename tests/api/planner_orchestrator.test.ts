/**
 * Tests for api/ai/planner_orchestrator.ts + planner_tools.ts.
 *
 * The PlannerWorker owns the process; an Orchestrator only chooses which of the
 * worker's deterministic tools to call. GreedyOrchestrator drives the worker
 * deterministically; LlmOrchestrator drives it via a generateText/tool-calling
 * loop (the model injected; a fake `generate` is used here to script tool calls).
 * Both are interchangeable against the same worker tool API. The worker validates
 * every tool call, so an invalid model action cannot corrupt the plan, and a
 * model error falls back to a deterministic completion.
 */

import { GreedyOrchestrator, LlmOrchestrator } from '../../api/ai/planner_orchestrator';
import { buildPlannerTools } from '../../api/ai/planner_tools';
import { PlannerWorker } from '../../api/ai/planner_worker';
import { type ConstraintModel, placedCourseIds, semesterOf } from '../../api/ai/planner_types';
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

function model(over: Partial<ConstraintModel> = {}): ConstraintModel {
  const profiles = new Map<string, CourseProfile>();
  profiles.set('MAND', profile('MAND', {
    is_mandatory: true, course_type: 'mandatory', placement_policy: 'fixed',
    recommended_semester: 'year_3_semester_a', effective_allowed_semesters: ['year_3_semester_a'], hours: 5,
  }));
  profiles.set('FLU1', profile('FLU1', { category_id: 'fluids', hours: 4 }));
  for (let i = 0; i < 10; i++) profiles.set(`E${i}`, profile(`E${i}`, { hours: 4 }));
  return {
    profiles, knownSemesterIds: SEMS, completedCourseIds: new Set(),
    requiredMandatoryCourseIds: ['MAND'],
    categories: [{ id: 'fluids', name: 'זורמים', required: 1, candidateIds: ['FLU1'] }],
    degreeRequiredHours: 25, priorHours: 0, maxHoursPerSemester: 22, hardCap: 26,
    disallowedCourseIds: new Set(['E9']), pinnedCourseIds: new Set(), wantedCourseIds: new Set(),
    ...over,
  };
}

describe('GreedyOrchestrator', () => {
  it('drives the worker to a complete, legal plan', async () => {
    const w = new PlannerWorker(model());
    await new GreedyOrchestrator().run(w);
    expect(w.isGoalReached()).toBe(true);
    expect(w.validateCandidate().valid).toBe(true);
  });
});

describe('planner tools', () => {
  it('add_course executes a worker mutation and reports acceptance', async () => {
    const w = new PlannerWorker(model());
    const tools = buildPlannerTools(w);
    const res = await tools.add_course.execute!({ courseId: 'MAND', semesterId: 'year_3_semester_a' }, {} as any);
    expect(res.accepted).toBe(true);
    expect(placedCourseIds(w.getPlan())).toContain('MAND');
  });

  it('get_state is read-only and reports the observation', async () => {
    const w = new PlannerWorker(model());
    const tools = buildPlannerTools(w);
    const st = await tools.get_state.execute!({}, {} as any);
    expect(st.degree_hours).toBe(0);
    expect(placedCourseIds(w.getPlan())).toHaveLength(0);
  });
});

describe('LlmOrchestrator', () => {
  // A fake `generate` that plays the model: it calls the worker tools in order.
  function scriptedGenerate(script: (tools: ReturnType<typeof buildPlannerTools>) => Promise<void>) {
    return async ({ tools }: { tools: ReturnType<typeof buildPlannerTools> }) => {
      await script(tools);
      return { text: '', toolCalls: [], finishReason: 'stop' } as any;
    };
  }

  it('drives the worker via tool calls (actions tagged by:llm) and ends valid', async () => {
    const w = new PlannerWorker(model());
    const orch = new LlmOrchestrator({} as any, {
      generate: scriptedGenerate(async tools => {
        await tools.add_course.execute!({ courseId: 'MAND', semesterId: 'year_3_semester_a' }, {} as any);
        await tools.add_course.execute!({ courseId: 'FLU1', semesterId: 'year_4_semester_a' }, {} as any);
        await tools.finalize_plan.execute!({}, {} as any);
      }),
    });
    await orch.run(w);
    expect(w.getTrace().some(a => a.by === 'llm')).toBe(true);
    expect(w.validateCandidate().valid).toBe(true); // completed (finalize repairs/fills)
  });

  it('rejects an invalid model tool call without corrupting the plan, then still completes', async () => {
    const w = new PlannerWorker(model());
    const orch = new LlmOrchestrator({} as any, {
      generate: scriptedGenerate(async tools => {
        // illegal: place the fixed MAND in the wrong semester, and a disallowed course
        const bad1 = await tools.add_course.execute!({ courseId: 'MAND', semesterId: 'year_4_semester_b' }, {} as any);
        const bad2 = await tools.add_course.execute!({ courseId: 'E9', semesterId: 'year_3_semester_b' }, {} as any);
        expect(bad1.accepted).toBe(false);
        expect(bad2.accepted).toBe(false);
        await tools.finalize_plan.execute!({}, {} as any);
      }),
    });
    await orch.run(w);
    expect(placedCourseIds(w.getPlan())).not.toContain('E9'); // disallowed never placed
    expect(semesterOf(w.getPlan(), 'MAND')).toBe('year_3_semester_a'); // legal placement only
    expect(w.validateCandidate().valid).toBe(true);
  });

  it('falls back to a deterministic completion when the model errors', async () => {
    const w = new PlannerWorker(model());
    const orch = new LlmOrchestrator({} as any, {
      generate: async () => { throw new Error('model unavailable'); },
    });
    await orch.run(w);
    expect(w.isGoalReached()).toBe(true);
    expect(w.validateCandidate().valid).toBe(true);
  });
});
