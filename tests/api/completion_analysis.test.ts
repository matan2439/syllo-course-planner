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
  getPlanPreviewStatus,
  repairAddMissingMandatory,
  getMandatoryStatusReport,
  repairAddHoursToDegree,
  repairAddGeneralCourses,
  getHoursStatusReport,
  buildPreviewChangeBullets,
  DEGREE_REQUIRED_HOURS,
  DEFAULT_MAX_HOURS_PER_SEMESTER,
  SEVERE_OVERLOAD_MARGIN,
  MAX_ADDED_ELECTIVES_FOR_HOURS,
  DEFAULT_ADDED_ELECTIVES_WHEN_PRIOR_HOURS_UNKNOWN,
  MAX_REASONABLE_SEMESTER_HOURS,
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

  it('flags remaining degree hours when no electives were added and candidates remain', () => {
    const analysis = {
      ...baseAnalysis,
      hours: { ...baseAnalysis.hours, remaining_hours: 20 },
      categories: [{ name: 'בחירה', required: 0, placed: 0, missing: 0, candidates: [{ course_id: 'E1', name_he: 'אלקטיב', hours: 3 }] }],
      elective_pool: [{ course_id: 'E1', name_he: 'אלקטיב', hours: 3 }],
    };
    const result = evaluatePlanCompleteness([{ semester_id: 's1', course_ids: [] }], analysis as any, { courseHours: {} });
    expect(result.incomplete).toBe(true);
    expect(result.reasons.some(r => r.includes('להשלמת התואר'))).toBe(true);
  });

  it('does not flag remaining hours once enough elective hours were added', () => {
    const analysis = { ...baseAnalysis, hours: { ...baseAnalysis.hours, remaining_hours: 20 } };
    const result = evaluatePlanCompleteness([{ semester_id: 's1', course_ids: ['E1'] }], analysis as any, { courseHours: { E1: 20 } });
    expect(result.reasons.some(r => r.includes('להשלמת התואר'))).toBe(false);
    expect(result.incomplete).toBe(false);
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

describe('repairAddMissingMandatory', () => {
  const knownSemesterIds = ['s1', 's2'];

  function analysisWith(missing_mandatory: any[]): any {
    return {
      completed_course_ids: [], scheduled_course_ids: [], missing_mandatory,
      categories: [],
      hours: { required_total: 185, known_completed_hours: 0, known_scheduled_hours: 0, known_total_hours: 0, remaining_hours: 0, unknown_hour_courses: 0, approximate: false },
      overloaded_semesters: [], movable_courses: [], pinned_course_ids: [],
    };
  }

  it('inserts a remaining mandatory course before any other repair', () => {
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }, { semester_id: 's2', course_ids: [] }] };
    const analysis = analysisWith([{ course_id: 'M1', name_he: 'חובה 1', hours: 3 }]);
    const courses = { M1: { hours: 3, placement_policy: 'flexible', effective_allowed_semesters: ['s1', 's2'] } };
    const result = repairAddMissingMandatory(proposal as any, analysis, { courses, knownSemesterIds });
    expect(result.added).toEqual([{ course_id: 'M1', semester_id: 's1' }]);
    expect(result.unplaceable).toEqual([]);
    expect(result.proposal.semesters.find((s: any) => s.semester_id === 's1')!.course_ids).toContain('M1');
  });

  it('fixed mandatory course goes only to its required/recommended semester', () => {
    const proposal = { semesters: [{ semester_id: 's1', course_ids: ['X', 'Y', 'Z'] }, { semester_id: 's2', course_ids: [] }] };
    const analysis = analysisWith([{ course_id: 'M2', name_he: 'חובה קבוע', hours: 3 }]);
    const courses = {
      M2: { hours: 3, placement_policy: 'fixed', effective_allowed_semesters: ['s2'] },
      X: { hours: 4 }, Y: { hours: 4 }, Z: { hours: 4 },
    };
    const result = repairAddMissingMandatory(proposal as any, analysis, { courses, knownSemesterIds });
    expect(result.added).toEqual([{ course_id: 'M2', semester_id: 's2' }]);
  });

  it('flexible mandatory course goes to the least-loaded legal allowed semester', () => {
    const proposal = { semesters: [{ semester_id: 's1', course_ids: ['X'] }, { semester_id: 's2', course_ids: [] }] };
    const analysis = analysisWith([{ course_id: 'M3', name_he: 'חובה גמיש', hours: 3 }]);
    const courses = {
      M3: { hours: 3, placement_policy: 'flexible', effective_allowed_semesters: ['s1', 's2'] },
      X: { hours: 4 },
    };
    const result = repairAddMissingMandatory(proposal as any, analysis, { courses, knownSemesterIds });
    expect(result.added).toEqual([{ course_id: 'M3', semester_id: 's2' }]);
  });

  it('does not re-schedule a mandatory course already placed in the proposal', () => {
    const proposal = { semesters: [{ semester_id: 's1', course_ids: ['M1'] }] };
    const analysis = analysisWith([{ course_id: 'M1', name_he: 'חובה 1', hours: 3 }]);
    const courses = { M1: { hours: 3, placement_policy: 'flexible', effective_allowed_semesters: ['s1'] } };
    const result = repairAddMissingMandatory(proposal as any, analysis, { courses, knownSemesterIds: ['s1'] });
    expect(result.added).toEqual([]);
    expect(result.proposal.semesters[0].course_ids).toEqual(['M1']);
  });

  it('reports a mandatory course with no legal semester as unplaceable', () => {
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }, { semester_id: 's2', course_ids: [] }] };
    const analysis = analysisWith([{ course_id: 'M4', name_he: 'חובה תקוע', hours: 3 }]);
    const courses = { M4: { hours: 3, placement_policy: 'fixed', effective_allowed_semesters: ['s3'] } };
    const result = repairAddMissingMandatory(proposal as any, analysis, { courses, knownSemesterIds });
    expect(result.added).toEqual([]);
    expect(result.unplaceable).toEqual([{ course_id: 'M4', name_he: 'חובה תקוע' }]);
  });
});

describe('getMandatoryStatusReport', () => {
  it('reports placed vs missing mandatory courses', () => {
    const analysis: any = {
      missing_mandatory: [
        { course_id: 'M1', name_he: 'חובה 1' },
        { course_id: 'M2', name_he: 'חובה 2' },
      ],
    };
    const status = getMandatoryStatusReport(analysis, new Set(['M1']));
    expect(status).toEqual({ required: 2, placed: 1, missing: [{ course_id: 'M2', name_he: 'חובה 2' }] });
  });
});

describe('PART A integration: mandatory-first planning order', () => {
  it('electives are inserted only after mandatory completion fills the proposal', () => {
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }, { semester_id: 's2', course_ids: [] }] };
    const analysis: any = {
      completed_course_ids: [], scheduled_course_ids: [],
      missing_mandatory: [{ course_id: 'M1', name_he: 'חובה 1', hours: 3 }],
      categories: [{ name: 'בחירה', required: 1, placed: 0, missing: 1, candidates: [{ course_id: 'E1', hours: 3, is_wanted: true }] }],
      hours: { required_total: 185, known_completed_hours: 0, known_scheduled_hours: 0, known_total_hours: 0, remaining_hours: 0, unknown_hour_courses: 0, approximate: false },
      overloaded_semesters: [], movable_courses: [], pinned_course_ids: [],
    };
    const courses = {
      M1: { hours: 3, placement_policy: 'flexible', effective_allowed_semesters: ['s1', 's2'] },
      E1: { hours: 3, effective_allowed_semesters: ['s1', 's2'] },
    };
    const knownSemesterIds = ['s1', 's2'];

    const afterMandatory = repairAddMissingMandatory(proposal as any, analysis, { courses, knownSemesterIds });
    expect(afterMandatory.added.map(a => a.course_id)).toEqual(['M1']);

    const afterElectives = repairAddMissingElectives(afterMandatory.proposal as any, analysis, { courses, knownSemesterIds });
    expect(afterElectives.added.map(a => a.course_id)).toEqual(['E1']);

    const allPlaced = afterElectives.proposal.semesters.flatMap((s: any) => s.course_ids);
    expect(allPlaced).toEqual(expect.arrayContaining(['M1', 'E1']));
  });

  it('a plan with a missing mandatory course is not applyable', () => {
    const proposalSemesters = [{ semester_id: 's1', course_ids: ['E1'] }];
    const analysis: any = {
      completed_course_ids: [], scheduled_course_ids: [],
      missing_mandatory: [{ course_id: 'M1', name_he: 'חובה 1', hours: 3 }],
      categories: [],
      hours: { required_total: 185, known_completed_hours: 0, known_scheduled_hours: 0, known_total_hours: 0, remaining_hours: 0, unknown_hour_courses: 0, approximate: false },
      overloaded_semesters: [], movable_courses: [], pinned_course_ids: [],
    };
    const completeness = evaluatePlanCompleteness(proposalSemesters, analysis);
    expect(completeness.incomplete).toBe(true);
    expect(isPlanApplyable([], completeness)).toBe(false);
  });

  it('preview top status says "חסרים קורסי חובה" when mandatory missing exists, never "תוכנית חוקית"', () => {
    const completeness = {
      incomplete: true,
      reasons: ['חסרים קורסי חובה: חובה 1, חובה 2.'],
      added_electives: 0,
    };
    const reason = pickPrimaryBlockingReason(completeness as any, []);
    expect(reason).toBe('לא ניתן להחיל — חסרים 2 קורסי חובה');
    expect(reason).not.toContain('תוכנית חוקית');

    const status = getPlanPreviewStatus([], completeness as any, reason);
    expect(status.kind).toBe('error');
    expect(status.icon).toBe('✕');
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

  it('never drops a mandatory course from the plan, even when overload cannot be fully fixed', () => {
    const proposal = {
      semesters: [
        { semester_id: 's1', course_ids: ['MF', 'M2'] }, // flexible mandatory 18 + fixed mandatory 6 = 24
        { semester_id: 's2', course_ids: [] },
      ],
    };
    const courses = {
      MF: { hours: 18, course_type: 'mandatory', placement_policy: 'flexible', effective_allowed_semesters: ['s1', 's2'] },
      M2: { hours: 6, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['s1'] },
    };
    const result = repairPlanLoad(proposal as any, { courses, maxHoursPerSemester: 20 });
    const allPlaced = result.proposal.semesters.flatMap((s: any) => s.course_ids);
    expect(allPlaced.sort()).toEqual(['M2', 'MF']);
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

  it('a 0/1 required category with candidates makes the plan not applyable and never says "תוכנית חוקית"', () => {
    const analysis = {
      ...baseAnalysis,
      categories: [
        { name: 'קורסי ליבה — מערכות', category_id: 'systems', required: 1, placed: 0, missing: 1, candidates: [{ course_id: 'Y1', name_he: 'מערכות א', hours: 3 }] },
        { name: 'מעבדות מתקדמות', category_id: 'advanced_labs', required: 1, placed: 0, missing: 1, candidates: [{ course_id: 'L1', name_he: 'מעבדה א', hours: 2 }] },
      ],
    };
    const completeness = evaluatePlanCompleteness([{ semester_id: 's1', course_ids: [] }], analysis as any);
    expect(completeness.incomplete).toBe(true);

    const placedIds = new Set<string>();
    const missingCards = getMissingRequirementCards(analysis as any, placedIds);
    expect(isPlanApplyable([], completeness)).toBe(false);

    const reason = pickPrimaryBlockingReason(completeness, missingCards);
    expect(reason).not.toContain('תוכנית חוקית');
    expect(reason).toContain('חסרות דרישות תואר');
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

describe('getPlanPreviewStatus', () => {
  it('warnings-only plan is applyable, kind=warning, icon=⚠ (not error/✕)', () => {
    const completeness = { incomplete: false, reasons: ['שים לב: סמסטר א חורג ב־2 ש"ש מהעדפת העומס שלך.'], added_electives: 1 };
    expect(isPlanApplyable([], completeness as any)).toBe(true);
    const status = getPlanPreviewStatus([], completeness as any, 'ניתן להחיל — נותרו אזהרות בלבד');
    expect(status.kind).toBe('warning');
    expect(status.icon).toBe('⚠');
    expect(status.icon).not.toBe('✕');
  });

  it('clean applyable plan is kind=success with ✓', () => {
    const completeness = { incomplete: false, reasons: [], added_electives: 0 };
    const status = getPlanPreviewStatus([], completeness as any, 'תוכנית חוקית — ניתן להחיל');
    expect(status.kind).toBe('success');
    expect(status.icon).toBe('✓');
  });

  it('red/error status appears only for blocking validation errors', () => {
    const completeness = { incomplete: false, reasons: [], added_electives: 0 };
    const status = getPlanPreviewStatus(['קורס X מותר רק בסמסטר Y.'], completeness as any, 'לא ניתן להחיל — יש לתקן שגיאות');
    expect(status.kind).toBe('error');
    expect(status.icon).toBe('✕');
  });

  it('red/error status appears only for blocking completeness reasons', () => {
    const completeness = { incomplete: true, reasons: ['חסרים קורסי חובה: X.'], added_electives: 0 };
    const status = getPlanPreviewStatus([], completeness as any, 'לא ניתן להחיל — חסרות דרישות תואר');
    expect(status.kind).toBe('error');
    expect(status.icon).toBe('✕');
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
  it('prefers missing mandatory courses over missing-requirement cards', () => {
    const completeness = { incomplete: true, reasons: ['חסרים קורסי חובה: X.'], added_electives: 0 };
    const missingCards = [
      { category_id: 'fluids', name: 'זורמים', missing: 2, candidates: [{ course_id: 'F1' }] },
      { category_id: 'solids', name: 'מוצקים', missing: 2, candidates: [{ course_id: 'S1' }] },
    ];
    const reason = pickPrimaryBlockingReason(completeness as any, missingCards as any);
    expect(reason).toContain('חסרים');
    expect(reason).toContain('קורסי חובה');
  });

  it('falls back to missing-requirement cards when no mandatory courses are missing', () => {
    const completeness = { incomplete: true, reasons: ['חסר קורס אחד מקורסי הקטגוריה "זורמים".'], added_electives: 0 };
    const missingCards = [
      { category_id: 'fluids', name: 'זורמים', missing: 1, candidates: [{ course_id: 'F1' }] },
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

describe('repairAddHoursToDegree and degree-hours completeness (PART G)', () => {
  const knownSemesterIds = ['s1', 's2'];
  const courses: Record<string, any> = {
    SAT1: { hours: 3, effective_allowed_semesters: ['s1', 's2'] }, // already-placed candidate of a satisfied category
    EXTRA1: { hours: 4, effective_allowed_semesters: ['s1', 's2'] },
    EXTRA2: { hours: 5, effective_allowed_semesters: ['s1', 's2'] },
    EXTRA3: { hours: 3, effective_allowed_semesters: ['s1', 's2'] },
  };

  function baseAnalysis(overrides: any = {}) {
    return {
      completed_course_ids: ['DONE1'],
      scheduled_course_ids: [],
      missing_mandatory: [],
      categories: [
        // satisfied category — but its candidates still count toward the elective pool (PART D.3)
        { name: 'קורסי ליבה — זורמים', category_id: 'fluids', required: 1, placed: 1, missing: 0, candidates: [{ course_id: 'SAT1', name_he: 'זרימה נוספת', hours: 3 }] },
        // generic "additional electives" category
        { name: 'בחירה', category_id: 'other_specialization', required: 0, placed: 0, missing: 0, candidates: [
          { course_id: 'EXTRA1', name_he: 'התמחות 1', hours: 4 },
          { course_id: 'EXTRA2', name_he: 'התמחות 2', hours: 5 },
          { course_id: 'EXTRA3', name_he: 'התמחות 3', hours: 3 },
        ] },
      ],
      elective_pool: [
        { course_id: 'SAT1', name_he: 'זרימה נוספת', hours: 3 },
        { course_id: 'EXTRA1', name_he: 'התמחות 1', hours: 4 },
        { course_id: 'EXTRA2', name_he: 'התמחות 2', hours: 5 },
        { course_id: 'EXTRA3', name_he: 'התמחות 3', hours: 3 },
      ],
      hours: { required_total: 185, known_completed_hours: 30, known_scheduled_hours: 145, known_total_hours: 175, remaining_hours: 10, unknown_hour_courses: 0, approximate: false },
      overloaded_semesters: [],
      movable_courses: [],
      pinned_course_ids: [],
      ...overrides,
    };
  }

  it('1. a plan below 185 hours is not applyable if candidates remain', () => {
    const analysis = baseAnalysis();
    const completeness = evaluatePlanCompleteness([{ semester_id: 's1', course_ids: [] }], analysis as any);
    expect(completeness.incomplete).toBe(true);
    expect(completeness.reasons.some(r => r.includes('להשלמת התואר'))).toBe(true);
    expect(isPlanApplyable([], completeness)).toBe(false);
  });

  it('2/4. repairAddHoursToDegree keeps adding electives after category requirements are satisfied, until 185 is reached', () => {
    const analysis = baseAnalysis();
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }, { semester_id: 's2', course_ids: [] }] };
    const result = repairAddHoursToDegree(proposal as any, analysis as any, { courses, knownSemesterIds, maxHoursPerSemester: 18 });
    // remaining_hours=10 -> needs at least 10 more known hours
    expect(result.added.length).toBeGreaterThan(1);
    expect(result.proposed_total_hours).toBeGreaterThanOrEqual(185);
    expect(result.exhausted).toBe(false);
  });

  it('3. additional electives can come from an already-satisfied category (SAT1)', () => {
    const analysis = baseAnalysis();
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }, { semester_id: 's2', course_ids: [] }] };
    const result = repairAddHoursToDegree(proposal as any, analysis as any, { courses, knownSemesterIds, maxHoursPerSemester: 18 });
    expect(result.added.some(a => a.course_id === 'SAT1')).toBe(true);
  });

  it('5. repair stops when the elective pool is exhausted before reaching 185', () => {
    const analysis = baseAnalysis({ hours: { required_total: 185, known_completed_hours: 30, known_scheduled_hours: 100, known_total_hours: 130, remaining_hours: 55, unknown_hour_courses: 0, approximate: false } });
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }, { semester_id: 's2', course_ids: [] }] };
    const result = repairAddHoursToDegree(proposal as any, analysis as any, { courses, knownSemesterIds, maxHoursPerSemester: 18 });
    // pool only has 3+4+5+3=15 hours, can't cover 55
    expect(result.proposed_total_hours).toBeLessThan(185);
    expect(result.exhausted).toBe(true);
  });

  it('6. preview status says "חסרות שעות להשלמת התואר" when below 185 with candidates remaining', () => {
    const analysis = baseAnalysis();
    const completeness = evaluatePlanCompleteness([{ semester_id: 's1', course_ids: [] }], analysis as any);
    const reason = pickPrimaryBlockingReason(completeness, []);
    expect(reason).toContain('חסרות שעות להשלמת התואר');
    expect(reason).not.toContain('תוכנית חוקית');
  });

  it('7. the elective pool used for hours is larger than just the missing-category candidates', () => {
    const analysis = baseAnalysis();
    const missingCategoryCandidates = analysis.categories.flatMap((c: any) => c.missing > 0 ? c.candidates : []);
    expect(analysis.elective_pool.length).toBeGreaterThan(missingCategoryCandidates.length);
  });

  it('8. completed courses count toward known hours but are never re-scheduled', () => {
    const analysis = baseAnalysis();
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }, { semester_id: 's2', course_ids: [] }] };
    const result = repairAddHoursToDegree(proposal as any, analysis as any, { courses, knownSemesterIds, maxHoursPerSemester: 18 });
    const placedIds = result.proposal.semesters.flatMap((s: any) => s.course_ids);
    expect(placedIds).not.toContain('DONE1');
    // 30 known_completed_hours contributed to the starting total without being placed
    expect(result.proposed_total_hours).toBeGreaterThanOrEqual(analysis.hours.known_total_hours);
  });

  it('9. unknown-hour courses do not falsely satisfy the 185-hour requirement, and are surfaced with a warning count', () => {
    const analysis = baseAnalysis({
      hours: { required_total: 185, known_completed_hours: 30, known_scheduled_hours: 100, known_total_hours: 130, remaining_hours: 55, unknown_hour_courses: 2, approximate: true },
    });
    const proposalSemesters = [{ semester_id: 's1', course_ids: [] }];
    const status = getHoursStatusReport(analysis as any, proposalSemesters, {});
    expect(status.proposed_total_hours).toBe(130);
    expect(status.remaining).toBe(55);
    expect(status.unknown_hour_courses).toBe(2);

    const completeness = evaluatePlanCompleteness(proposalSemesters, analysis as any);
    expect(completeness.incomplete).toBe(true);
  });
});

describe('completed-degree-hours model (PART H)', () => {
  function ctxWith(totalHoursProgress: any, semesters: PlanContext['semesters'] = []): PlanContext {
    return {
      semesters,
      personal_status: { completed: [], currently_taking: [], planned: [] },
      total_hours_progress: totalHoursProgress,
    } as any;
  }

  it('1. manual completed_degree_hours is used as known_completed_hours and marks prior hours as known', () => {
    const analysis = buildCompletionAnalysis(ctxWith({ manual_completed_degree_hours: 115, known_completed_hours: 30 }));
    expect(analysis.hours.known_completed_hours).toBe(115);
    expect(analysis.hours.prior_hours_known).toBe(true);
  });

  it('2. without manual hours, completed-course-status hours are used and prior hours are unknown', () => {
    const analysis = buildCompletionAnalysis(ctxWith({ known_completed_hours: 30 }));
    expect(analysis.hours.known_completed_hours).toBe(30);
    expect(analysis.hours.prior_hours_known).toBe(false);
  });

  it('3. completed_degree_hours=115 leaves only ~70 remaining_hours toward the degree', () => {
    const analysis = buildCompletionAnalysis(ctxWith({ manual_completed_degree_hours: 115 }));
    expect(analysis.hours.remaining_hours).toBe(70);
  });

  it('4. program A and program B can have different degree_required_hours', () => {
    const a = buildCompletionAnalysis(ctxWith({ degree_required_hours: 160, manual_completed_degree_hours: 100 }));
    const b = buildCompletionAnalysis(ctxWith({ degree_required_hours: 200, manual_completed_degree_hours: 100 }));
    expect(a.hours.required_total).toBe(160);
    expect(a.hours.remaining_hours).toBe(60);
    expect(b.hours.required_total).toBe(200);
    expect(b.hours.remaining_hours).toBe(100);
  });

  it('5. Mechanical Engineering uses 185 from its program config, not a hard-coded global', () => {
    // No degree_required_hours supplied -> falls back to DEGREE_REQUIRED_HOURS (185).
    const analysis = buildCompletionAnalysis(ctxWith({ manual_completed_degree_hours: 0 }));
    expect(analysis.hours.required_total).toBe(DEGREE_REQUIRED_HOURS);
    expect(analysis.hours.required_total).toBe(185);
  });

  it('6. missing general/humanities hours remain a separate requirement, not filled by technical electives', () => {
    const courses: Record<string, any> = {
      E1: { hours: 30, effective_allowed_semesters: ['s1'] },
    };
    const analysis: any = {
      completed_course_ids: [], scheduled_course_ids: [], missing_mandatory: [],
      categories: [{ name: 'בחירה', category_id: 'other', required: 0, placed: 0, missing: 0, candidates: [{ course_id: 'E1', hours: 30 }] }],
      elective_pool: [{ course_id: 'E1', hours: 30 }],
      hours: {
        required_total: 185, known_completed_hours: 150, known_scheduled_hours: 0, known_total_hours: 150,
        remaining_hours: 35, unknown_hour_courses: 0, approximate: false,
        completed_general_hours: 0, required_general_hours: 10, general_hours_shortfall: 10,
        prior_hours_known: true,
      },
      overloaded_semesters: [], movable_courses: [], pinned_course_ids: [],
    };
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }] };
    const result = repairAddHoursToDegree(proposal as any, analysis, { courses, knownSemesterIds: ['s1'], maxHoursPerSemester: 30 });
    // target = required_total(185) - general_hours_shortfall(10) = 175; total starts at 150 -> needs 25, E1=30 is enough
    expect(result.proposed_total_hours).toBe(180);

    const completeness = evaluatePlanCompleteness(proposal.semesters, analysis);
    expect(completeness.reasons.some(r => r.includes('שער/רוח'))).toBe(true);
  });

  it('7. repairAddHoursToDegree adds at most DEFAULT_ADDED_ELECTIVES_WHEN_PRIOR_HOURS_UNKNOWN electives when prior hours are unknown', () => {
    const courses: Record<string, any> = {};
    const elective_pool = [];
    for (let i = 1; i <= 10; i++) {
      const id = `X${i}`;
      courses[id] = { hours: 1, effective_allowed_semesters: ['s1'] };
      elective_pool.push({ course_id: id, hours: 1 });
    }
    const analysis: any = {
      completed_course_ids: [], scheduled_course_ids: [], missing_mandatory: [],
      categories: [], elective_pool,
      hours: {
        required_total: 185, known_completed_hours: 0, known_scheduled_hours: 50, known_total_hours: 50,
        remaining_hours: 135, unknown_hour_courses: 0, approximate: false,
        completed_general_hours: 0, required_general_hours: 0, general_hours_shortfall: 0,
        prior_hours_known: false,
      },
      overloaded_semesters: [], movable_courses: [], pinned_course_ids: [],
    };
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }] };
    const result = repairAddHoursToDegree(proposal as any, analysis, { courses, knownSemesterIds: ['s1'], maxHoursPerSemester: 30 });
    expect(result.added.length).toBe(DEFAULT_ADDED_ELECTIVES_WHEN_PRIOR_HOURS_UNKNOWN);
    expect(result.added.length).toBeLessThan(10);
  });

  it('8. repairAddHoursToDegree stops at MAX_ADDED_ELECTIVES_FOR_HOURS and reports capped when prior hours are known', () => {
    const courses: Record<string, any> = {};
    const elective_pool = [];
    for (let i = 1; i <= 20; i++) {
      const id = `Y${i}`;
      courses[id] = { hours: 1, effective_allowed_semesters: ['s1'] };
      elective_pool.push({ course_id: id, hours: 1 });
    }
    const analysis: any = {
      completed_course_ids: [], scheduled_course_ids: [], missing_mandatory: [],
      categories: [], elective_pool,
      hours: {
        required_total: 185, known_completed_hours: 0, known_scheduled_hours: 50, known_total_hours: 50,
        remaining_hours: 135, unknown_hour_courses: 0, approximate: false,
        completed_general_hours: 0, required_general_hours: 0, general_hours_shortfall: 0,
        prior_hours_known: true,
      },
      overloaded_semesters: [], movable_courses: [], pinned_course_ids: [],
    };
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }] };
    const result = repairAddHoursToDegree(proposal as any, analysis, { courses, knownSemesterIds: ['s1'], maxHoursPerSemester: 30 });
    expect(result.added.length).toBe(MAX_ADDED_ELECTIVES_FOR_HOURS);
    expect(result.capped).toBe(true);
    expect(result.proposed_total_hours).toBeLessThan(185);
  });

  it('9. a semester exceeding MAX_REASONABLE_SEMESTER_HOURS blocks the plan as unreasonable', () => {
    const analysis: any = {
      completed_course_ids: [], scheduled_course_ids: [], missing_mandatory: [],
      categories: [], elective_pool: [],
      hours: {
        required_total: 185, known_completed_hours: 0, known_scheduled_hours: 0, known_total_hours: 0,
        remaining_hours: 185, unknown_hour_courses: 0, approximate: false,
        completed_general_hours: 0, required_general_hours: 0, general_hours_shortfall: 0,
        prior_hours_known: false,
      },
      overloaded_semesters: [], movable_courses: [], pinned_course_ids: [],
    };
    const courseHours: Record<string, number> = { C1: 18, C2: 18 };
    const proposalSemesters = [{ semester_id: 's1', course_ids: ['C1', 'C2'] }];
    const completeness = evaluatePlanCompleteness(proposalSemesters, analysis, { courseHours });
    expect(completeness.reasons.some(r => r.includes('עומס לא סביר'))).toBe(true);
    expect(completeness.incomplete).toBe(true);
    expect(pickPrimaryBlockingReason(completeness, [])).toBe('לא ניתן להחיל — נוצר עומס לא סביר');
  });
});

describe('קורסי שער רוח requirement (Mechanical Engineering = 6 נק"ז)', () => {
  function ctxWithGeneral(generalReq: any, totalHoursProgress: any = {}, semesters: any[] = []) {
    return {
      semesters,
      general_course_requirements: generalReq,
      total_hours_progress: { known_completed_hours: 0, degree_required_hours: 185, manual_completed_degree_hours: 100, ...totalHoursProgress },
    } as any;
  }

  const candidates = [
    { course_id: 'G1', name_he: 'תולדות האנושות', hours: 2 },
    { course_id: 'G2', name_he: 'מהי תרבות', hours: 2 },
    { course_id: 'G3', name_he: 'ללמוד איך ללמוד', hours: 2 },
  ];

  it('1. Mechanical Engineering requires 6 נק"ז שער רוח', () => {
    const ctx = ctxWithGeneral({ name: 'קורסי שער רוח', required_credits: 6, candidates });
    const analysis = buildCompletionAnalysis(ctx);
    expect(analysis.general_requirement?.required).toBe(6);
    expect(analysis.hours.required_general_hours).toBe(6);
  });

  it('2. completed שער רוח credits count toward the 185 total', () => {
    const ctx = ctxWithGeneral(
      { name: 'קורסי שער רוח', required_credits: 6, candidates },
      { completed_general_hours: 6, manual_completed_degree_hours: 100 },
    );
    const analysis = buildCompletionAnalysis(ctx);
    expect(analysis.hours.known_completed_hours).toBe(100);
    expect(analysis.hours.general_hours_shortfall).toBe(0);
  });

  it('3. missing שער רוח credits are scheduled separately via repairAddGeneralCourses', () => {
    const ctx = ctxWithGeneral(
      { name: 'קורסי שער רוח', required_credits: 6, candidates },
      { completed_general_hours: 0 },
    );
    const analysis = buildCompletionAnalysis(ctx);
    const courses: Record<string, any> = {
      G1: { hours: 2, effective_allowed_semesters: ['s1'] },
      G2: { hours: 2, effective_allowed_semesters: ['s1'] },
      G3: { hours: 2, effective_allowed_semesters: ['s1'] },
    };
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }] };
    const result = repairAddGeneralCourses(proposal as any, analysis, { courses, knownSemesterIds: ['s1'], maxHoursPerSemester: 30 });
    expect(result.added.length).toBe(3);
    expect(result.added.every(a => a.course_id.startsWith('G'))).toBe(true);
    expect(result.exhausted).toBe(false);
  });

  it('4. engineering electives do not satisfy שער רוח (general_hours_shortfall stays unfilled by elective hours)', () => {
    const ctx: any = {
      semesters: [],
      general_course_requirements: { name: 'קורסי שער רוח', required_credits: 6, candidates },
      category_requirements: [
        { name: 'בחירה כללית', category_id: 'elective', required: 1, placed: 0, candidates: [{ course_id: 'E1', name_he: 'בחירה הנדסית', hours: 3 }] },
      ],
      total_hours_progress: { known_completed_hours: 0, degree_required_hours: 185, manual_completed_degree_hours: 175, completed_general_hours: 0 },
    };
    const analysis = buildCompletionAnalysis(ctx);
    // E1 (engineering elective) must not appear in the שער רוח candidate pool, and vice versa.
    expect(analysis.general_requirement?.candidates.some(c => c.course_id === 'E1')).toBe(false);
    expect(analysis.elective_pool.some(c => c.course_id === 'G1')).toBe(false);
    expect(analysis.hours.general_hours_shortfall).toBe(6);
  });

  it('5. שער רוח courses do not satisfy engineering elective categories', () => {
    const ctx: any = {
      semesters: [],
      general_course_requirements: { name: 'קורסי שער רוח', required_credits: 6, candidates },
      category_requirements: [
        { name: 'בחירה כללית', category_id: 'elective', required: 1, placed: 0, candidates: [...candidates, { course_id: 'E1', name_he: 'בחירה הנדסית', hours: 3 }] },
      ],
      total_hours_progress: { known_completed_hours: 0, degree_required_hours: 185, manual_completed_degree_hours: 175 },
    };
    const analysis = buildCompletionAnalysis(ctx);
    expect(analysis.elective_pool.map(c => c.course_id)).toEqual(['E1']);
  });

  it('6. if user already completed 6 נק"ז שער רוח, no extra שער רוח is added', () => {
    const ctx = ctxWithGeneral(
      { name: 'קורסי שער רוח', required_credits: 6, candidates },
      { completed_general_hours: 6 },
    );
    const analysis = buildCompletionAnalysis(ctx);
    const courses: Record<string, any> = {
      G1: { hours: 2, effective_allowed_semesters: ['s1'] },
      G2: { hours: 2, effective_allowed_semesters: ['s1'] },
      G3: { hours: 2, effective_allowed_semesters: ['s1'] },
    };
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }] };
    const result = repairAddGeneralCourses(proposal as any, analysis, { courses, knownSemesterIds: ['s1'], maxHoursPerSemester: 30 });
    expect(result.added.length).toBe(0);
  });

  it('7. if user completed 3 נק"ז שער רוח, planner adds about 3 more (1.5 credits short rounds up to a 2-credit course)', () => {
    const ctx = ctxWithGeneral(
      { name: 'קורסי שער רוח', required_credits: 6, candidates },
      { completed_general_hours: 3 },
    );
    const analysis = buildCompletionAnalysis(ctx);
    const courses: Record<string, any> = {
      G1: { hours: 2, effective_allowed_semesters: ['s1'] },
      G2: { hours: 2, effective_allowed_semesters: ['s1'] },
      G3: { hours: 2, effective_allowed_semesters: ['s1'] },
    };
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }] };
    const result = repairAddGeneralCourses(proposal as any, analysis, { courses, knownSemesterIds: ['s1'], maxHoursPerSemester: 30 });
    // need 3 more credits; 2-credit courses are added until >= 6 total (2 courses = 4 -> 3+4=7 >= 6)
    expect(result.added.length).toBe(2);
  });

  it('8. if שער רוח repository is unavailable (no candidates), planner shows a clear warning instead of pretending it is complete', () => {
    const ctx = ctxWithGeneral(
      { name: 'קורסי שער רוח', required_credits: 6, candidates: [] },
      { completed_general_hours: 0 },
    );
    const analysis = buildCompletionAnalysis(ctx);
    const messages = formatCompletionMessages(analysis);
    expect(messages.some(m => m.includes('שער רוח') && m.includes('אינו זמין'))).toBe(true);

    const completeness = evaluatePlanCompleteness([{ semester_id: 's1', course_ids: [] }], analysis, {});
    expect(completeness.reasons.some(r => r.includes('שער רוח') && r.includes('אינו זמין'))).toBe(true);
  });

  it('9. שער רוח repository courses default to 2 נק"ז and are treated as known credits', () => {
    const ctx = ctxWithGeneral(
      { name: 'קורסי שער רוח', required_credits: 6, candidates },
      { completed_general_hours: 0 },
    );
    const analysis = buildCompletionAnalysis(ctx);
    // Each candidate from the repository carries hours: 2 (the שער רוח credits_rule), not null/undefined.
    expect(analysis.general_requirement?.candidates.every(c => c.hours === 2)).toBe(true);

    // Once placed on the board, its 2 נק"ז are known hours — not counted as "unknown_hour_courses".
    const courseHours: Record<string, number> = { G1: 2 };
    const hoursStatus = getHoursStatusReport(analysis, [{ semester_id: 's1', course_ids: ['G1'] }], courseHours);
    expect(hoursStatus.unknown_hour_courses).toBe(0);
  });
});

describe('remaining-hours pool spans already-satisfied categories (PART A/B/D)', () => {
  // Three required categories (each min 1, already satisfied via 1 placed
  // course), each with one extra unscheduled candidate that could still
  // count toward the remaining degree-hour quota.
  function buildCtx(opts: { manualCompleted: number; semesters?: any[]; extraCandidates?: Record<string, any> }) {
    const extra = opts.extraCandidates ?? {};
    return {
      semesters: opts.semesters ?? [],
      category_requirements: [
        { name: 'קורסי ליבה — זורמים', category_id: 'fluids', required: 1, placed: 1, candidates: [{ course_id: 'F2', name_he: 'זורמים 2', hours: 5, ...(extra.F2 || {}) }] },
        { name: 'קורסי ליבה — מוצקים', category_id: 'solids', required: 1, placed: 1, candidates: [{ course_id: 'S2', name_he: 'מוצקים 2', hours: 5, ...(extra.S2 || {}) }] },
        { name: 'קורסי ליבה — מערכות', category_id: 'systems', required: 1, placed: 1, candidates: [{ course_id: 'Y2', name_he: 'מערכות 2', hours: 5, ...(extra.Y2 || {}) }] },
      ],
      total_hours_progress: { known_completed_hours: 0, degree_required_hours: 185, manual_completed_degree_hours: opts.manualCompleted },
    } as any;
  }

  const courses: Record<string, any> = {
    F2: { hours: 5, effective_allowed_semesters: ['s1'] },
    S2: { hours: 5, effective_allowed_semesters: ['s1'] },
    Y2: { hours: 5, effective_allowed_semesters: ['s1'] },
  };

  it('1. after זורמים is satisfied, another זורמים elective can still fill remaining hours', () => {
    const ctx = buildCtx({ manualCompleted: 180 }); // remaining = 5
    const analysis = buildCompletionAnalysis(ctx);
    expect(analysis.categories.find(c => c.category_id === 'fluids')?.missing).toBe(0);
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }] };
    const result = repairAddHoursToDegree(proposal as any, analysis, { courses, knownSemesterIds: ['s1'], maxHoursPerSemester: 30 });
    expect(result.added.some(a => a.course_id === 'F2')).toBe(true);
  });

  it('2. after מוצקים is satisfied, another מוצקים elective can still fill remaining hours', () => {
    const ctx = buildCtx({ manualCompleted: 170 }); // remaining = 15 -> all three (incl. S2) get added
    const analysis = buildCompletionAnalysis(ctx);
    expect(analysis.categories.find(c => c.category_id === 'solids')?.missing).toBe(0);
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }] };
    const result = repairAddHoursToDegree(proposal as any, analysis, { courses, knownSemesterIds: ['s1'], maxHoursPerSemester: 30 });
    expect(result.added.some(a => a.course_id === 'S2')).toBe(true);
  });

  it('3. elective_pool includes candidates from already-satisfied categories', () => {
    const ctx = buildCtx({ manualCompleted: 180 });
    const analysis = buildCompletionAnalysis(ctx);
    expect(analysis.categories.every(c => c.missing === 0)).toBe(true);
    const poolIds = analysis.elective_pool.map(c => c.course_id);
    expect(poolIds).toEqual(expect.arrayContaining(['F2', 'S2', 'Y2']));
  });

  it('4. repairAddHoursToDegree does not require category.missing > 0', () => {
    const ctx = buildCtx({ manualCompleted: 170 }); // remaining = 15 -> all three needed
    const analysis = buildCompletionAnalysis(ctx);
    expect(analysis.categories.every(c => c.missing === 0)).toBe(true);
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }] };
    const result = repairAddHoursToDegree(proposal as any, analysis, { courses, knownSemesterIds: ['s1'], maxHoursPerSemester: 30 });
    expect(result.added.length).toBe(3);
    expect(result.proposed_total_hours).toBe(185);
  });

  it('5. exhausted=false when valid electives remain in already-satisfied categories', () => {
    const ctx = buildCtx({ manualCompleted: 180 }); // remaining = 5, F2 (5h) covers it
    const analysis = buildCompletionAnalysis(ctx);
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }] };
    const result = repairAddHoursToDegree(proposal as any, analysis, { courses, knownSemesterIds: ['s1'], maxHoursPerSemester: 30 });
    expect(result.exhausted).toBe(false);
  });

  it('6. exhausted=true only when all valid electives are scheduled/completed/illegal', () => {
    // F2 and S2 already placed on the board (10h); Y2 already completed before
    // the plan, so it's excluded from elective_pool too. Remaining hours (185-170-10=5)
    // can't be filled -> elective_pool is empty and exhausted becomes true.
    const ctx: any = buildCtx({
      manualCompleted: 170,
      semesters: [{ id: 's1', label: 's1', courses: [{ course_id: 'F2', hours: 5 }, { course_id: 'S2', hours: 5 }], total_hours: 10 }],
    });
    ctx.personal_status = { completed: [{ course_id: 'Y2', hours: 5 }] };
    const analysis = buildCompletionAnalysis(ctx);
    expect(analysis.elective_pool.length).toBe(0);
    const proposal = { semesters: [{ semester_id: 's1', course_ids: ['F2', 'S2'] }] };
    const result = repairAddHoursToDegree(proposal as any, analysis, { courses, knownSemesterIds: ['s1'], maxHoursPerSemester: 30 });
    expect(result.exhausted).toBe(true);
    expect(result.added.length).toBe(0);
  });

  it('7. additional electives from multiple categories can be added until remaining hours are met', () => {
    const ctx = buildCtx({ manualCompleted: 170 }); // remaining = 15, need F2+S2+Y2 (5 each)
    const analysis = buildCompletionAnalysis(ctx);
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }] };
    const result = repairAddHoursToDegree(proposal as any, analysis, { courses, knownSemesterIds: ['s1'], maxHoursPerSemester: 30 });
    const addedIds = result.added.map(a => a.course_id).sort();
    expect(addedIds).toEqual(['F2', 'S2', 'Y2']);
    expect(result.proposed_total_hours).toBe(185);
  });

  it('8. debug report includes rejection reasons for excluded candidates', () => {
    // Y2 has no legal semester (only offered in "s2", but the proposal/known semesters are only "s1").
    const ctx = buildCtx({ manualCompleted: 170 }, );
    const analysis = buildCompletionAnalysis(ctx);
    const coursesWithIllegalY2 = { ...courses, Y2: { hours: 5, effective_allowed_semesters: ['s2'] } };
    const proposal = { semesters: [{ semester_id: 's1', course_ids: [] }] };
    const result = repairAddHoursToDegree(proposal as any, analysis, { courses: coursesWithIllegalY2, knownSemesterIds: ['s1'], maxHoursPerSemester: 30 });

    expect(result.debug.candidates_before_filter).toBe(3);
    expect(result.debug.candidates_after_filter).toBe(3);
    expect(result.debug.rejected.some(r => r.course_id === 'Y2' && r.reason === 'no_legal_semester')).toBe(true);
    expect(result.debug.chosen.map(c => c.course_id).sort()).toEqual(['F2', 'S2']);
    expect(result.debug.remaining_hours_needed).toBe(15);
  });
});
