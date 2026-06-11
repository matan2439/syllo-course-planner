import {
  buildCompletionAnalysis,
  formatCompletionMessages,
  evaluatePlanCompleteness,
  scoreCandidate,
  pickBestCandidate,
  repairAddMissingElectives,
  DEGREE_REQUIRED_HOURS,
  DEFAULT_MAX_HOURS_PER_SEMESTER,
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

  it('reports satisfied category when placed covers the missing count', () => {
    const analysis = {
      ...baseAnalysis,
      categories: [{ name: 'בחירה', required: 1, placed: 0, missing: 1, candidates: [{ course_id: 'E1', name_he: 'אלקטיב' }] }],
    };
    const result = evaluatePlanCompleteness([{ semester_id: 's1', course_ids: ['E1'] }], analysis as any);
    expect(result.reasons.some(r => r.includes('הדרישה הושלמה'))).toBe(true);
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
