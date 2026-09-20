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
import { buildConstraintModel, planContextToState } from '../../api/ai/planner_model';
import { HARD_LOAD_CAP, SOFT_LOAD_MAX, ABSOLUTE_MAX_REASONABLE } from '../../api/ai/load_constants';
import { PlannerWorker } from '../../api/ai/planner_worker';
import { GreedyOrchestrator } from '../../api/ai/planner_orchestrator';
import { placedCourseIds, emptyState } from '../../api/ai/planner_types';
import { degreeHours as computeDegreeHours, placedHours } from '../../api/ai/planner_goals';

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

  it('threads currentlyPlannedCourseIds through to the model (default: empty set)', () => {
    const withoutCurrent = buildConstraintModel(CS_BOARD as any);
    expect(withoutCurrent.currentlyPlannedCourseIds!.size).toBe(0);

    const withCurrent = buildConstraintModel(CS_BOARD as any, {
      currentlyPlannedCourseIds: ['CS-T1'],
    });
    expect(withCurrent.currentlyPlannedCourseIds!.has('CS-T1')).toBe(true);
  });

  it('threads the overload-override options through to the model (default: unset)', () => {
    const withoutOverride = buildConstraintModel(CS_BOARD as any);
    expect(withoutOverride.overloadAccepted).toBeUndefined();
    expect(withoutOverride.overloadConfirmedAt).toBeUndefined();

    const confirmedAt = Date.now();
    const withOverride = buildConstraintModel(CS_BOARD as any, {
      overloadAccepted: true, overloadConfirmedAt: confirmedAt,
    });
    expect(withOverride.overloadAccepted).toBe(true);
    expect(withOverride.overloadConfirmedAt).toBe(confirmedAt);
  });

  it('threads institution/program identity options through to the model (default: unset)', () => {
    const withoutIdentity = buildConstraintModel(CS_BOARD as any);
    expect(withoutIdentity.institutionId).toBeUndefined();
    expect(withoutIdentity.programId).toBeUndefined();
    expect(withoutIdentity.catalogYear).toBeUndefined();

    const withIdentity = buildConstraintModel(CS_BOARD as any, {
      programId: 'mechanical_engineering', catalogYear: 2027,
    });
    expect(withIdentity.institutionId).toBeUndefined(); // never fabricated
    expect(withIdentity.programId).toBe('mechanical_engineering');
    expect(withIdentity.catalogYear).toBe(2027);
  });

  it('defaults load-cap thresholds to load_constants.ts (no behavior change)', () => {
    const m = buildConstraintModel(CS_BOARD as any);
    expect(m.hardCap).toBe(HARD_LOAD_CAP);
    expect(m.softLoadMax).toBe(SOFT_LOAD_MAX);
    expect(m.absoluteMaxReasonable).toBe(ABSOLUTE_MAX_REASONABLE);
  });

  it('threads load-cap threshold overrides through to the model', () => {
    const m = buildConstraintModel(CS_BOARD as any, {
      hardCap: 99, softLoadMax: 50, absoluteMaxReasonable: 120,
    });
    expect(m.hardCap).toBe(99);
    expect(m.softLoadMax).toBe(50);
    expect(m.absoluteMaxReasonable).toBe(120);
  });
});

describe('buildConstraintModel — currently-taking mandatory requirement accounting', () => {
  it('excludes a currently-taking mandatory course from requiredMandatoryCourseIds', () => {
    const m = buildConstraintModel(CS_BOARD as any, {
      currentlyPlannedCourseIds: ['CS-M1'],
    });
    // Rule 2a forbids re-proposing a currently-taking course, so requiring it
    // to appear in the plan would be an impossible requirement.
    expect(m.requiredMandatoryCourseIds).not.toContain('CS-M1');
    // It is still part of the model's currently-planned set (rule 2a input).
    expect(m.currentlyPlannedCourseIds!.has('CS-M1')).toBe(true);
  });

  it('negative: a mandatory course neither completed nor currently taking stays required', () => {
    const m = buildConstraintModel(CS_BOARD as any, {
      currentlyPlannedCourseIds: ['CS-T1'], // unrelated elective
    });
    expect(m.requiredMandatoryCourseIds).toContain('CS-M1');
  });

  it('completed-course accounting unchanged: completed mandatory stays excluded, priorHours unchanged', () => {
    const m = buildConstraintModel(CS_BOARD as any, {
      completedCourseIds: ['CS-M1'],
    });
    expect(m.requiredMandatoryCourseIds).not.toContain('CS-M1');
    // CS-DONE (6h, board metadata) + CS-M1 (5h) — completed semantics untouched.
    expect(m.priorHours).toBe(11);
  });

  it('dedup: a course in both completed and currently_taking is accounted for once, without contradiction', () => {
    const m = buildConstraintModel(CS_BOARD as any, {
      completedCourseIds: ['CS-M1'],
      currentlyPlannedCourseIds: ['CS-M1'],
    });
    expect(m.requiredMandatoryCourseIds).not.toContain('CS-M1');
    // no duplicate entries anywhere in the required set
    expect(new Set(m.requiredMandatoryCourseIds).size).toBe(m.requiredMandatoryCourseIds.length);
    // completed wins for prior-hours purposes, counted once
    expect(m.priorHours).toBe(11);
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

describe('placedHours — real ME-2027 annual course (0542-3792) is deduplicated', () => {
  // 0542-3792 is a real annual course: the SAME course_id, placed identically in
  // both year_3_semester_a and year_3_semester_b (not two sibling ids sharing a
  // root — see buildCourseProfiles, which merges same-course_id placements into
  // one CourseProfile). This must use the real board (not a hand-built fixture
  // that sets root_course_id directly) — a hand fixture is exactly what hid this
  // bug the first time.
  it('counts 0542-3792 once (4h) even though it is placed in both its semesters', () => {
    const m = buildConstraintModel(REAL_BOARD);
    const profile = m.profiles.get('0542-3792');
    expect(profile).toBeDefined();
    expect(profile!.count_hours_once).toBe(true);

    const state = emptyState(m.knownSemesterIds);
    state.semesters['year_3_semester_a'] = ['0542-3792'];
    state.semesters['year_3_semester_b'] = ['0542-3792'];

    expect(placedHours(state, m)).toBe(profile!.hours);
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

const DOUBLE_COUNT_BOARD = {
  semesters: [
    { semester_id: 'year_3_semester_a', courses: [
      { course_id: 'BOARD1', name_he: 'בוצע א', weekly_hours: 10, is_mandatory: false, course_type: 'elective', placement_policy: 'elective', effective_allowed_semesters: ['year_3_semester_a'], prerequisites: [] },
      { course_id: 'BOARD2', name_he: 'בוצע ב', weekly_hours: 10, is_mandatory: false, course_type: 'elective', placement_policy: 'elective', effective_allowed_semesters: ['year_3_semester_a'], prerequisites: [] },
    ] },
  ],
  metadata: {
    completed_course_ids: [],
    program_requirements_categories: { total_required_hours: 185, categories: [] },
    program_repository_courses: [
      { course_id: 'BOARD1', weekly_hours: 10, is_mandatory: false, course_type: 'elective', placement_policy: 'elective', effective_allowed_semesters: ['year_3_semester_a'], prerequisites: [] },
      { course_id: 'BOARD2', weekly_hours: 10, is_mandatory: false, course_type: 'elective', placement_policy: 'elective', effective_allowed_semesters: ['year_3_semester_a'], prerequisites: [] },
    ],
  },
};
const PLACED_CTX = { semesters: [{ id: 'year_3_semester_a', courses: [
  { course_id: 'BOARD1' }, { course_id: 'BOARD2' },
] }] };

describe('priorHours + seeded board must not double-count', () => {
  // priorHoursFromContext (generate-plan.ts) returns known_completed_hours only —
  // NOT + currently_planned_hours. Board-placed courses are separately seeded into
  // initialState by planContextToState, so adding them to priorHours would count them twice.

  it('degreeHours = priorHours(100) + placedHours(20) = 120, not 140', () => {
    // Correct formula: priorHours = known_completed_hours = 100 (no double-count)
    const model = buildConstraintModel(DOUBLE_COUNT_BOARD as any, { priorHours: 100 });
    const state = planContextToState(PLACED_CTX, model);
    expect(computeDegreeHours(state, model)).toBe(120);
  });

  it('if priorHours were 120 (buggy: +currently_planned_hours), degreeHours would be 140', () => {
    // Regression witness: this is what the old formula produced with currently_planned_hours=20
    const buggyModel = buildConstraintModel(DOUBLE_COUNT_BOARD as any, { priorHours: 120 });
    const state = planContextToState(PLACED_CTX, buggyModel);
    expect(computeDegreeHours(state, buggyModel)).toBe(140);
  });
});
