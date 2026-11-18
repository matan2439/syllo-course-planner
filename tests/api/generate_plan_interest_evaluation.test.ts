/**
 * Contract tests for buildCourseFitByIdFromTopicProfiles —
 * the topic-profile-based per-course fit signal wired into the planner's
 * interest_fit goal (Priority 4).
 */

import { buildCourseFitByIdFromTopicProfiles } from '../../api/ai/generate_plan_interest_evaluation';
import { loadMechanicalEngineering2027Catalog } from '../../api/ai/course_catalog';
import { mergeExplicitFocusObjective, mergeStructuredAvoidObjective } from '../../api/ai/focus_topic_objective';

/** Minimal board shape with one semester containing a subset of catalog courses. */
function makeBoard(courseIds: string[]): object {
  return {
    semesters: [{ semester_id: 'year_1_semester_a', courses: courseIds.map((id) => ({ course_id: id })) }],
  };
}

const catalog = loadMechanicalEngineering2027Catalog();
const allIds = catalog.map((c) => c.courseId);

describe('buildCourseFitByIdFromTopicProfiles', () => {
  test('returns undefined for empty topicIds', () => {
    const board = makeBoard(allIds.slice(0, 10));
    expect(buildCourseFitByIdFromTopicProfiles(board, [])).toBeUndefined();
  });

  test('returns undefined for empty board', () => {
    const result = buildCourseFitByIdFromTopicProfiles({ semesters: [] }, ['solid_mechanics']);
    expect(result).toBeUndefined();
  });

  test('returns undefined for a topicId with no AcademicFocusArea mapping (programming_electronics)', () => {
    // programming_electronics has no FOCUS_TO_TOPIC mapping → no areas → no fit
    const board = makeBoard(allIds);
    const result = buildCourseFitByIdFromTopicProfiles(board, ['programming_electronics']);
    expect(result).toBeUndefined();
  });

  test('solid_mechanics matches strength-analysis courses with positive scores', () => {
    const board = makeBoard(allIds);
    const result = buildCourseFitByIdFromTopicProfiles(board, ['solid_mechanics']);
    expect(result).toBeDefined();
    expect(result!.size).toBeGreaterThan(0);
    // All returned scores must be positive
    for (const score of result!.values()) {
      expect(score).toBeGreaterThan(0);
    }
  });

  test('robotics fits robotics/mechatronics courses', () => {
    const board = makeBoard(allIds);
    const result = buildCourseFitByIdFromTopicProfiles(board, ['robotics']);
    expect(result).toBeDefined();
    expect(result!.size).toBeGreaterThan(0);
  });

  test('thermofluids (heat_transfer + thermal_systems + fluids) covers more courses than solid_mechanics alone', () => {
    const board = makeBoard(allIds);
    const thermoFit = buildCourseFitByIdFromTopicProfiles(board, ['thermofluids']);
    const solidFit = buildCourseFitByIdFromTopicProfiles(board, ['solid_mechanics']);
    // thermofluids maps to 3 AcademicFocusAreas, solid_mechanics to 1 — should cover ≥ as many courses
    if (thermoFit && solidFit) {
      expect(thermoFit.size).toBeGreaterThanOrEqual(solidFit.size);
    } else if (!thermoFit) {
      // only possible if the catalog has no fluid/thermal/heat-transfer courses, unlikely
      fail('thermofluids returned no fit for a full catalog board');
    }
  });

  test('multiple topicIds union their area sets and cover more courses', () => {
    const board = makeBoard(allIds);
    const solid = buildCourseFitByIdFromTopicProfiles(board, ['solid_mechanics']);
    const robotics = buildCourseFitByIdFromTopicProfiles(board, ['robotics']);
    const both = buildCourseFitByIdFromTopicProfiles(board, ['solid_mechanics', 'robotics']);
    if (solid && robotics) {
      expect(both).toBeDefined();
      expect(both!.size).toBeGreaterThanOrEqual(Math.max(solid.size, robotics.size));
    }
  });

  test('scores are strictly positive numbers', () => {
    const board = makeBoard(allIds);
    const result = buildCourseFitByIdFromTopicProfiles(board, ['solid_mechanics', 'control']);
    if (result) {
      for (const [, score] of result) {
        expect(typeof score).toBe('number');
        expect(score).toBeGreaterThan(0);
        expect(Number.isFinite(score)).toBe(true);
      }
    }
  });

  test('only returns ids that were on the board', () => {
    const subset = allIds.slice(0, 20);
    const board = makeBoard(subset);
    const subsetSet = new Set(subset);
    const result = buildCourseFitByIdFromTopicProfiles(board, ['solid_mechanics', 'robotics', 'thermofluids', 'control']);
    if (result) {
      for (const id of result.keys()) {
        expect(subsetSet.has(id)).toBe(true);
      }
    }
  });

  test('avoid-only: preferred topicIds extraction returns undefined — no positive interest_fit', () => {
    // Regression guard: when only avoidAreas are set, there is no prefer_topic_alignment
    // objective, so the extracted preferTopicIds must be undefined and no positive
    // courseFitById entries should be built for the avoided topics.
    const board = makeBoard(allIds);
    const avoidOnly = mergeStructuredAvoidObjective(undefined, [{ area: 'finite_elements', weight: 1 }], 1)!;
    expect(avoidOnly).toBeDefined();
    // The correct read: extract from prefer_topic_alignment by id — not from the
    // legacy topicIds field, which finalize() may set from the alphabetically-first
    // objective (avoid_topic_exposure sorts before prefer_topic_alignment).
    const preferTopicIds = avoidOnly.objectives.find((o) => o.id === 'prefer_topic_alignment')?.topicIds;
    expect(preferTopicIds).toBeUndefined();
    // Consequence: no positive courseFitById is built for FEM courses.
    expect(buildCourseFitByIdFromTopicProfiles(board, preferTopicIds ?? [])).toBeUndefined();
  });

  test('focus+avoid: preferTopicIds carries only the preferred topic, avoided topic gets no positive fit', () => {
    // When both focusAreas and avoidAreas are set, the caller must read topicIds
    // from prefer_topic_alignment (by id), not from the first sorted objective.
    // finite_elements is avoided; robotics is preferred.
    const board = makeBoard(allIds);
    const withFocus = mergeExplicitFocusObjective(undefined, [{ area: 'robotics', weight: 1 }], 1)!;
    const both = mergeStructuredAvoidObjective(withFocus, [{ area: 'finite_elements', weight: 1 }], 1)!;

    const preferTopicIds = both.objectives.find((o) => o.id === 'prefer_topic_alignment')?.topicIds;
    expect(preferTopicIds).toBeDefined();
    expect(preferTopicIds).toContain('robotics');
    expect(preferTopicIds).not.toContain('finite_element_analysis');

    // Positive fit is built for robotics courses, not for FEM courses.
    const fit = buildCourseFitByIdFromTopicProfiles(board, preferTopicIds!);
    expect(fit).toBeDefined();
    for (const score of fit!.values()) {
      expect(score).toBeGreaterThan(0);
    }

    // Verify: if we were to (incorrectly) use the legacy topicIds field — which
    // finalize() populates from the alphabetically-first objective when both
    // objectives are present — it would contain the avoided topic, not the
    // preferred one. The fix is to never use resolvedGrounded.topicIds for
    // positive interest_fit scoring; always read from prefer_topic_alignment by id.
    const avoidObjective = both.objectives.find((o) => o.id === 'avoid_topic_exposure');
    expect(avoidObjective?.topicIds).toContain('finite_element_analysis');
  });

  test('program_repository_courses are also scored', () => {
    // Board with no semester courses but repo courses
    const repoBoard = {
      semesters: [],
      metadata: {
        program_repository_courses: allIds.map((id) => ({ course_id: id })),
      },
    };
    const result = buildCourseFitByIdFromTopicProfiles(repoBoard, ['solid_mechanics']);
    expect(result).toBeDefined();
    expect(result!.size).toBeGreaterThan(0);
  });
});
