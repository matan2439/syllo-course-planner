/**
 * Tests for api/ai/planner_model.ts — buildConstraintModel makes the
 * ConstraintModel the single source of truth for a planning run: the complete,
 * program-AGNOSTIC planning world derived once from board_json + user context
 * (program requirements, mandatory, completed, disallowed, categories, semester
 * availability, prerequisites, CourseProfiles, preferences, prior hours).
 *
 * Includes the deferred ME-2027 greedy oracle: a real-board end-to-end run that
 * reaches a valid, complete plan.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { buildConstraintModel, buildModelFromPlanContext, planContextToState } from '../../api/ai/planner_model';
import { PlannerWorker } from '../../api/ai/planner_worker';
import { GreedyOrchestrator } from '../../api/ai/planner_orchestrator';
import { placedCourseIds } from '../../api/ai/planner_types';
import { degreeHours as computeDegreeHours } from '../../api/ai/planner_goals';

const REAL_BOARD = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'data', 'parsed_json', 'mechanical_semester_board_2027.json'), 'utf8'),
);

// A second, made-up program to prove the builder is not ME-specific.
const CS_BOARD = {
  semesters: [
    { semester_id: 'year_2_semester_a', courses: [
      { course_id: 'CS-M1', name_he: 'אלגוריתמים', weekly_hours: 5, is_mandatory: true, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_2_semester_a'], prerequisites: [] },
    ] },
    { semester_id: 'year_2_semester_b', courses: [] },
  ],
  metadata: {
    completed_course_ids: ['CS-DONE'],
    program_requirements_categories: {
      total_required_hours: 120,
      program_name_he: 'מדעי המחשב',
      categories: [
        { category_id: 'theory', name_he: 'תאוריה', min_courses: 1, course_ids: ['CS-T1', 'CS-T2'] },
        { category_id: 'open', name_he: 'חופשי', min_courses: 0, course_ids: ['CS-O1'] },
      ],
    },
    program_repository_courses: [
      { course_id: 'CS-T1', name_he: 'חישוביות', weekly_hours: 4, category_id: 'theory' },
      { course_id: 'CS-T2', name_he: 'סיבוכיות', weekly_hours: 4, category_id: 'theory' },
      { course_id: 'CS-DONE', name_he: 'מבוא', weekly_hours: 6 },
    ],
  },
};

describe('buildConstraintModel — program-agnostic extraction', () => {
  it('extracts the CS program world from its own board metadata (no ME constants)', () => {
    const m = buildConstraintModel(CS_BOARD as any);
    expect(m.degreeRequiredHours).toBe(120);
    expect(m.knownSemesterIds).toEqual(['year_2_semester_a', 'year_2_semester_b']);
    // only min_courses>0 categories become hard requirements
    expect(m.categories.map(c => c.id)).toEqual(['theory']);
    expect(m.categories[0].required).toBe(1);
    expect(m.categories[0].candidateIds).toEqual(['CS-T1', 'CS-T2']);
    // mandatory that is not completed
    expect(m.requiredMandatoryCourseIds).toContain('CS-M1');
    // completed course excluded from "required", counted in prior hours
    expect(m.completedCourseIds.has('CS-DONE')).toBe(true);
    expect(m.priorHours).toBe(6); // CS-DONE weekly_hours
  });

  it('builds a CourseProfile for the entire universe (prerequisite graph included)', () => {
    const m = buildConstraintModel(CS_BOARD as any);
    // every placed + repository course has a profile (the prereq graph lives in profiles)
    expect(m.profiles.has('CS-M1')).toBe(true);
    expect(m.profiles.has('CS-T1')).toBe(true);
    expect(m.profiles.has('CS-DONE')).toBe(true);
    expect(m.profiles.get('CS-M1')!.prerequisites).toEqual([]);
  });

  it('passes user preferences/exclusions through to the model', () => {
    const m = buildConstraintModel(CS_BOARD as any, {
      wantedCourseIds: ['CS-T1'], disallowedCourseIds: ['CS-T2'], maxHoursPerSemester: 18,
    });
    expect(m.wantedCourseIds.has('CS-T1')).toBe(true);
    expect(m.disallowedCourseIds.has('CS-T2')).toBe(true);
    expect(m.profiles.get('CS-T2')!.excluded).toBe(true);
    expect(m.maxHoursPerSemester).toBe(18);
  });
});

describe('buildConstraintModel — real ME-2027 board', () => {
  it('extracts 185 hours, the four required categories, and the mandatory set', () => {
    const m = buildConstraintModel(REAL_BOARD);
    expect(m.degreeRequiredHours).toBe(185);
    expect(m.knownSemesterIds).toHaveLength(4);
    expect(m.categories.map(c => c.id).sort()).toEqual(['advanced_labs', 'fluids', 'solids', 'systems']);
    // other_specialization (min 0) is NOT a hard requirement
    expect(m.categories.map(c => c.id)).not.toContain('other_specialization');
    // 13 mandatory placements, but one (0542-3792) is annual / spans two
    // semesters, so the eligible universe holds 12 unique mandatory courses.
    expect(m.requiredMandatoryCourseIds.length).toBe(12);
    // full universe profiled
    expect(m.profiles.size).toBeGreaterThan(40);
  });
});

describe('ME-2027 greedy oracle (real board, end-to-end)', () => {
  it('GreedyOrchestrator builds a valid, complete plan satisfying all requirements', async () => {
    const m = buildConstraintModel(REAL_BOARD);
    const mandatoryHours = m.requiredMandatoryCourseIds.reduce(
      (s, id) => s + (m.profiles.get(id)?.hours ?? 0), 0,
    );
    // Set prior (years 1–2) hours so the remaining gap fits in the 4 board semesters.
    const model = { ...m, priorHours: m.degreeRequiredHours - mandatoryHours - 24 };

    const w = new PlannerWorker(model, undefined, { lookahead: false }); // fast deterministic pass
    await new GreedyOrchestrator().run(w);

    const report = w.validateCandidate();
    expect(report.valid).toBe(true);
    expect(report.degreeHours).toBeGreaterThanOrEqual(185);
    // all not-completed mandatory placed
    for (const id of model.requiredMandatoryCourseIds) {
      expect(placedCourseIds(w.getPlan())).toContain(id);
    }
    // all four required categories satisfied, nothing over the hard cap
    expect(w.getState().allCategoriesSatisfied).toBe(true);
    expect(Math.max(...Object.values(w.getState().semesterLoads))).toBeLessThanOrEqual(26);
  });
});

// ── priorHours double-count guard ─────────────────────────────────────────────

describe('buildModelFromPlanContext — priorHours does not double-count board-placed courses', () => {
  // Simulate a scenario where a client (correctly or incorrectly) sends
  // currently_planned_hours that may overlap with board-placed course hours.
  // After the fix, priorHours should equal known_completed_hours only.

  const planCtx = {
    semesters: [
      { id: 'year_3_semester_a', courses: [
        { course_id: 'BOARD1', name_he: 'בוצע א', hours: 10, course_type: 'elective', placement_policy: 'elective' },
        { course_id: 'BOARD2', name_he: 'בוצע ב', hours: 10, course_type: 'elective', placement_policy: 'elective' },
      ] },
    ],
    category_requirements: [],
    total_hours_progress: {
      known_completed_hours: 100,
      // Simulates an old/buggy client that includes board-placed course hours here.
      currently_planned_hours: 20,
      degree_required_hours: 185,
    },
    personal_status: { completed: [] },
  };

  it('priorHours equals known_completed_hours (currently_planned_hours excluded after fix)', () => {
    const model = buildModelFromPlanContext(planCtx);
    // After fix: priorHours should be 100 (known_completed only).
    // Before fix: priorHours was 120 (100 + 20), causing a double-count when BOARD1+BOARD2 are also seeded.
    expect(model.priorHours).toBe(100);
  });

  it('degreeHours with seeded board equals priorHours + placedHours (not priorHours + 20 + placedHours)', () => {
    const model = buildModelFromPlanContext(planCtx);
    const seededState = planContextToState(planCtx as any, model);
    const dh = computeDegreeHours(seededState, model);
    // BOARD1 + BOARD2 = 20 placed hours; priorHours = 100 → degreeHours = 120
    expect(dh).toBe(120);
    // Before fix: would have been 140 (120 priorHours + 20 placed = double-count)
    expect(dh).not.toBe(140);
  });
});
