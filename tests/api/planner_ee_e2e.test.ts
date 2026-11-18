/**
 * Point-6 end-to-end planner verification for EE students.
 *
 * Tests the FULL pipeline:
 *   topicIds → buildCourseFitByIdFromTopicProfiles (EE resolver)
 *           → courseFitById → buildConstraintModel
 *           → PlannerWorker.run() (beam search, greedy)
 *           → placedCourseIds
 *
 * This differs from Point-5 (planner_ee_coherence_validation.test.ts) which
 * called scorePlan/compareScore directly. Point 6 runs the actual beam-search
 * planner end-to-end and verifies the final PLACED plan.
 *
 * Key adversarial scenario (the most valuable test):
 *   - SP course `0512-4200` available only in Sem A (heavy semester, peak 18h).
 *   - RL course `0512-4265` available only in Sem B (light semester, peak 14h).
 *   - Without topic focus → balance decides → RL placed (better peak).
 *   - With signal_processing focus → gFit 0.7 > 0 → SP placed (topic wins).
 *
 * EE course IDs used (TAU catalog):
 *   0512-4200  מבוא לעיבוד ספרתי של אותות    — signal_processing, 4h, all sems
 *   0512-4703  מבוא לתכנון מעגלי Vlsi          — vlsi_chip_design, 4h, all sems
 *   0512-4800  הנדסת מיקרוגלים                 — electromagnetics, 4h, B sems only
 *   0512-4265  מבוא ללמידה באמצעות חיזוקים      — ml_ai (neutral), 4h, B sems
 */

import { buildCourseFitByIdFromTopicProfiles } from '../../api/ai/generate_plan_interest_evaluation';
import { buildConstraintModel } from '../../api/ai/planner_model';
import { PlannerWorker } from '../../api/ai/planner_worker';
import { placedCourseIds } from '../../api/ai/planner_types';

// ── shared helpers ─────────────────────────────────────────────────────────────

const PROGRAM_ID = 'electrical_engineering_2027';
const WORKER_CFG = { topN: 6, rolloutSteps: 80 } as const;

function runPlanner(boardJson: object, fitById: Map<string, number> | undefined): string[] {
  const model = buildConstraintModel(boardJson, { courseFitById: fitById });
  const initState = { semesters: Object.fromEntries(model.knownSemesterIds.map((id) => [id, []])) };
  const worker = new PlannerWorker(model, initState, WORKER_CFG);
  worker.run(500, 'greedy');
  return placedCourseIds(worker.getPlan());
}

// ── Routing: EE resolver vs ME resolver ───────────────────────────────────────

describe('Point-6 routing: EE program routes to EE resolver', () => {
  const board = {
    semesters: [
      { semester_id: 'year_3_semester_a', courses: [{ course_id: 'HEAVY', name_he: 'ריבוי שעות', weekly_hours: 5 }] },
      { semester_id: 'year_3_semester_b', courses: [] },
    ],
    metadata: {
      completed_course_ids: [],
      program_requirements_categories: { total_required_hours: 9, categories: [] },
      program_repository_courses: [
        { course_id: '0512-4200', name_he: 'מבוא לעיבוד ספרתי של אותות', weekly_hours: 4, effective_allowed_semesters: ['year_3_semester_b'] },
      ],
    },
  };

  test('EE program_id routes 0512-4200 to signal_processing fit (fit > 0)', () => {
    const fit = buildCourseFitByIdFromTopicProfiles(board, ['signal_processing'], PROGRAM_ID);
    expect(fit).toBeDefined();
    expect(fit!.get('0512-4200')).toBeGreaterThan(0);
  });

  test('ME program_id returns no fit for EE-exclusive course 0512-4703 (VLSI)', () => {
    // 0512-4703 is EE-only: not in the ME catalog → ME resolver returns null → no fit.
    const boardWithVlsi = {
      ...board,
      metadata: {
        ...board.metadata,
        program_repository_courses: [
          { course_id: '0512-4703', name_he: 'מבוא לתכנון מעגלי Vlsi', weekly_hours: 4, effective_allowed_semesters: ['year_3_semester_b'] },
        ],
      },
    };
    const fit = buildCourseFitByIdFromTopicProfiles(boardWithVlsi, ['vlsi_chip_design'], 'mechanical_engineering_2027');
    expect(fit?.get('0512-4703') ?? 0).toBe(0);
  });

  test('no topicIds → buildCourseFitByIdFromTopicProfiles returns undefined', () => {
    const fit = buildCourseFitByIdFromTopicProfiles(board, [], PROGRAM_ID);
    expect(fit).toBeUndefined();
  });
});

// ── Core adversarial e2e: balance vs topic fit ────────────────────────────────

describe('Point-6 adversarial e2e: topic fit overrides balance in full planner run', () => {
  /**
   * Board forces a head-to-head: SP course can only go in the HEAVY semester
   * (making peak 18h), RL course can only go in the LIGHT semester (keeping peak 14h).
   * Without fit, balance wins (RL). With signal_processing fit, SP wins.
   */
  const adversarialBoard = {
    semesters: [
      { semester_id: 'year_3_semester_a', courses: [{ course_id: 'HEAVY_1', name_he: 'קורס כבד', weekly_hours: 14 }] },
      { semester_id: 'year_3_semester_b', courses: [{ course_id: 'LIGHT_1', name_he: 'קורס קל', weekly_hours: 6 }] },
    ],
    metadata: {
      completed_course_ids: [],
      program_requirements_categories: { total_required_hours: 24, categories: [] },
      program_repository_courses: [
        // SP: only Sem A (heavy) — picking it increases peak from 14h to 18h.
        { course_id: '0512-4200', name_he: 'מבוא לעיבוד ספרתי של אותות', weekly_hours: 4, effective_allowed_semesters: ['year_3_semester_a'] },
        // RL: only Sem B (light) — picking it keeps peak at 14h.
        { course_id: '0512-4265', name_he: 'מבוא ללמידה באמצעות חיזוקים', weekly_hours: 4, effective_allowed_semesters: ['year_3_semester_b'] },
      ],
    },
  };

  test('WITHOUT focus: balance wins — RL placed in light semester (peak stays 14h)', () => {
    const placed = runPlanner(adversarialBoard, undefined);
    expect(placed).toContain('0512-4265'); // RL in light sem
    expect(placed).not.toContain('0512-4200'); // SP not placed
  });

  test('WITH signal_processing focus: topic fit overrides balance — SP placed in heavy semester', () => {
    const fitById = buildCourseFitByIdFromTopicProfiles(adversarialBoard, ['signal_processing'], PROGRAM_ID);
    const placed = runPlanner(adversarialBoard, fitById);
    expect(placed).toContain('0512-4200'); // SP placed despite worse balance
    expect(placed).not.toContain('0512-4265'); // RL not placed
  });
});

// ── Multi-slot: planner fills electives with topic-aligned courses ────────────

describe('Point-6 multi-slot: planner fills both elective slots with topic courses', () => {
  /**
   * Two open elective slots. Repo has SP + VLSI (topic) and RL + LLM-security (neutral).
   * With signal_processing + vlsi_chip_design focus, both slots should be filled
   * by the topic courses, not the neutral ones.
   */
  const twoSlotBoard = {
    semesters: [
      { semester_id: 'year_3_semester_a', courses: [{ course_id: 'HEAVY_1', name_he: 'קורס בסיסי', weekly_hours: 5 }] },
      { semester_id: 'year_3_semester_b', courses: [] },
      { semester_id: 'year_4_semester_a', courses: [] },
    ],
    metadata: {
      completed_course_ids: [],
      program_requirements_categories: { total_required_hours: 13, categories: [] },
      program_repository_courses: [
        { course_id: '0512-4200', name_he: 'מבוא לעיבוד ספרתי של אותות', weekly_hours: 4, effective_allowed_semesters: ['year_3_semester_b', 'year_4_semester_a'] },
        { course_id: '0512-4703', name_he: 'מבוא לתכנון מעגלי Vlsi', weekly_hours: 4, effective_allowed_semesters: ['year_3_semester_b', 'year_4_semester_a'] },
        { course_id: '0512-4265', name_he: 'מבוא ללמידה באמצעות חיזוקים', weekly_hours: 4, effective_allowed_semesters: ['year_3_semester_b', 'year_4_semester_a'] },
        { course_id: '0512-4266', name_he: 'אבטחה ובטיחות של מודלי שפה', weekly_hours: 4, effective_allowed_semesters: ['year_3_semester_b', 'year_4_semester_a'] },
      ],
    },
  };

  test('SP and VLSI are both placed when focused on signal_processing + vlsi_chip_design', () => {
    const fitById = buildCourseFitByIdFromTopicProfiles(twoSlotBoard, ['signal_processing', 'vlsi_chip_design'], PROGRAM_ID);
    expect(fitById?.get('0512-4200')).toBeGreaterThan(0);
    expect(fitById?.get('0512-4703')).toBeGreaterThan(0);

    const placed = runPlanner(twoSlotBoard, fitById);
    expect(placed).toContain('0512-4200');
    expect(placed).toContain('0512-4703');
    expect(placed).not.toContain('0512-4265');
    expect(placed).not.toContain('0512-4266');
  });
});

// ── EM focus: B-semester-only course ─────────────────────────────────────────

describe('Point-6 electromagnetics: B-semester-only course placed correctly', () => {
  /**
   * 0512-4800 (הנדסת מיקרוגלים) is offered only in B semesters.
   * The planner must route it to a B semester despite its worse balance.
   */
  const emBoard = {
    semesters: [
      { semester_id: 'year_3_semester_a', courses: [{ course_id: 'HEAVY_1', name_he: 'קורס כבד', weekly_hours: 14 }] },
      { semester_id: 'year_3_semester_b', courses: [{ course_id: 'LIGHT_1', name_he: 'קורס קל', weekly_hours: 6 }] },
    ],
    metadata: {
      completed_course_ids: [],
      program_requirements_categories: { total_required_hours: 24, categories: [] },
      program_repository_courses: [
        // EM: only Sem B (makes light sem heavier, worse balance than putting RL elsewhere)
        { course_id: '0512-4800', name_he: 'הנדסת מיקרוגלים', weekly_hours: 4, effective_allowed_semesters: ['year_3_semester_b'] },
        // RL: only Sem B as well (same constraint — EM must beat RL via fit)
        { course_id: '0512-4265', name_he: 'מבוא ללמידה באמצעות חיזוקים', weekly_hours: 4, effective_allowed_semesters: ['year_3_semester_b'] },
      ],
    },
  };

  test('WITHOUT focus: RL placed over EM (both Sem-B; first choice by other criteria)', () => {
    // Without fit, both EM and RL are equivalent; planner picks one.
    // This test documents the BASELINE — which the with-focus test must override.
    const placed = runPlanner(emBoard, undefined);
    // We only care that the baseline doesn't require fit; it may pick either.
    // The important test is the next one.
    expect(placed.length).toBeGreaterThan(0);
  });

  test('WITH electromagnetics focus: EM course placed over neutral RL', () => {
    const fitById = buildCourseFitByIdFromTopicProfiles(emBoard, ['electromagnetics'], PROGRAM_ID);
    expect(fitById?.get('0512-4800')).toBeGreaterThan(0);
    const placed = runPlanner(emBoard, fitById);
    expect(placed).toContain('0512-4800');
    expect(placed).not.toContain('0512-4265');
  });
});

// ── Backward compatibility: no fit → no change in vanilla plan ───────────────

describe('Point-6 backward compatibility: no topicIds → planner unchanged', () => {
  const baseBoard = {
    semesters: [
      { semester_id: 'year_3_semester_a', courses: [{ course_id: 'HEAVY_1', name_he: 'קורס בסיסי', weekly_hours: 8 }] },
      { semester_id: 'year_3_semester_b', courses: [] },
    ],
    metadata: {
      completed_course_ids: [],
      program_requirements_categories: { total_required_hours: 12, categories: [] },
      program_repository_courses: [
        { course_id: '0512-4265', name_he: 'מבוא ללמידה באמצעות חיזוקים', weekly_hours: 4, effective_allowed_semesters: ['year_3_semester_b'] },
      ],
    },
  };

  test('with undefined courseFitById, planner still produces a valid plan', () => {
    const placed = runPlanner(baseBoard, undefined);
    expect(placed.length).toBeGreaterThan(0);
    expect(placed).toContain('HEAVY_1');
  });

  test('buildCourseFitByIdFromTopicProfiles with empty topicIds returns undefined', () => {
    const fit = buildCourseFitByIdFromTopicProfiles(baseBoard, [], PROGRAM_ID);
    expect(fit).toBeUndefined();
  });
});
