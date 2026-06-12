import {
  buildCompletionAnalysis,
  formatCompletionMessages,
  evaluatePlanCompleteness,
  scoreCandidate,
  pickBestCandidate,
  repairAddMissingElectives,
  repairPlanLoad,
  getMissingRequirementCards,
  getCategoryStatusReport,
  pickPrimaryBlockingReason,
  isPlanApplyable,
  buildPreviewChangeBullets,
  DEGREE_REQUIRED_HOURS,
  DEFAULT_MAX_HOURS_PER_SEMESTER,
  SEVERE_OVERLOAD_MARGIN,
} from '../../api/ai/completion_analysis';
import type { PlanContext } from '../../api/ai/_context';

function baseCtx(overrides: any = {}): any {
  return {
    semesters: [],
    personal_status: { completed: [] },
    mandatory_unplaced: [],
    ...overrides,
  };
}

describe('buildCompletionAnalysis', () => {
  it('computes hours, missing mandatory, categories, overload, movable, pinned', () => {
    const ctx = baseCtx({
      semesters: [
        { id: 's1', label: 'סמסטר א', total_hours: 22, courses: [{ course_id: 'A', hours: 4 }, { course_id: 'B', hours: 18 }] },
      ],
      personal_status: { completed: [{ course_id: 'C', hours: 3 }] },
      mandatory_unplaced: [{ course_id: 'M1', name_he: 'חובה', hours: 3 }],
      category_requirements: [
        { name: 'בחירה', required: 2, placed: 0, candidates: [{ course_id: 'E1', name_he: 'בחירה1', hours: 3, has_syllabus_summary: true, grade_average: 90, is_wanted: true }, { course_id: 'A', hours: 4 }] },
      ],
      total_hours_progress: { known_completed_hours: 3 },
      movable_courses: [{ course_id: 'B', current_semester: 's1' }],
      pinned_course_ids: ['A'],
    });

    const a = buildCompletionAnalysis(ctx);

    expect(a.completed_course_ids).toEqual(['C']);
    expect(a.scheduled_course_ids).toEqual(['A', 'B']);
    expect(a.missing_mandatory).toEqual([{ course_id: 'M1', name_he: 'חובה', hours: 3 }]);

    // category candidate 'A' is already scheduled, so excluded
    expect(a.categories[0].candidates.map(c => c.course_id)).toEqual(['E1']);
    expect(a.categories[0].missing).toBe(2);

    expect(a.hours.known_completed_hours).toBe(3);
    expect(a.hours.known_scheduled_hours).toBe(22);
    expect(a.hours.known_total_hours).toBe(25);
    expect(a.hours.required_total).toBe(DEGREE_REQUIRED_HOURS);
    expect(a.hours.remaining_hours).toBe(DEGREE_REQUIRED_HOURS - 25);
    expect(a.hours.approximate).toBe(false);

    // semester over DEFAULT_MAX_HOURS_PER_SEMESTER
    expect(a.overloaded_semesters).toEqual([{ semester_id: 's1', label: 'סמסטר א', total_hours: 22 }]);

    // movable courses excludes pinned (B is not pinned, A is)
    expect(a.movable_courses).toEqual([{ course_id: 'B', current_semester: 's1' }]);

    expect(a.pinned_course_ids).toEqual(['A']);
  });

  it('carries category_id through from category_requirements', () => {
    const ctx = baseCtx({
      category_requirements: [
        { name: 'קורסי ליבה — זורמים', category_id: 'fluids', required: 1, placed: 0, candidates: [{ course_id: 'F1', name_he: 'זרימה', hours: 3 }] },
      ],
    });
    const a = buildCompletionAnalysis(ctx);
    expect(a.categories[0].category_id).toBe('fluids');
    expect(a.categories[0].missing).toBe(1);
  });

  it('marks hours approximate when courses have unknown hours', () => {
    const ctx = baseCtx({
      semesters: [{ id: 's1', label: 'ס1', total_hours: 4, courses: [{ course_id: 'A', hours: null }] }],
      personal_status: { completed: [{ course_id: 'C', hours: null }] },
    });
    const a = buildCompletionAnalysis(ctx);
    expect(a.hours.unknown_hour_courses).toBe(2);
    expect(a.hours.approximate).toBe(true);
  });
});

describe('formatCompletionMessages', () => {
  it('renders Hebrew lines for all sections', () => {
    const a = {
      completed_course_ids: [],
      scheduled_course_ids: [],
      missing_mandatory: [{ course_id: 'M1', name_he: 'חובה', hours: 3 }],
      categories: [{ name: 'בחירה', required: 2, placed: 0, missing: 1, candidates: [{ course_id: 'E1', name_he: 'אלקטיב', hours: 3 }] }],
      hours: { required_total: 185, known_completed_hours: 0, known_scheduled_hours: 0, known_total_hours: 0, remaining_hours: 185, unknown_hour_courses: 1, approximate: true },
      overloaded_semesters: [{ semester_id: 's1', label: 'סמסטר א', total_hours: 22 }],
      movable_courses: [{ course_id: 'B', name_he: 'קורס ב', current_semester: 's1' }],
      pinned_course_ids: ['P1'],
    };
    const lines = formatCompletionMessages(a as any);
    expect(lines.some(l => l.includes('חובה'))).toBe(true);
    expect(lines.some(l => l.includes('בחירה'))).toBe(true);
    expect(lines.some(l => l.includes('משוערת'))).toBe(true);
    expect(lines.some(l => l.includes('עמוסים מדי'))).toBe(true);
    expect(lines.some(l => l.includes('קורס ב'))).toBe(true);
    expect(lines.some(l => l.includes('P1'))).toBe(true);
  });

  it('handles fully-satisfied case with non-approximate hours', () => {
    const a = {
      completed_course_ids: [],
      scheduled_course_ids: [],
      missing_mandatory: [],
      categories: [{ name: 'בחירה', required: 1, placed: 1, missing: 0, candidates: [] }],
      hours: { required_total: 185, known_completed_hours: 185, known_scheduled_hours: 0, known_total_hours: 185, remaining_hours: 0, unknown_hour_courses: 0, approximate: false },
      overloaded_semesters: [],
      movable_courses: [],
      pinned_course_ids: [],
    };
    const lines = formatCompletionMessages(a as any);
    expect(lines.some(l => l.includes('כל קורסי החובה'))).toBe(true);
    expect(lines.some(l => l.includes('כל דרישות קטגוריות הבחירה'))).toBe(true);
    expect(lines.some(l => l.includes('נותרו 0 ש"ש'))).toBe(true);
  });
});

describe('evaluatePlanCompleteness', () => {
  const baseAnalysis = {
    completed_course_ids: [],
    scheduled_course_ids: [],
    missing_mandatory: [],
    categories: [],
    hours: { required_total: 185, known_completed_hours: 0, known_scheduled_hours: 0, known_total_hours: 0, remaining_hours: 0, unknown_hour_courses: 0, approximate: false },
    overloaded_semesters: [],
    movable_courses: [],
    pinned_course_ids: [],
  };

  it('flags missing mandatory courses not placed', () => {
    const analysis = { ...baseAnalysis, missing_mandatory: [{ course_id: 'M1', name_he: 'חובה1' }] };
    const result = evaluatePlanCompleteness([{ semester_id: 's1', course_ids: [] }], analysis as any);
    expect(result.incomplete).toBe(true);
    expect(result.reasons[0]).toContain('חובה1');
  });

  it('flags unmet elective categories with available candidates', () => {
    const analysis = {
      ...baseAnalysis,
      categories: [{ name: 'בחירה', required: 1, placed: 0, missing: 1, candidates: [{ course_id: 'E1', name_he: 'אלקטיב' }] }],
    };
    const result = evaluatePlanCompleteness([{ semester_id: 's1', course_ids: [] }], analysis as any);
    expect(result.incomplete).toBe(true);
    expect(result.reasons.some(r => r.includes('בחירה'))).toBe(true);
  });

  it('does not report a redundant "הדרישה הושלמה" line when a category is satisfied', () => {
    const analysis = {
      ...baseAnalysis,
      categories: [{ name: 'בחירה', required: 1, placed: 0, missing: 1, candidates: [{ course_id: 'E1', name_he: 'אלקטיב' }] }],
    };
    const result = evaluatePlanCompleteness([{ semester_id: 's1', course_ids: ['E1'] }], analysis as any);
    expect(result.reasons.some(r => r.includes('הדרישה הושלמה'))).toBe(false);
    expect(result.incomplete).toBe(false);
  });

  it('flags remaining degree hours when no electives were added', () => {
    const analysis = { ...baseAnalysis, hours: { ...baseAnalysis.hours, remaining_hours: 20 } };
    const result = evaluatePlanCompleteness([{ semester_id: 's1', course_ids: [] }], analysis as any, { courseHours: {} });
    expect(result.incomplete).toBe(true);
    expect(result.reasons.some(r => r.includes('שעות'))).toBe(true);
  });

  it('does not flag remaining hours when electives were added', () => {
    const analysis = { ...baseAnalysis, hours: { ...baseAnalysis.hours, remaining_hours: 20 } };
    const result = evaluatePlanCompleteness([{ semester_id: 's1', course_ids: ['E1'] }], analysis as any, { courseHours: { E1: 3 } });
    expect(result.reasons.some(r => r.includes('שעות'))).toBe(false);
  });

  it('flags severe overload when movable courses remain in an overloaded semester', () => {
    const analysis = { ...baseAnalysis, movable_courses: [] };
    const courseHours = { A: 12, B: 12 };
    const result = evaluatePlanCompleteness(
      [{ semester_id: 's1', course_ids: ['A', 'B'] }],
      analysis as any,
      { courseHours, movableCourseIds: new Set(['B']) },
    );
    expect(result.incomplete).toBe(true);
    expect(result.reasons.some(r => r.includes('עמוס מדי'))).toBe(true);
  });

  it('counts added_electives, excluding wanted/scheduled/completed/mandatory', () => {
    const analysis = {
      ...baseAnalysis,
      scheduled_course_ids: ['SCHED1'],
      completed_course_ids: ['DONE1'],
      missing_mandatory: [{ course_id: 'M1', name_he: 'חובה1' }],
    };
    const result = evaluatePlanCompleteness(
      [{ semester_id: 's1', course_ids: ['SCHED1', 'DONE1', 'M1', 'WANTED1', 'EXTRA1'] }],
      analysis as any,
      { wantedCourseIds: ['WANTED1'] },
    );
    expect(result.added_electives).toBe(1);
  });

  it('returns incomplete=false with no reasons when everything is satisfied', () => {
    const result = evaluatePlanCompleteness([{ semester_id: 's1', course_ids: [] }], baseAnalysis as any);
    expect(result.incomplete).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it('reports "no candidate available" informationally without blocking apply', () => {
    const analysis = {
      ...baseAnalysis,
      categories: [{ name: 'מעבדות מתקדמות', category_id: 'advanced_labs', required: 1, placed: 0, missing: 1, candidates: [] }],
    };
    const result = evaluatePlanCompleteness([{ semester_id: 's1', course_ids: [] }], analysis as any);
    expect(result.reasons.some(r => r.includes('אין קורס מועמד זמין בקטגוריה "מעבדות מתקדמות"'))).toBe(true);
    expect(result.incomplete).toBe(false);
  });
});

describe('scoreCandidate / pickBestCandidate', () => {
  it('scores candidates with wanted, syllabus, hours, and grade bonuses', () => {
    const c1 = { course_id: 'A', is_wanted: true, has_syllabus_summary: true, hours: 3, grade_average: 90 };
    const c2 = { course_id: 'B' };
    expect(scoreCandidate(c1)).toBeGreaterThan(scoreCandidate(c2));
  });

  it('picks the highest-scoring candidate', () => {
    const candidates = [
      { course_id: 'A' },
      { course_id: 'B', is_wanted: true, has_syllabus_summary: true, hours: 3, grade_average: 95 },
    ];
    expect(pickBestCandidate(candidates)?.course_id).toBe('B');
  });

  it('prefers candidates not in unwantedIds when alternatives exist', () => {
    const candidates = [
      { course_id: 'A', is_wanted: true, has_syllabus_summary: true, hours: 3, grade_average: 95 },
      { course_id: 'B' },
    ];
    expect(pickBestCandidate(candidates, new Set(['A']))?.course_id).toBe('B');
  });

  it('falls back to unwanted candidates when no alternative exists', () => {
    const candidates = [{ course_id: 'A' }];
    expect(pickBestCandidate(candidates, new Set(['A']))?.course_id).toBe('A');
  });

  it('returns null for empty candidates', () => {
    expect(pickBestCandidate([])).toBeNull();
  });
});

describe('repairAddMissingElectives', () => {
  const knownSemesterIds = ['s1', 's2'];
  const courses = {
    E1: { hours: 3, effective_allowed_semesters: ['s1', 's2'] },
    E2: { hours: 4, effective_allowed_semesters: ['s2'] },
  };

  it('returns proposal unchanged when no categories are missing', () => {
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }] };
    const analysis = {
      completed_course_ids: [], scheduled_course_ids: [], missing_mandatory: [],
      categories: [{ name: 'בחירה', required: 1, placed: 1, missing: 0, candidates: [] }],
      hours: { required_total: 185, known_completed_hours: 0, known_scheduled_hours: 0, known_total_hours: 0, remaining_hours: 0, unknown_hour_courses: 0, approximate: false },
      overloaded_semesters: [], movable_courses: [], pinned_course_ids: [],
    };
    const result = repairAddMissingElectives(proposal as any, analysis as any, { courses, knownSemesterIds });
    expect(result.added).toEqual([]);
    expect(result.proposal).toBe(proposal);
  });

  it('inserts the best candidate into the least-loaded legal semester', () => {
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }, { semester_id: 's2', course_ids: [] }] };
    const analysis = {
      completed_course_ids: [], scheduled_course_ids: [], missing_mandatory: [],
      categories: [{ name: 'בחירה', required: 1, placed: 0, missing: 1, candidates: [{ course_id: 'E1', hours: 3, is_wanted: true }] }],
      hours: { required_total: 185, known_completed_hours: 0, known_scheduled_hours: 0, known_total_hours: 0, remaining_hours: 0, unknown_hour_courses: 0, approximate: false },
      overloaded_semesters: [], movable_courses: [], pinned_course_ids: [],
    };
    const result = repairAddMissingElectives(proposal as any, analysis as any, { courses, knownSemesterIds });
    expect(result.added).toEqual([{ course_id: 'E1', category: 'בחירה', semester_id: 's1' }]);
    expect(result.proposal.semesters.find((s: any) => s.semester_id === 's1')!.course_ids).toContain('E1');
    expect(result.proposal.warnings_he).toEqual(['נוספו קורסי בחירה אוטומטית כדי להשלים דרישות תואר.']);
  });

  it('respects effective_allowed_semesters when picking a target semester', () => {
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }, { semester_id: 's2', course_ids: [] }] };
    const analysis = {
      completed_course_ids: [], scheduled_course_ids: [], missing_mandatory: [],
      categories: [{ name: 'בחירה', required: 1, placed: 0, missing: 1, candidates: [{ course_id: 'E2', hours: 4 }] }],
      hours: { required_total: 185, known_completed_hours: 0, known_scheduled_hours: 0, known_total_hours: 0, remaining_hours: 0, unknown_hour_courses: 0, approximate: false },
      overloaded_semesters: [], movable_courses: [], pinned_course_ids: [],
    };
    const result = repairAddMissingElectives(proposal as any, analysis as any, { courses, knownSemesterIds });
    expect(result.added[0].semester_id).toBe('s2');
  });

  it('fills all four mechanical-engineering core categories when candidates exist', () => {
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }, { semester_id: 's2', course_ids: [] }] };
    const allCourses = {
      F1: { hours: 3, effective_allowed_semesters: ['s1', 's2'] },
      S1: { hours: 3, effective_allowed_semesters: ['s1', 's2'] },
      Y1: { hours: 3, effective_allowed_semesters: ['s1', 's2'] },
      L1: { hours: 2, effective_allowed_semesters: ['s1', 's2'] },
    };
    const analysis = {
      completed_course_ids: [], scheduled_course_ids: [], missing_mandatory: [],
      categories: [
        { name: 'קורסי ליבה — זורמים', category_id: 'fluids', required: 1, placed: 0, missing: 1, candidates: [{ course_id: 'F1', hours: 3 }] },
        { name: 'קורסי ליבה — מוצקים', category_id: 'solids', required: 1, placed: 0, missing: 1, candidates: [{ course_id: 'S1', hours: 3 }] },
        { name: 'קורסי ליבה — מערכות', category_id: 'systems', required: 1, placed: 0, missing: 1, candidates: [{ course_id: 'Y1', hours: 3 }] },
        { name: 'מעבדות מתקדמות', category_id: 'advanced_labs', required: 1, placed: 0, missing: 1, candidates: [{ course_id: 'L1', hours: 2 }] },
      ],
      hours: { required_total: 185, known_completed_hours: 0, known_scheduled_hours: 0, known_total_hours: 0, remaining_hours: 0, unknown_hour_courses: 0, approximate: false },
      overloaded_semesters: [], movable_courses: [], pinned_course_ids: [],
    };
    const result = repairAddMissingElectives(proposal as any, analysis as any, { courses: allCourses, knownSemesterIds: ['s1', 's2'] });
    expect(result.added.map(a => a.course_id).sort()).toEqual(['F1', 'L1', 'S1', 'Y1']);
  });

  it('allows a candidate with unknown hours and treats it as 0 for load purposes', () => {
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }] };
    const courses = { U1: { hours: null, effective_allowed_semesters: ['s1'] } };
    const analysis = {
      completed_course_ids: [], scheduled_course_ids: [], missing_mandatory: [],
      categories: [{ name: 'בחירה', category_id: 'other_specialization', required: 1, placed: 0, missing: 1, candidates: [{ course_id: 'U1', hours: null }] }],
      hours: { required_total: 185, known_completed_hours: 0, known_scheduled_hours: 0, known_total_hours: 0, remaining_hours: 0, unknown_hour_courses: 0, approximate: false },
      overloaded_semesters: [], movable_courses: [], pinned_course_ids: [],
    };
    const result = repairAddMissingElectives(proposal as any, analysis as any, { courses, knownSemesterIds: ['s1'] });
    expect(result.added).toEqual([{ course_id: 'U1', category: 'בחירה', semester_id: 's1' }]);
  });

  it('does not add a candidate already placed in the proposal', () => {
    const proposal = { semesters: [{ semester_id: 's1', course_ids: ['E1'] }] };
    const analysis = {
      completed_course_ids: [], scheduled_course_ids: [], missing_mandatory: [],
      categories: [{ name: 'בחירה', required: 1, placed: 0, missing: 1, candidates: [{ course_id: 'E1', hours: 3 }] }],
      hours: { required_total: 185, known_completed_hours: 0, known_scheduled_hours: 0, known_total_hours: 0, remaining_hours: 0, unknown_hour_courses: 0, approximate: false },
      overloaded_semesters: [], movable_courses: [], pinned_course_ids: [],
    };
    const result = repairAddMissingElectives(proposal as any, analysis as any, { courses, knownSemesterIds });
    expect(result.added).toEqual([]);
  });
});

describe('repairPlanLoad', () => {
  const allSems = ['s1', 's2', 's3'];

  it('moves an elective out of a 27h semester into an underloaded one', () => {
    const proposal = {
      semesters: [
        { semester_id: 's1', course_ids: ['M1', 'M2', 'E1'] }, // mandatory 12+12, elective 3 = 27
        { semester_id: 's2', course_ids: [] },
      ],
    };
    const courses = {
      M1: { hours: 12, placement_policy: 'fixed', course_type: 'mandatory' },
      M2: { hours: 12, placement_policy: 'fixed', course_type: 'mandatory' },
      E1: { hours: 3, course_type: 'elective', effective_allowed_semesters: ['s1', 's2'] },
    };
    const result = repairPlanLoad(proposal as any, { courses, maxHoursPerSemester: 20 });
    expect(result.repaired).toBe(true);
    expect(result.proposal.semesters.find((s: any) => s.semester_id === 's2')!.course_ids).toContain('E1');
    expect(result.proposal.semesters.find((s: any) => s.semester_id === 's1')!.course_ids).not.toContain('E1');
  });

  it('prefers moving an elective before a flexible mandatory course', () => {
    const proposal = {
      semesters: [
        { semester_id: 's1', course_ids: ['MF', 'E1'] }, // flexible mandatory 18 + elective 3 = 21
        { semester_id: 's2', course_ids: [] },
      ],
    };
    const courses = {
      MF: { hours: 18, course_type: 'mandatory', placement_policy: 'flexible', effective_allowed_semesters: ['s1', 's2'] },
      E1: { hours: 3, course_type: 'elective', effective_allowed_semesters: ['s1', 's2'] },
    };
    const result = repairPlanLoad(proposal as any, { courses, maxHoursPerSemester: 20 });
    expect(result.proposal.semesters.find((s: any) => s.semester_id === 's2')!.course_ids).toEqual(['E1']);
  });

  it('does not move a pinned elective', () => {
    const proposal = {
      semesters: [
        { semester_id: 's1', course_ids: ['E1'] },
        { semester_id: 's2', course_ids: [] },
      ],
    };
    const courses = { E1: { hours: 25, course_type: 'elective', effective_allowed_semesters: ['s1', 's2'] } };
    const result = repairPlanLoad(proposal as any, {
      courses, maxHoursPerSemester: 20, pinnedCourseIds: new Set(['E1']),
    });
    expect(result.repaired).toBe(false);
    expect(result.unmovedOverloaded[0].not_movable).toContain('E1');
  });

  it('does not move a completed elective', () => {
    const proposal = {
      semesters: [
        { semester_id: 's1', course_ids: ['E1'] },
        { semester_id: 's2', course_ids: [] },
      ],
    };
    const courses = { E1: { hours: 25, course_type: 'elective', effective_allowed_semesters: ['s1', 's2'] } };
    const result = repairPlanLoad(proposal as any, {
      courses, maxHoursPerSemester: 20, completedCourseIds: new Set(['E1']),
    });
    expect(result.repaired).toBe(false);
    expect(result.unmovedOverloaded[0].not_movable).toContain('E1');
  });

  it('reports unmoved overload with the movable courses that remain (no legal target)', () => {
    const proposal = {
      semesters: [
        { semester_id: 's1', course_ids: ['E1'] },
        { semester_id: 's2', course_ids: ['F1', 'F2'] },
      ],
    };
    // E1 only allowed in s1 (its current semester) -> no legal target
    const courses = {
      E1: { hours: 25, course_type: 'elective', effective_allowed_semesters: ['s1'] },
      F1: { hours: 18, placement_policy: 'fixed' },
      F2: { hours: 18, placement_policy: 'fixed' },
    };
    const result = repairPlanLoad(proposal as any, { courses, maxHoursPerSemester: 20 });
    expect(result.repaired).toBe(false);
    const s1Report = result.unmovedOverloaded.find(o => o.semester_id === 's1')!;
    expect(s1Report.movable).toEqual(['E1']);
    expect(s1Report.not_movable).toEqual([]);
  });

  it('allows an elective without effective_allowed_semesters to move to any known semester', () => {
    const proposal = {
      semesters: [
        { semester_id: 's1', course_ids: ['E1', 'E2'] },
        { semester_id: 's2', course_ids: [] },
        { semester_id: 's3', course_ids: [] },
      ],
    };
    const courses = {
      E1: { hours: 12, course_type: 'elective' }, // no effective_allowed_semesters
      E2: { hours: 12, course_type: 'elective' },
    };
    const result = repairPlanLoad(proposal as any, { courses, maxHoursPerSemester: 20 });
    expect(result.repaired).toBe(true);
    const s1 = result.proposal.semesters.find((s: any) => s.semester_id === 's1')!;
    expect(s1.course_ids.length).toBe(1);
  });
});

describe('PART B integration: severe overload + completeness', () => {
  const baseAnalysis = {
    completed_course_ids: [], scheduled_course_ids: [], missing_mandatory: [],
    categories: [],
    hours: { required_total: 185, known_completed_hours: 0, known_scheduled_hours: 0, known_total_hours: 0, remaining_hours: 0, unknown_hour_courses: 0, approximate: false },
    overloaded_semesters: [], movable_courses: [], pinned_course_ids: [],
  };

  it('blocks Apply when severe overload remains and movable courses exist', () => {
    const proposalSemesters = [{ semester_id: 's1', course_ids: ['E1', 'F1'] }];
    const courseHours = { E1: 9, F1: 18 }; // 27 total, max 20, margin 3 -> severe
    const result = evaluatePlanCompleteness(proposalSemesters, baseAnalysis as any, {
      courseHours,
      movableCourseIds: new Set(['E1']),
    });
    expect(result.incomplete).toBe(true);
    expect(result.reasons.some(r => r.includes('עמוס מדי'))).toBe(true);
  });

  it('does not block when overload remains but no movable courses exist', () => {
    const proposalSemesters = [{ semester_id: 's1', course_ids: ['F1', 'F2'] }];
    const courseHours = { F1: 18, F2: 9 }; // 27 total, max 20, no movable
    const result = evaluatePlanCompleteness(proposalSemesters, baseAnalysis as any, {
      courseHours,
      movableCourseIds: new Set(),
    });
    expect(result.incomplete).toBe(false);
  });

  it('18 ש"ש with a max of 20 is not flagged as overload at all', () => {
    const proposalSemesters = [{ semester_id: 's1', course_ids: ['F1'] }];
    const courseHours = { F1: 18 };
    const result = evaluatePlanCompleteness(proposalSemesters, baseAnalysis as any, {
      courseHours,
      movableCourseIds: new Set(['F1']),
    });
    expect(result.incomplete).toBe(false);
    expect(result.reasons.some(r => r.includes('עמוס'))).toBe(false);
    expect(18).toBeLessThanOrEqual(DEFAULT_MAX_HOURS_PER_SEMESTER + SEVERE_OVERLOAD_MARGIN);
  });
});

describe('getMissingRequirementCards', () => {
  const baseAnalysis = {
    completed_course_ids: [], scheduled_course_ids: [], missing_mandatory: [],
    hours: { required_total: 185, known_completed_hours: 0, known_scheduled_hours: 0, known_total_hours: 0, remaining_hours: 0, unknown_hour_courses: 0, approximate: false },
    overloaded_semesters: [], movable_courses: [], pinned_course_ids: [],
  };

  it('exposes recommended candidates for a missing requirement', () => {
    const analysis = {
      ...baseAnalysis,
      categories: [{
        name: 'קורסי ליבה — זורמים', category_id: 'fluids', required: 1, placed: 0, missing: 1,
        candidates: [
          { course_id: 'F1', name_he: 'מכניקת זורמים', hours: 3 },
          { course_id: 'F2', name_he: 'זרימה מתקדמת', hours: 3, is_wanted: true },
        ],
      }],
    };
    const cards = getMissingRequirementCards(analysis as any, new Set());
    expect(cards).toHaveLength(1);
    expect(cards[0].missing).toBe(1);
    // F2 scores higher (is_wanted), so it should be the top recommendation.
    expect(cards[0].candidates[0].course_id).toBe('F2');
  });

  it('reduces the missing count once a candidate is placed', () => {
    const analysis = {
      ...baseAnalysis,
      categories: [{
        name: 'מעבדות מתקדמות', category_id: 'advanced_labs', required: 1, placed: 0, missing: 1,
        candidates: [{ course_id: 'L1', name_he: 'מעבדה', hours: 2 }],
      }],
    };
    const before = getMissingRequirementCards(analysis as any, new Set());
    expect(before).toHaveLength(1);

    const after = getMissingRequirementCards(analysis as any, new Set(['L1']));
    expect(after).toHaveLength(0);
  });

  it('omits categories with no remaining shortfall', () => {
    const analysis = {
      ...baseAnalysis,
      categories: [{ name: 'בחירה', category_id: 'other', required: 1, placed: 1, missing: 0, candidates: [] }],
    };
    expect(getMissingRequirementCards(analysis as any, new Set())).toEqual([]);
  });
});

describe('getCategoryStatusReport', () => {
  const baseAnalysis = {
    completed_course_ids: [], scheduled_course_ids: [], missing_mandatory: [],
    hours: { required_total: 185, known_completed_hours: 0, known_scheduled_hours: 0, known_total_hours: 0, remaining_hours: 0, unknown_hour_courses: 0, approximate: false },
    overloaded_semesters: [], movable_courses: [], pinned_course_ids: [],
  };

  it('reports satisfied=true with the placed course id when a category is filled', () => {
    const analysis = {
      ...baseAnalysis,
      categories: [{
        name: 'קורסי ליבה — מוצקים', category_id: 'solids', required: 1, placed: 0, missing: 1,
        candidates: [{ course_id: 'S1', name_he: 'מוצקים מתקדם', hours: 3 }],
      }],
    };
    const report = getCategoryStatusReport(analysis as any, new Set(['S1']));
    expect(report).toEqual([{
      category_id: 'solids', name: 'קורסי ליבה — מוצקים', satisfied: true,
      placed_course_ids: ['S1'], missing: 0, candidates: [],
    }]);
  });

  it('reports satisfied=false with remaining candidates when a category is unfilled', () => {
    const analysis = {
      ...baseAnalysis,
      categories: [{
        name: 'מעבדות מתקדמות', category_id: 'advanced_labs', required: 1, placed: 0, missing: 1,
        candidates: [{ course_id: 'L1', name_he: 'מעבדה א', hours: 2 }],
      }],
    };
    const report = getCategoryStatusReport(analysis as any, new Set());
    expect(report[0].satisfied).toBe(false);
    expect(report[0].missing).toBe(1);
    expect(report[0].candidates.map(c => c.course_id)).toEqual(['L1']);
  });
});

describe('repairAddMissingElectives: required-category auto-fill respects wanted/unwanted', () => {
  const knownSemesterIds = ['s1', 's2'];

  it('prefers a wanted candidate but still fills the required category if unwanted', () => {
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }, { semester_id: 's2', course_ids: [] }] };
    const courses = {
      F1: { hours: 3, effective_allowed_semesters: ['s1', 's2'] },
      F2: { hours: 3, effective_allowed_semesters: ['s1', 's2'] },
    };
    const analysis = {
      completed_course_ids: [], scheduled_course_ids: [], missing_mandatory: [],
      categories: [{
        name: 'קורסי ליבה — זורמים', category_id: 'fluids', required: 1, placed: 0, missing: 1,
        candidates: [
          { course_id: 'F1', hours: 3, is_wanted: true },
          { course_id: 'F2', hours: 3 },
        ],
      }],
      hours: { required_total: 185, known_completed_hours: 0, known_scheduled_hours: 0, known_total_hours: 0, remaining_hours: 0, unknown_hour_courses: 0, approximate: false },
      overloaded_semesters: [], movable_courses: [], pinned_course_ids: [],
    };
    const result = repairAddMissingElectives(proposal as any, analysis as any, { courses, knownSemesterIds });
    expect(result.added.map(a => a.course_id)).toEqual(['F1']);
  });

  it('falls back to an avoided candidate to satisfy the required category when it is the only option', () => {
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }] };
    const courses = { L1: { hours: 2, effective_allowed_semesters: ['s1'] } };
    const analysis = {
      completed_course_ids: [], scheduled_course_ids: [], missing_mandatory: [],
      categories: [{
        name: 'מעבדות מתקדמות', category_id: 'advanced_labs', required: 1, placed: 0, missing: 1,
        candidates: [{ course_id: 'L1', hours: 2 }],
      }],
      hours: { required_total: 185, known_completed_hours: 0, known_scheduled_hours: 0, known_total_hours: 0, remaining_hours: 0, unknown_hour_courses: 0, approximate: false },
      overloaded_semesters: [], movable_courses: [], pinned_course_ids: [],
    };
    const result = repairAddMissingElectives(proposal as any, analysis as any, {
      courses, knownSemesterIds: ['s1'], unwantedCourseIds: ['L1'],
    });
    expect(result.added.map(a => a.course_id)).toEqual(['L1']);
  });
});

describe('isPlanApplyable', () => {
  it('is true when only warnings/info remain (no errors, not incomplete)', () => {
    const completeness = { incomplete: false, reasons: ['הדרישה הושלמה: קטגוריית "בחירה".'], added_electives: 1 };
    expect(isPlanApplyable([], completeness as any)).toBe(true);
  });

  it('is true with no completeness object at all and no errors', () => {
    expect(isPlanApplyable([], null)).toBe(true);
  });

  it('is false when validation errors exist, even if completeness is fine', () => {
    const completeness = { incomplete: false, reasons: [], added_electives: 0 };
    expect(isPlanApplyable(['קורס X מותר רק בסמסטר Y.'], completeness as any)).toBe(false);
  });

  it('is false when completeness reports blocking reasons', () => {
    const completeness = { incomplete: true, reasons: ['חסרים קורסי חובה: X.'], added_electives: 0 };
    expect(isPlanApplyable([], completeness as any)).toBe(false);
  });
});

describe('buildPreviewChangeBullets', () => {
  it('returns at most 4 bullets even when all conditions apply', () => {
    const bullets = buildPreviewChangeBullets({
      addedElectives: 2,
      maxSemHours: 18,
      allCategoriesSatisfied: true,
      warningCount: 1,
    });
    expect(bullets.length).toBeLessThanOrEqual(4);
    expect(bullets).toEqual([
      'נוספו 2 קורסי בחירה',
      'עומס מקסימלי: 18 ש״ש',
      'הושלמו כל קטגוריות החובה',
      'נותרה אזהרה אחת',
    ]);
  });

  it('omits bullets for conditions that do not apply', () => {
    const bullets = buildPreviewChangeBullets({
      addedElectives: 0,
      maxSemHours: 16,
      allCategoriesSatisfied: false,
      warningCount: 0,
    });
    expect(bullets).toEqual(['עומס מקסימלי: 16 ש״ש']);
  });
});

describe('pickPrimaryBlockingReason', () => {
  it('prefers missing-requirement cards over a generic blocking error', () => {
    const completeness = { incomplete: true, reasons: ['חסרים קורסי חובה: X.'], added_electives: 0 };
    const missingCards = [
      { category_id: 'fluids', name: 'זורמים', missing: 2, candidates: [{ course_id: 'F1' }] },
      { category_id: 'solids', name: 'מוצקים', missing: 2, candidates: [{ course_id: 'S1' }] },
    ];
    const reason = pickPrimaryBlockingReason(completeness as any, missingCards as any);
    expect(reason).toContain('חסרות דרישות תואר');
  });

  it('falls back to overload reason when no missing-requirement candidates exist', () => {
    const completeness = { incomplete: true, reasons: ['סמסטר א עמוס מדי (24 ש"ש) למרות שניתן להעביר קורסים גמישים.'], added_electives: 0 };
    const reason = pickPrimaryBlockingReason(completeness as any, []);
    expect(reason).toContain('עומס');
  });

  it('returns a warnings-only message when the plan is applicable but has notes', () => {
    const completeness = { incomplete: false, reasons: ['שים לב: עומס מעט גבוה בסמסטר א.'], added_electives: 1 };
    const reason = pickPrimaryBlockingReason(completeness as any, []);
    expect(reason).toBe('ניתן להחיל — נותרו אזהרות בלבד');
  });

  it('returns a clean applicable message with no reasons at all', () => {
    const completeness = { incomplete: false, reasons: [], added_electives: 0 };
    expect(pickPrimaryBlockingReason(completeness as any, [])).toBe('תוכנית חוקית — ניתן להחיל');
  });
});
