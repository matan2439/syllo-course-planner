/**
 * Contract tests for Priority 5: shadow prerequisite audit warnings in
 * toProposal().
 *
 * The planner already enforces flat profiles.prerequisites (strict-timing via
 * validatePlanProposal). This new layer runs shadowPrerequisiteAudit on the
 * final plan and surfaces verified violations from tau.json (AND/OR trees) as
 * soft warnings_he entries — never blocking, never redundant with existing
 * errors.
 *
 * Uses course 0542-4223 (intro to finite elements) from tau.json, whose
 * verified prerequisite is { any: [0542-2200, 0542-4224] } (Solids 1 or 2).
 */

import { toProposal } from '../../api/ai/generate-plan';
import type { ConstraintModel, PlanState } from '../../api/ai/planner_types';
import type { CourseProfile } from '../../api/ai/course_profile';

// Finite-elements course (verified prerequisite: Solids 1 OR Solids 2)
const FE      = '0542-4223';
const SOLIDS1 = '0542-2200';
const SOLIDS2 = '0542-4224';

function minProfile(courseId: string, nameHe: string, hours: number): CourseProfile {
  return {
    course_id: courseId,
    name_he: nameHe,
    category_id: null,
    category_name_he: null,
    is_mandatory: false,
    course_type: 'elective',
    placement_policy: 'flexible',
    hours,
    offered_semesters: null,
    effective_allowed_semesters: null,
    offering_window_semesters: null,
    recommended_semester: null,
    allowed_semesters: null,
    program_allowed_semesters: null,
    prerequisites: [],   // flat list empty — shadow audit uses tau.json
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
    provenance: { source: 'program', data_quality: null, offering_source_url: null, name_source: null },
  };
}

function minModel(profiles: CourseProfile[], degreeHours: number, completed = new Set<string>()): ConstraintModel {
  return {
    profiles: new Map(profiles.map(p => [p.course_id, p])),
    knownSemesterIds: ['s1', 's2'],
    completedCourseIds: completed,
    requiredMandatoryCourseIds: [],
    categories: [],
    degreeRequiredHours: degreeHours,
    priorHours: 0,
    maxHoursPerSemester: 30,
    hardCap: 35,
    disallowedCourseIds: new Set(),
    pinnedCourseIds: new Set(),
    wantedCourseIds: new Set(),
  };
}

const FE_PROFILE  = minProfile(FE,      'שיטות אלמנטים סופיים', 3);
const S1_PROFILE  = minProfile(SOLIDS1, 'מכאניקה 1', 3);
const S2_PROFILE  = minProfile(SOLIDS2, 'מכאניקה 2', 3);

const EMPTY_STATE: PlanState = { semesters: { s1: [], s2: [] } };

describe('toProposal — shadow prerequisite audit (Priority 5)', () => {
  test('1. verified unmet prerequisite produces a warnings_he entry', () => {
    const model = minModel([FE_PROFILE, S1_PROFILE, S2_PROFILE], 3);
    const state: PlanState = { semesters: { s1: [FE], s2: [] } };
    const { warnings_he } = toProposal(state, model, EMPTY_STATE, {}, 'done');
    const warn = warnings_he.find(w => w.includes('שיטות אלמנטים סופיים'));
    expect(warn).toBeDefined();
    expect(warn).toMatch(/קדם-קורס חסר/);
  });

  test('2. warning names the unmet prerequisite alternatives', () => {
    const model = minModel([FE_PROFILE, S1_PROFILE, S2_PROFILE], 3);
    const state: PlanState = { semesters: { s1: [FE], s2: [] } };
    const { warnings_he } = toProposal(state, model, EMPTY_STATE, {}, 'done');
    const warn = warnings_he.find(w => w.includes('שיטות אלמנטים סופיים'));
    // Both alternatives should be named (joined with 'או')
    expect(warn).toMatch(/מכאניקה/);
    expect(warn).toContain(' או ');
  });

  test('3. prerequisite in a strictly earlier semester: no audit warning', () => {
    const model = minModel([FE_PROFILE, S1_PROFILE, S2_PROFILE], 6);
    const state: PlanState = { semesters: { s1: [SOLIDS1], s2: [FE] } };
    const { warnings_he } = toProposal(state, model, EMPTY_STATE, {}, 'done');
    const auditWarn = warnings_he.find(w =>
      w.includes('קדם-קורס חסר') && w.includes('שיטות אלמנטים סופיים'),
    );
    expect(auditWarn).toBeUndefined();
  });

  test('4. prerequisite completed before the plan: no audit warning', () => {
    const completed = new Set([SOLIDS1]);
    const model = minModel([FE_PROFILE, S1_PROFILE, S2_PROFILE], 3, completed);
    const state: PlanState = { semesters: { s1: [FE], s2: [] } };
    const { warnings_he } = toProposal(state, model, EMPTY_STATE, {}, 'done');
    const auditWarn = warnings_he.find(w =>
      w.includes('קדם-קורס חסר') && w.includes('שיטות אלמנטים סופיים'),
    );
    expect(auditWarn).toBeUndefined();
  });

  test('5. second alternative satisfies the requirement: no audit warning', () => {
    const model = minModel([FE_PROFILE, S1_PROFILE, S2_PROFILE], 6);
    const state: PlanState = { semesters: { s1: [SOLIDS2], s2: [FE] } };
    const { warnings_he } = toProposal(state, model, EMPTY_STATE, {}, 'done');
    const auditWarn = warnings_he.find(w =>
      w.includes('קדם-קורס חסר') && w.includes('שיטות אלמנטים סופיים'),
    );
    expect(auditWarn).toBeUndefined();
  });

  test('6. course not in tau.json (unknown status): no audit warning', () => {
    const unknownProfile = minProfile('9999-9999', 'קורס לא ידוע', 3);
    const model = minModel([unknownProfile], 3);
    const state: PlanState = { semesters: { s1: ['9999-9999'], s2: [] } };
    const { warnings_he } = toProposal(state, model, EMPTY_STATE, {}, 'done');
    const auditWarn = warnings_he.find(w =>
      w.includes('קדם-קורס חסר') || w.includes('קו-קורס חסר'),
    );
    expect(auditWarn).toBeUndefined();
  });

  test('7. prerequisite same semester (not strictly earlier): audit warning fires', () => {
    // Both in same semester — prerequisite must be STRICTLY earlier; same semester fails
    const model = minModel([FE_PROFILE, S1_PROFILE, S2_PROFILE], 6);
    const state: PlanState = { semesters: { s1: [SOLIDS1, FE], s2: [] } };
    const { warnings_he } = toProposal(state, model, EMPTY_STATE, {}, 'done');
    const auditWarn = warnings_he.find(w =>
      w.includes('קדם-קורס חסר') && w.includes('שיטות אלמנטים סופיים'),
    );
    expect(auditWarn).toBeDefined();
  });

  test('8. no audit warnings when no courses are placed', () => {
    const model = minModel([FE_PROFILE, S1_PROFILE, S2_PROFILE], 0);
    const state: PlanState = { semesters: { s1: [], s2: [] } };
    const { warnings_he } = toProposal(state, model, EMPTY_STATE, {}, 'done');
    const auditWarn = warnings_he.find(w =>
      w.includes('קדם-קורס חסר') || w.includes('קו-קורס חסר'),
    );
    expect(auditWarn).toBeUndefined();
  });
});
