/**
 * Slice 5 — class-native GroundingCapability.
 *
 * Grounding is now a first-class stage of AcademicDecisionAgent.run(): the class
 * invokes an injected GroundingCapability over (Observe model, planned final
 * state) AFTER Plan, and returns the result on AcademicDecisionResult.grounding.
 *
 * Ordering note: the conceptual "Observe → Ground → …" is adapted to
 * "… → Plan → Ground → Validate → …" because grounding grounds the PLACED
 * courses of the generated plan — there is nothing to ground before Plan runs.
 */

import { AcademicDecisionAgent } from '../../api/ai/academic_decision_agent';
import { createDefaultAcademicDecisionAgent } from '../../api/ai/academic_decision_factory';
import type { ProgramProvider } from '../../api/ai/program_provider';
import type { PlanningCapability, AgentResult } from '../../api/ai/planner_agent';
import type { AcademicDecisionRequest } from '../../api/ai/academic_decision_agent';
import type { ConstraintModel } from '../../api/ai/planner_types';
import type { CourseProfile } from '../../api/ai/course_profile';
import { PlanGroundingCapability, type PlanGrounding } from '../../api/ai/plan_grounding';

function makeProfile(id: string, over: Partial<CourseProfile> = {}): CourseProfile {
  return {
    course_id: id, name_he: id, category_id: null, category_name_he: null, is_mandatory: false,
    course_type: 'elective', placement_policy: 'elective', hours: 4,
    offered_semesters: ['semester_a'], effective_allowed_semesters: ['semester_a'],
    recommended_semester: null, allowed_semesters: null, program_allowed_semesters: null,
    prerequisites: [], corequisites: [], syllabus_url: null, syllabus_available: false,
    syllabus_summary_he: null, syllabus_topics_he: [], assessment_type: null, workload_score: null,
    difficulty_score: null, difficulty_level: null, grade_average: null, is_wanted: false,
    is_unwanted: false, excluded: false, exclusion_reason: null, data_confidence: 0.8,
    provenance: { source: null, data_quality: null, offering_source_url: null, name_source: null },
    ...over,
  } as CourseProfile;
}
function makeModel(profiles: CourseProfile[]): ConstraintModel {
  const m = new Map<string, CourseProfile>();
  for (const p of profiles) m.set(p.course_id, p);
  return {
    profiles: m, knownSemesterIds: ['semester_a', 'semester_b'], completedCourseIds: new Set(),
    requiredMandatoryCourseIds: [], categories: [], degreeRequiredHours: 4, priorHours: 0,
    maxHoursPerSemester: 20, hardCap: 30, disallowedCourseIds: new Set(),
    pinnedCourseIds: new Set(), wantedCourseIds: new Set(),
  };
}

const MODEL = makeModel([makeProfile('c1')]);
const BOARD = { semesters: [] };
const FIXED_RESULT: AgentResult = { finalState: { semesters: { semester_a: ['c1'] } }, trace: [], gaps: [] };

const provider: ProgramProvider = {
  parseProgramId: () => ({ base: 'x', year: 2027 }),
  loadBoard: async () => BOARD,
  buildModel: () => MODEL,
};
const fakePlanning = (r: AgentResult) => (_req: AcademicDecisionRequest): PlanningCapability => ({ run: async () => r });

describe('AcademicDecisionAgent — class-native grounding stage', () => {
  test('invokes the injected GroundingCapability over (model, planned finalState) and returns result.grounding', async () => {
    const SENTINEL: PlanGrounding = { facts: [], counts: { known: 0, unknown: 0, inferred: 0, conflicting: 0 }, conflicts: [] };
    const ground = jest.fn((_input: any) => SENTINEL);
    const agent = new AcademicDecisionAgent({
      programProvider: provider,
      planning: fakePlanning(FIXED_RESULT),
      grounding: { ground },
    } as any);

    const result: any = await agent.run({ programId: 'x_2027' });

    expect(ground).toHaveBeenCalledTimes(1);
    const arg = ground.mock.calls[0][0] as any;
    expect(arg.model).toBe(MODEL);
    expect(arg.plan).toBe(FIXED_RESULT.finalState);
    expect(result.grounding).toBe(SENTINEL);
  });

  test('the default factory wires a real PlanGroundingCapability (grounds the placed course)', async () => {
    const agent = createDefaultAcademicDecisionAgent({
      overrides: { programProvider: provider, planning: fakePlanning(FIXED_RESULT) },
    });
    const result: any = await agent.run({ programId: 'x_2027' });
    expect(result.grounding).toBeDefined();
    // c1 is placed and fully specified in MODEL → one grounded 'known' fact.
    expect(result.grounding.facts.map((f: any) => f.courseId)).toEqual(['c1']);
    expect(result.grounding.counts.known).toBe(1);
  });

  test('PlanGroundingCapability delegates to groundPlan (deterministic, plan-inert)', () => {
    const g = new PlanGroundingCapability().ground({ model: MODEL, plan: FIXED_RESULT.finalState });
    expect(g.facts.map((f: any) => f.courseId)).toEqual(['c1']);
  });
});
