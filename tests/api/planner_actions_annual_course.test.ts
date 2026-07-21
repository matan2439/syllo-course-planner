/**
 * Regression — annual (year-long) courses must be placed atomically into ALL
 * of their `spans_semesters`, never split into a single-semester choice.
 *
 * Root cause (found while re-verifying issue #25's "semester-balance /
 * dual-offered-course placement" item against the real board fixture):
 * `enumerateActions` generated one ADD_COURSE action per legal semester for
 * EVERY course, including `is_annual` ones — the search then treated the two
 * semesters as mutually-exclusive alternatives and placed the course in only
 * one, silently under-reporting the true weekly load for the other spanned
 * semester. `completion_analysis.ts`'s `repairAddMissingMandatory` already
 * handles this correctly for its own (unrelated, dead-for-generate-plan.ts)
 * repair pipeline; this locks the same behavior into the live shared action
 * space (`enumerateActions`/`applyMutation`), which both the default
 * PlannerWorker path and the agentic PlannerAgent/beam path consume via
 * `TauPolicyProvider.generateActions`.
 *
 * Also locks: an already-placed annual course must never be considered
 * movable/replaceable (isMovable) — moving or replacing it out of one
 * semester only would split the pair, exactly what `course_profile.ts`'s own
 * LLM-facing note ("שנתי — לא ניתן להזזה/פיצול") already documents as
 * intended but the code never enforced.
 *
 * Codex review on the first version of this fix (PR #37) correctly found two
 * more gaps in the same theme, both locked in below:
 *   P1 — `PlannerWorker.addCourse()` (the production `add_course` AI-SDK tool
 *        the `LlmOrchestrator` path actually calls) built its own literal
 *        single-semester ADD_COURSE mutation directly, bypassing
 *        `enumerateActions`/`addCourseActionsFor` entirely — so even with the
 *        search-path fix above, a real LLM-driven run could still place an
 *        annual course in only one semester via that tool.
 *   P2 — the duplicate-placement validator only fires on a *repeat*, so a
 *        plan where an annual course is missing one of its spans_semesters
 *        (e.g. because something split it, or added only one span) was never
 *        flagged as invalid at all.
 */

import { enumerateActions, isMovable, addCourseActionsFor } from '../../api/ai/planner_actions';
import { applyMutation, isFullyPlaced } from '../../api/ai/planner_goals';
import { PlannerWorker } from '../../api/ai/planner_worker';
import { validatePlanProposal, type PlanValidationContext } from '../../api/ai/plan_validation';
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

function baseModel(over: Partial<ConstraintModel> = {}): ConstraintModel {
  const profiles = new Map<string, CourseProfile>();
  return {
    profiles,
    knownSemesterIds: SEMS,
    completedCourseIds: new Set(),
    requiredMandatoryCourseIds: [],
    categories: [],
    degreeRequiredHours: 185,
    priorHours: 0,
    maxHoursPerSemester: 22,
    hardCap: 26,
    disallowedCourseIds: new Set(),
    pinnedCourseIds: new Set(),
    wantedCourseIds: new Set(),
    ...over,
  };
}

function annualProfile(id: string, spans: string[], over: Partial<CourseProfile> = {}): CourseProfile {
  return profile(id, {
    is_mandatory: true,
    course_type: 'mandatory',
    placement_policy: 'annual',
    effective_allowed_semesters: spans,
    hours: 4,
    is_annual: true,
    spans_semesters: spans,
    count_hours_once: true,
    root_course_id: id,
    ...over,
  } as Partial<CourseProfile>);
}

describe('enumerateActions — annual (year-long) course placement', () => {
  it('generates exactly one ADD_COURSE action for an unplaced annual course, targeting both spanned semesters atomically', () => {
    const spans = ['year_3_semester_a', 'year_3_semester_b'];
    const profiles = new Map<string, CourseProfile>();
    profiles.set('ANNUAL', annualProfile('ANNUAL', spans));
    const model = baseModel({ profiles, requiredMandatoryCourseIds: ['ANNUAL'] });
    const state = emptyState(SEMS);

    const actions = enumerateActions(state, model).filter(a => a.type === 'ADD_COURSE' && (a as any).courseId === 'ANNUAL');

    expect(actions).toHaveLength(1);
    const action = actions[0] as any;
    expect([action.semesterId, ...(action.alsoSemesterIds ?? [])].sort()).toEqual([...spans].sort());
  });

  it('applyMutation places the annual course in every spanned semester at once, never just one', () => {
    const spans = ['year_3_semester_a', 'year_3_semester_b'];
    const profiles = new Map<string, CourseProfile>();
    profiles.set('ANNUAL', annualProfile('ANNUAL', spans));
    const model = baseModel({ profiles, requiredMandatoryCourseIds: ['ANNUAL'] });
    const state = emptyState(SEMS);

    const [action] = enumerateActions(state, model).filter(a => a.type === 'ADD_COURSE' && (a as any).courseId === 'ANNUAL');
    const next = applyMutation(state, action);

    expect(next).not.toBeNull();
    expect(next!.semesters['year_3_semester_a']).toContain('ANNUAL');
    expect(next!.semesters['year_3_semester_b']).toContain('ANNUAL');
    expect(next!.semesters['year_4_semester_a']).not.toContain('ANNUAL');
    expect(next!.semesters['year_4_semester_b']).not.toContain('ANNUAL');
  });

  it('a non-annual dual-offered course still gets one ADD_COURSE action per legal semester (unchanged behavior)', () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('DUAL', profile('DUAL', {
      is_mandatory: false, course_type: 'elective', placement_policy: 'elective',
      effective_allowed_semesters: ['year_3_semester_a', 'year_3_semester_b'], hours: 4,
    }));
    const model = baseModel({
      profiles,
      categories: [{ id: 'cat', name: 'cat', required: 1, candidateIds: ['DUAL'] }],
      // Keep the degree-hour-fill branch (Group 4) from also proposing DUAL
      // independently of the category branch (Group 2) — this test isolates
      // Group 2's per-legal-semester action generation.
      degreeRequiredHours: 0,
    });
    const state = emptyState(SEMS);

    const actions = enumerateActions(state, model).filter(a => a.type === 'ADD_COURSE' && (a as any).courseId === 'DUAL');
    expect(actions).toHaveLength(2);
    expect(actions.map((a: any) => a.semesterId).sort()).toEqual(['year_3_semester_a', 'year_3_semester_b']);
    expect(actions.every((a: any) => !a.alsoSemesterIds)).toBe(true);
  });

  it('applyMutation returns null (no partial placement) if any spanned semester is unknown to the state', () => {
    const state = emptyState(['year_3_semester_a']); // year_3_semester_b missing entirely
    const next = applyMutation(state, {
      type: 'ADD_COURSE', courseId: 'ANNUAL', semesterId: 'year_3_semester_a', alsoSemesterIds: ['year_3_semester_b'],
    } as any);
    expect(next).toBeNull();
    // Structurally impossible mutations must not partially mutate — confirm no state was touched.
    expect(state.semesters['year_3_semester_a']).toEqual([]);
  });
});

describe('isMovable — annual courses are never movable or replaceable', () => {
  it('returns false for an is_annual course even when its placement_policy is not "fixed"', () => {
    const spans = ['year_3_semester_a', 'year_3_semester_b'];
    const profiles = new Map<string, CourseProfile>();
    profiles.set('ANNUAL', annualProfile('ANNUAL', spans));
    const model = baseModel({ profiles });

    expect(isMovable(model, 'ANNUAL')).toBe(false);
  });

  it('enumerateActions never proposes a MOVE_COURSE or REPLACE_COURSE for an already-placed annual course', () => {
    const spans = ['year_3_semester_a', 'year_3_semester_b'];
    const profiles = new Map<string, CourseProfile>();
    profiles.set('ANNUAL', annualProfile('ANNUAL', spans));
    profiles.set('ELECTIVE', profile('ELECTIVE', { is_wanted: true }));
    const model = baseModel({ profiles, requiredMandatoryCourseIds: ['ANNUAL'] });
    const state = emptyState(SEMS);
    state.semesters['year_3_semester_a'] = ['ANNUAL'];
    state.semesters['year_3_semester_b'] = ['ANNUAL'];

    const actions = enumerateActions(state, model);
    expect(actions.some(a => (a.type === 'MOVE_COURSE' || a.type === 'REPLACE_COURSE') && (a as any).courseId === 'ANNUAL')).toBe(false);
    expect(actions.some(a => a.type === 'REPLACE_COURSE' && (a as any).outId === 'ANNUAL')).toBe(false);
  });
});

describe('PlannerWorker.addCourse — annual course (Codex P1: the production add_course tool path)', () => {
  it('places an annual course in every spanned semester atomically, even though the tool only takes one semesterId', () => {
    const spans = ['year_3_semester_a', 'year_3_semester_b'];
    const profiles = new Map<string, CourseProfile>();
    profiles.set('ANNUAL', annualProfile('ANNUAL', spans));
    const model = baseModel({ profiles, requiredMandatoryCourseIds: ['ANNUAL'] });
    const worker = new PlannerWorker(model);

    // Simulates the LlmOrchestrator calling the add_course AI-SDK tool
    // directly (planner_tools.ts), which only ever passes one semesterId.
    const result = worker.addCourse('ANNUAL', 'year_3_semester_a', 'llm');

    expect(result.accepted).toBe(true);
    expect(worker.getPlan().semesters['year_3_semester_a']).toContain('ANNUAL');
    expect(worker.getPlan().semesters['year_3_semester_b']).toContain('ANNUAL');
  });

  it('places an annual course in every spanned semester when no semesterId is given at all', () => {
    const spans = ['year_3_semester_a', 'year_3_semester_b'];
    const profiles = new Map<string, CourseProfile>();
    profiles.set('ANNUAL', annualProfile('ANNUAL', spans));
    const model = baseModel({ profiles, requiredMandatoryCourseIds: ['ANNUAL'] });
    const worker = new PlannerWorker(model);

    const result = worker.addCourse('ANNUAL', undefined, 'llm');

    expect(result.accepted).toBe(true);
    expect(worker.getPlan().semesters['year_3_semester_a']).toContain('ANNUAL');
    expect(worker.getPlan().semesters['year_3_semester_b']).toContain('ANNUAL');
  });

  it('rejects an attempt to move an already-placed annual course out of one of its spanned semesters (validation catches the split)', () => {
    const spans = ['year_3_semester_a', 'year_3_semester_b'];
    const profiles = new Map<string, CourseProfile>();
    profiles.set('ANNUAL', annualProfile('ANNUAL', spans));
    const model = baseModel({ profiles, requiredMandatoryCourseIds: ['ANNUAL'] });
    const initial = emptyState(SEMS);
    initial.semesters['year_3_semester_a'] = ['ANNUAL'];
    initial.semesters['year_3_semester_b'] = ['ANNUAL'];
    const worker = new PlannerWorker(model, initial);

    // A hypothetical direct move_course tool call is not blocked by isMovable
    // (that only gates the search's own candidate generation) — validation
    // itself must catch the resulting partial placement.
    const result = worker.moveCourse('ANNUAL', 'year_4_semester_a', 'llm');

    expect(result.accepted).toBe(false);
    expect(worker.getPlan().semesters['year_3_semester_a']).toContain('ANNUAL');
    expect(worker.getPlan().semesters['year_3_semester_b']).toContain('ANNUAL');
  });
});

describe('validatePlanProposal — annual course completeness (Codex P2)', () => {
  function ctxFor(spans: string[]): PlanValidationContext {
    return {
      completedCourseIds: new Set(),
      courses: {
        ANNUAL: { hours: 4, is_mandatory: true, is_annual: true, spans_semesters: spans },
      },
    };
  }

  it('flags an error when an annual course is placed in only one of its spans_semesters', () => {
    const spans = ['year_3_semester_a', 'year_3_semester_b'];
    const result = validatePlanProposal(
      {
        semesters: [
          { semester_id: 'year_3_semester_a', course_ids: ['ANNUAL'] },
          { semester_id: 'year_3_semester_b', course_ids: [] },
        ],
        moves: [],
        warnings_he: [],
        rationale_he: 'test',
        requirements_status: [],
      },
      ctxFor(spans),
    );
    expect(result.errors.some(e => e.includes('ANNUAL') || e.includes('שנתי'))).toBe(true);
  });

  it('does not flag an error when an annual course is correctly placed in both spans_semesters', () => {
    const spans = ['year_3_semester_a', 'year_3_semester_b'];
    const result = validatePlanProposal(
      {
        semesters: [
          { semester_id: 'year_3_semester_a', course_ids: ['ANNUAL'] },
          { semester_id: 'year_3_semester_b', course_ids: ['ANNUAL'] },
        ],
        moves: [],
        warnings_he: [],
        rationale_he: 'test',
        requirements_status: [],
      },
      ctxFor(spans),
    );
    expect(result.errors).toEqual([]);
  });

  it('Codex round 3: does not flag a pinned annual course placed in both its spans_semesters as an illegal move', () => {
    const spans = ['year_3_semester_a', 'year_3_semester_b'];
    const result = validatePlanProposal(
      {
        semesters: [
          { semester_id: 'year_3_semester_a', course_ids: ['ANNUAL'] },
          { semester_id: 'year_3_semester_b', course_ids: ['ANNUAL'] },
        ],
        moves: [],
        warnings_he: [],
        rationale_he: 'test',
        requirements_status: [],
      },
      {
        ...ctxFor(spans),
        pinnedCourseIds: new Set(['ANNUAL']),
        // buildPinnedHome (generate-plan.ts) only records the FIRST semester
        // it finds a pinned course already placed in — reproduce that here.
        currentSemesterByCourseId: { ANNUAL: 'year_3_semester_a' },
      },
    );
    expect(result.errors).toEqual([]);
  });

  it('Codex round 3: still flags a pinned NON-annual course actually moved to a different semester', () => {
    const result = validatePlanProposal(
      {
        semesters: [
          { semester_id: 'year_3_semester_a', course_ids: [] },
          { semester_id: 'year_3_semester_b', course_ids: ['PINNED'] },
        ],
        moves: [],
        warnings_he: [],
        rationale_he: 'test',
        requirements_status: [],
      },
      {
        completedCourseIds: new Set(),
        courses: { PINNED: { hours: 4, is_mandatory: false } },
        pinnedCourseIds: new Set(['PINNED']),
        currentSemesterByCourseId: { PINNED: 'year_3_semester_a' },
      },
    );
    expect(result.errors.some(e => e.includes('PINNED'))).toBe(true);
  });
});

describe('isFullyPlaced / validatePlanProposal — annual course fallback when spans_semesters is missing (Codex round 4)', () => {
  const spans = ['year_3_semester_a', 'year_3_semester_b'];

  // An older/partial board record: is_annual is true but spans_semesters was
  // never populated — only effective_allowed_semesters (this year's actual
  // offering) is known, exactly the confident-legality case
  // addCourseActionsFor already falls back to via legalSemestersFor.
  function annualProfileNoSpans(id: string): CourseProfile {
    return profile(id, {
      is_mandatory: true,
      course_type: 'mandatory',
      placement_policy: 'flexible',
      effective_allowed_semesters: spans,
      hours: 4,
      is_annual: true,
      spans_semesters: undefined,
      count_hours_once: true,
      root_course_id: id,
    } as Partial<CourseProfile>);
  }

  it('isFullyPlaced falls back to the legal-semester set instead of treating a single placement as complete', () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('ANNUAL', annualProfileNoSpans('ANNUAL'));
    const model = baseModel({ profiles });
    const state = emptyState(SEMS);
    state.semesters['year_3_semester_a'] = ['ANNUAL'];
    const placed = new Set(['ANNUAL']);

    expect(isFullyPlaced(state, model, placed, 'ANNUAL')).toBe(false);

    state.semesters['year_3_semester_b'] = ['ANNUAL'];
    expect(isFullyPlaced(state, model, placed, 'ANNUAL')).toBe(true);
  });

  it('enumerateActions keeps proposing to complete a partially-placed annual course even when spans_semesters is missing', () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('ANNUAL', annualProfileNoSpans('ANNUAL'));
    const model = baseModel({ profiles, requiredMandatoryCourseIds: ['ANNUAL'] });
    const state = emptyState(SEMS);
    state.semesters['year_3_semester_a'] = ['ANNUAL'];

    const actions = enumerateActions(state, model).filter(a => a.type === 'ADD_COURSE' && (a as any).courseId === 'ANNUAL');
    expect(actions).toHaveLength(1);
    const action = actions[0] as any;
    expect([action.semesterId, ...(action.alsoSemesterIds ?? [])].sort()).toEqual([...spans].sort());
  });

  it('validatePlanProposal does not flag a duplicate for an atomic fallback placement across both effective_allowed_semesters', () => {
    const result = validatePlanProposal(
      {
        semesters: [
          { semester_id: 'year_3_semester_a', course_ids: ['ANNUAL'] },
          { semester_id: 'year_3_semester_b', course_ids: ['ANNUAL'] },
        ],
        moves: [],
        warnings_he: [],
        rationale_he: 'test',
        requirements_status: [],
      },
      {
        completedCourseIds: new Set(),
        courses: {
          ANNUAL: { hours: 4, is_mandatory: true, is_annual: true, spans_semesters: undefined, effective_allowed_semesters: spans },
        },
      },
    );
    expect(result.errors).toEqual([]);
  });

  it('validatePlanProposal still flags an incomplete fallback placement as missing the other effective semester', () => {
    const result = validatePlanProposal(
      {
        semesters: [
          { semester_id: 'year_3_semester_a', course_ids: ['ANNUAL'] },
          { semester_id: 'year_3_semester_b', course_ids: [] },
        ],
        moves: [],
        warnings_he: [],
        rationale_he: 'test',
        requirements_status: [],
      },
      {
        completedCourseIds: new Set(),
        courses: {
          ANNUAL: { hours: 4, is_mandatory: true, is_annual: true, spans_semesters: undefined, effective_allowed_semesters: spans },
        },
      },
    );
    expect(result.errors.some(e => e.includes('ANNUAL') || e.includes('שנתי'))).toBe(true);
  });

  it('validatePlanProposal does not hard-block an is_annual course when even effective_allowed_semesters is unknown (stays silent rather than guessing)', () => {
    const result = validatePlanProposal(
      {
        semesters: [
          { semester_id: 'year_3_semester_a', course_ids: ['ANNUAL'] },
        ],
        moves: [],
        warnings_he: [],
        rationale_he: 'test',
        requirements_status: [],
      },
      {
        completedCourseIds: new Set(),
        courses: {
          ANNUAL: { hours: 4, is_mandatory: true, is_annual: true, spans_semesters: null },
        },
      },
    );
    expect(result.errors).toEqual([]);
  });
});

describe('addCourseActionsFor / isFullyPlaced — annual course with no confident legal-semester data at all (Codex round 5)', () => {
  // A bare is_annual flag with nothing else — no spans_semesters, no
  // effective/program/offered semester data, so getLegalSemesters can only
  // return its unconfident knownSemesterIds fallback. Bundling this into one
  // atomic action spanning EVERY known semester (4 in this fixture, could be
  // 8+ on a real board) would silently overload/misrepresent the plan —
  // there is no confident basis for how many semesters this course spans.
  function annualProfileUnknownSpans(id: string): CourseProfile {
    return profile(id, {
      is_mandatory: true,
      course_type: 'elective',
      placement_policy: 'elective',
      hours: 4,
      is_annual: true,
      spans_semesters: undefined,
      count_hours_once: true,
      root_course_id: id,
    } as Partial<CourseProfile>);
  }

  it('addCourseActionsFor falls through to one action per known semester instead of bundling into every semester', () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('ANNUAL', annualProfileUnknownSpans('ANNUAL'));
    const model = baseModel({ profiles });

    const actions = addCourseActionsFor(model, 'ANNUAL');

    expect(actions).toHaveLength(SEMS.length);
    expect(actions.every((a: any) => a.type === 'ADD_COURSE' && !a.alsoSemesterIds)).toBe(true);
    expect(actions.map((a: any) => a.semesterId).sort()).toEqual([...SEMS].sort());
  });

  it('isFullyPlaced treats a single placement as complete when no confident legal data exists at all', () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('ANNUAL', annualProfileUnknownSpans('ANNUAL'));
    const model = baseModel({ profiles });
    const state = emptyState(SEMS);
    state.semesters['year_3_semester_a'] = ['ANNUAL'];
    const placed = new Set(['ANNUAL']);

    expect(isFullyPlaced(state, model, placed, 'ANNUAL')).toBe(true);
  });
});

describe('PlannerWorker.addCourse — unbundled annual fallback honors requested/best semester (Codex round 6)', () => {
  function annualProfileUnknownSpans(id: string): CourseProfile {
    return profile(id, {
      is_mandatory: true,
      course_type: 'elective',
      placement_policy: 'elective',
      hours: 4,
      is_annual: true,
      spans_semesters: undefined,
      count_hours_once: true,
      root_course_id: id,
    } as Partial<CourseProfile>);
  }

  it('honors an explicitly requested legal semester instead of always taking the first candidate', () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('ANNUAL', annualProfileUnknownSpans('ANNUAL'));
    const model = baseModel({ profiles });
    const worker = new PlannerWorker(model);

    const result = worker.addCourse('ANNUAL', 'year_4_semester_b', 'llm');

    expect(result.accepted).toBe(true);
    expect(worker.getPlan().semesters['year_4_semester_b']).toContain('ANNUAL');
    expect(worker.getPlan().semesters['year_3_semester_a']).not.toContain('ANNUAL');
  });

  it('falls back to the lowest-load legal semester (like bestLegalSemester) when no semesterId is given', () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('ANNUAL', annualProfileUnknownSpans('ANNUAL'));
    profiles.set('FILLER', profile('FILLER', { hours: 8 }));
    const model = baseModel({ profiles });
    const initial = emptyState(SEMS);
    initial.semesters['year_3_semester_a'] = ['FILLER']; // makes this semester heavier than the others
    const worker = new PlannerWorker(model, initial);

    const result = worker.addCourse('ANNUAL', undefined, 'llm');

    expect(result.accepted).toBe(true);
    expect(worker.getPlan().semesters['year_3_semester_a']).not.toContain('ANNUAL');
  });
});

describe('enumerateActions — partial annual elective repair independent of degree-hour fill (Codex round 7)', () => {
  it('proposes completing a partially-placed annual ELECTIVE even when degree hours already meet the target', () => {
    const spans = ['year_3_semester_a', 'year_3_semester_b'];
    const profiles = new Map<string, CourseProfile>();
    // Not mandatory, not in a category, not wanted — the only classification
    // that would otherwise reach this course is group 4 (degree-hour fill),
    // which is gated off here by an already-met hour target. placedHours
    // already counts this course's placed half at full weight, so that gate
    // can never re-open once crossed — without a repair path independent of
    // it, this course would be stuck half-placed forever.
    profiles.set('ANNUAL', annualProfile('ANNUAL', spans, { is_mandatory: false, course_type: 'elective', is_wanted: false }));
    const model = baseModel({ profiles, degreeRequiredHours: 1, priorHours: 100 });
    const state = emptyState(SEMS);
    state.semesters['year_3_semester_a'] = ['ANNUAL']; // placed in only one of its two spans

    const actions = enumerateActions(state, model).filter(a => a.type === 'ADD_COURSE' && (a as any).courseId === 'ANNUAL');

    expect(actions).toHaveLength(1);
    const action = actions[0] as any;
    expect([action.semesterId, ...(action.alsoSemesterIds ?? [])].sort()).toEqual([...spans].sort());
  });
});

describe('PlannerWorker.run — completes a partially-placed annual elective already present in the initial state (Codex round 8)', () => {
  it('does not stop immediately when an annual elective is only half-placed, even though degree/mandatory/category goals are otherwise already satisfied', () => {
    const spans = ['year_3_semester_a', 'year_3_semester_b'];
    const profiles = new Map<string, CourseProfile>();
    profiles.set('ANNUAL', annualProfile('ANNUAL', spans, { is_mandatory: false, course_type: 'elective', is_wanted: false }));
    // No mandatory courses, no categories, and degree hours already far over
    // target — every OTHER isGoalReached() condition is trivially satisfied
    // from the very first step(), which is exactly what let the worker call
    // recordStop() before enumerateActions/addCourse ever got a chance to
    // repair the split annual course.
    const model = baseModel({ profiles, degreeRequiredHours: 1, priorHours: 100 });
    const initial = emptyState(SEMS);
    initial.semesters['year_3_semester_a'] = ['ANNUAL']; // half-placed from the start, not via a search step

    const worker = new PlannerWorker(model, initial);
    worker.run();

    expect(worker.getPlan().semesters['year_3_semester_a']).toContain('ANNUAL');
    expect(worker.getPlan().semesters['year_3_semester_b']).toContain('ANNUAL');
    expect(worker.validate().valid).toBe(true);
  });
});
