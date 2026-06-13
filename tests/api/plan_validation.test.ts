import {
  planProposalSchema,
  validatePlanProposal,
  normalizeSemesterId,
  normalizePlanProposal,
  droppedPlacementWarnings,
  type PlanProposal,
  type PlanValidationContext,
} from '../../api/ai/plan_validation';
import { getDegreeHoursStatus, isPlanApplyable, getPlanPreviewStatus } from '../../api/ai/completion_analysis';

const BASE_PROPOSAL: PlanProposal = {
  semesters: [
    { semester_id: 'year_3_semester_a', course_ids: ['0542-4120', '0542-4420'] },
    { semester_id: 'year_3_semester_b', course_ids: ['0542-4221'] },
  ],
  moves: [],
  warnings_he: [],
  rationale_he: 'תוכנית לדוגמה.',
  requirements_status: [],
};

const BASE_CTX: PlanValidationContext = {
  completedCourseIds: new Set(),
  courses: {
    '0542-4120': { hours: 5 },
    '0542-4420': { hours: 4 },
    '0542-4221': { hours: 5 },
  },
};

describe('planProposalSchema', () => {
  it('parses a well-formed proposal', () => {
    const result = planProposalSchema.safeParse(BASE_PROPOSAL);
    expect(result.success).toBe(true);
  });

  it('rejects a proposal missing required fields', () => {
    const result = planProposalSchema.safeParse({ semesters: [] });
    expect(result.success).toBe(false);
  });

  it('defaults optional arrays to empty', () => {
    const result = planProposalSchema.parse({
      semesters: [],
      rationale_he: 'אין שינויים.',
    });
    expect(result.moves).toEqual([]);
    expect(result.warnings_he).toEqual([]);
    expect(result.requirements_status).toEqual([]);
  });
});

describe('normalizeSemesterId', () => {
  it('passes through canonical ids unchanged', () => {
    expect(normalizeSemesterId('year_3_semester_a')).toBe('year_3_semester_a');
    expect(normalizeSemesterId('year_4_semester_b')).toBe('year_4_semester_b');
  });

  it('normalizes Hebrew semester labels', () => {
    expect(normalizeSemesterId("שנה ג׳ — סמסטר א׳")).toBe('year_3_semester_a');
    expect(normalizeSemesterId("שנה ד׳ — סמסטר ב׳")).toBe('year_4_semester_b');
  });

  it('normalizes loose Latin variants', () => {
    expect(normalizeSemesterId('Y3A')).toBe('year_3_semester_a');
    expect(normalizeSemesterId('year3-semesterB')).toBe('year_3_semester_b');
  });

  it('returns null for unrecognizable input', () => {
    expect(normalizeSemesterId('סמסטר קיץ')).toBeNull();
    expect(normalizeSemesterId('')).toBeNull();
    expect(normalizeSemesterId(null)).toBeNull();
  });
});

describe('normalizePlanProposal', () => {
  it('normalizes Hebrew semester ids and merges duplicates', () => {
    const proposal: PlanProposal = {
      semesters: [
        { semester_id: "שנה ג׳ — סמסטר א׳", course_ids: ['0542-4120'] },
        { semester_id: 'year_3_semester_a', course_ids: ['0542-4420'] },
        { semester_id: 'year_3_semester_b', course_ids: ['0542-4221'] },
      ],
      moves: [],
      warnings_he: [],
      rationale_he: 'x',
      requirements_status: [],
    };
    const { proposal: normalized, dropped } = normalizePlanProposal(proposal);
    expect(dropped).toEqual([]);
    const semA = normalized.semesters.find(s => s.semester_id === 'year_3_semester_a')!;
    expect(semA.course_ids.sort()).toEqual(['0542-4120', '0542-4420']);
  });

  it('drops placements with unrecognizable semester ids and reports them', () => {
    const proposal: PlanProposal = {
      semesters: [
        { semester_id: 'סמסטר קיץ', course_ids: ['0542-9999'] },
        { semester_id: 'year_3_semester_a', course_ids: ['0542-4120'] },
      ],
      moves: [],
      warnings_he: [],
      rationale_he: 'x',
      requirements_status: [],
    };
    const { proposal: normalized, dropped } = normalizePlanProposal(proposal);
    expect(dropped).toEqual([{ course_id: '0542-9999', raw_semester_id: 'סמסטר קיץ' }]);
    expect(normalized.semesters.find(s => s.semester_id === 'year_3_semester_a')!.course_ids).toEqual(['0542-4120']);
    expect(normalized.semesters.some(s => (s.course_ids as string[]).includes('0542-9999'))).toBe(false);
  });
});

describe('droppedPlacementWarnings', () => {
  it('produces a Hebrew warning per dropped course, using course names when available', () => {
    const warnings = droppedPlacementWarnings(
      [{ course_id: '0542-9999', raw_semester_id: 'סמסטר קיץ' }],
      { '0542-9999': 'קורס לדוגמה' },
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('קורס לדוגמה');
    expect(warnings[0]).toContain('0542-9999');
    expect(warnings[0]).toContain('סמסטר קיץ');
  });
});

describe('validatePlanProposal', () => {
  it('returns no errors/warnings for a valid plan', () => {
    const result = validatePlanProposal(BASE_PROPOSAL, BASE_CTX);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('rejects a plan that places the same course in two semesters', () => {
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      semesters: [
        { semester_id: 'year_3_semester_a', course_ids: ['0542-4120'] },
        { semester_id: 'year_3_semester_b', course_ids: ['0542-4120', '0542-4221'] },
      ],
    };
    const result = validatePlanProposal(proposal, BASE_CTX);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('0542-4120');
    expect(result.errors[0]).toContain('פעמיים');
  });

  it('rejects a plan that schedules a completed course', () => {
    const ctx: PlanValidationContext = {
      ...BASE_CTX,
      completedCourseIds: new Set(['0542-4120']),
    };
    const result = validatePlanProposal(BASE_PROPOSAL, ctx);
    expect(result.errors.some(e => e.includes('0542-4120') && e.includes('הושלם'))).toBe(true);
  });

  it('rejects placement outside effective_allowed_semesters', () => {
    const ctx: PlanValidationContext = {
      ...BASE_CTX,
      courses: {
        ...BASE_CTX.courses,
        '0542-4221': { hours: 5, effective_allowed_semesters: ['year_3_semester_a'] },
      },
    };
    // BASE_PROPOSAL places 0542-4221 in year_3_semester_b — not allowed
    const result = validatePlanProposal(BASE_PROPOSAL, ctx);
    expect(result.errors.some(e => e.includes('0542-4221') && e.includes('year_3_semester_a'))).toBe(true);
  });

  it('warns about unmet prerequisites without rejecting the plan', () => {
    const ctx: PlanValidationContext = {
      ...BASE_CTX,
      courses: {
        ...BASE_CTX.courses,
        '0542-4221': { hours: 5, missing_prerequisites: ['0542-9999'] },
      },
    };
    const result = validatePlanProposal(BASE_PROPOSAL, ctx);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some(w => w.includes('0542-4221') && w.includes('0542-9999'))).toBe(true);
  });

  it('does not warn about prerequisites already satisfied by completion or placement', () => {
    const ctx: PlanValidationContext = {
      ...BASE_CTX,
      completedCourseIds: new Set(['0542-4120']),
      courses: {
        '0542-4120': { hours: 5, effective_allowed_semesters: undefined },
        '0542-4420': { hours: 4, missing_prerequisites: ['0542-4120'] },
        '0542-4221': { hours: 5 },
      },
    };
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      semesters: [
        { semester_id: 'year_3_semester_a', course_ids: ['0542-4420'] },
        { semester_id: 'year_3_semester_b', course_ids: ['0542-4221'] },
      ],
    };
    const result = validatePlanProposal(proposal, ctx);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some(w => w.includes('0542-4420'))).toBe(false);
  });

  it('warns when a semester exceeds the configured max weekly hours', () => {
    const ctx: PlanValidationContext = { ...BASE_CTX, maxHoursPerSemester: 8 };
    const result = validatePlanProposal(BASE_PROPOSAL, ctx); // semester A = 5+4=9 hours
    expect(result.warnings.some(w => w.includes('year_3_semester_a') && w.includes('9'))).toBe(true);
  });

  it('blocks a plan when a semester severely exceeds the max weekly hours (more than +3)', () => {
    const ctx: PlanValidationContext = {
      completedCourseIds: new Set(),
      maxHoursPerSemester: 14,
      courses: {
        '0542-4120': { hours: 27 },
        '0542-4221': { hours: 5 },
      },
    };
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      semesters: [
        { semester_id: 'year_3_semester_a', course_ids: ['0542-4120'] },
        { semester_id: 'year_3_semester_b', course_ids: ['0542-4221'] },
      ],
    };
    const result = validatePlanProposal(proposal, ctx); // 27 > 14 + 3
    expect(result.errors.some(e => e.includes('עומס חורג משמעותית') && e.includes('27'))).toBe(true);
  });

  it('only warns when a semester mildly exceeds the max weekly hours (within +3)', () => {
    const ctx: PlanValidationContext = {
      completedCourseIds: new Set(),
      maxHoursPerSemester: 14,
      courses: {
        '0542-4120': { hours: 16 },
        '0542-4221': { hours: 5 },
      },
    };
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      semesters: [
        { semester_id: 'year_3_semester_a', course_ids: ['0542-4120'] },
        { semester_id: 'year_3_semester_b', course_ids: ['0542-4221'] },
      ],
    };
    const result = validatePlanProposal(proposal, ctx); // 16 <= 14 + 3
    expect(result.errors).toEqual([]);
    expect(result.warnings.some(w => w.includes('16') && w.includes('שעות שבועיות'))).toBe(true);
  });

  it('rejects a plan that omits not-completed mandatory courses', () => {
    const ctx: PlanValidationContext = {
      ...BASE_CTX,
      requiredMandatoryCourseIds: ['0542-4120', '0542-9001'], // 0542-9001 not in the plan
    };
    const result = validatePlanProposal(BASE_PROPOSAL, ctx);
    // PART C — exact missing mandatory course is named, no generic message.
    expect(result.errors.some(e => e.includes('קורס חובה חסר') && e.includes('0542-9001'))).toBe(true);
    expect(result.errors.some(e => e.includes('0542-4120'))).toBe(false);
  });

  it('rejects a plan that only adds wanted courses despite unmet category requirements', () => {
    const ctx: PlanValidationContext = {
      ...BASE_CTX,
      wantedCourseIds: ['0542-4120', '0542-4420', '0542-4221'], // = exactly all placed courses
      categoryRequirements: [{ name: 'קורסי בחירה', required: 10 }],
    };
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      requirements_status: [
        { name: 'קורסי בחירה', required: 10, placed: 0, satisfied: false },
      ],
    };
    const result = validatePlanProposal(proposal, ctx);
    expect(result.errors.some(e => e.includes('התוכנית חלקית'))).toBe(true);
  });

  it('does not flag "wanted-only" partial plan when extra electives were added', () => {
    const ctx: PlanValidationContext = {
      ...BASE_CTX,
      wantedCourseIds: ['0542-4120'],
    };
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL, // also places 0542-4420 and 0542-4221, neither wanted nor mandatory
      requirements_status: [
        { name: 'קורסי בחירה', required: 10, placed: 4, satisfied: false },
      ],
    };
    const result = validatePlanProposal(proposal, ctx);
    expect(result.errors.some(e => e.includes('התוכנית חלקית'))).toBe(false);
  });

  it('warns about a specific category when electives are unmet but available', () => {
    const ctx: PlanValidationContext = {
      ...BASE_CTX,
      categoryRequirements: [
        { name: 'מערכות בקרה', required: 2, availableElectiveIds: ['0542-9100', '0542-9101'] },
      ],
    };
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      requirements_status: [
        { name: 'מערכות בקרה', required: 2, placed: 0, satisfied: false },
      ],
    };
    const result = validatePlanProposal(proposal, ctx);
    expect(result.warnings.some(w => w.includes('חסרים קורסי בחירה בקטגוריה מערכות בקרה'))).toBe(true);
  });

  it('blocks overload as "did not balance" when movable courses exist in the overloaded semester', () => {
    const ctx: PlanValidationContext = {
      completedCourseIds: new Set(),
      maxHoursPerSemester: 14,
      movableCourseIds: new Set(['0542-4221']),
      courses: {
        '0542-4120': { hours: 22 },
        '0542-4221': { hours: 5 },
      },
    };
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      semesters: [
        { semester_id: 'year_3_semester_a', course_ids: ['0542-4120', '0542-4221'] },
      ],
    };
    const result = validatePlanProposal(proposal, ctx); // 27 > 14 + 3, and 0542-4221 is movable
    expect(result.errors.some(e => e.includes('לא איזנה עומס'))).toBe(true);
  });

  it('does not block on overload when no max weekly hours is configured', () => {
    const ctx: PlanValidationContext = {
      completedCourseIds: new Set(),
      courses: {
        '0542-4120': { hours: 27 },
        '0542-4221': { hours: 5 },
      },
    };
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      semesters: [
        { semester_id: 'year_3_semester_a', course_ids: ['0542-4120'] },
        { semester_id: 'year_3_semester_b', course_ids: ['0542-4221'] },
      ],
    };
    const result = validatePlanProposal(proposal, ctx);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('rejects a plan that moves a pinned course out of its current semester', () => {
    const ctx: PlanValidationContext = {
      ...BASE_CTX,
      pinnedCourseIds: new Set(['0542-4221']),
      currentSemesterByCourseId: { '0542-4221': 'year_3_semester_a' },
    };
    // BASE_PROPOSAL places 0542-4221 in year_3_semester_b, but it's pinned to year_3_semester_a
    const result = validatePlanProposal(BASE_PROPOSAL, ctx);
    expect(result.errors.some(e => e.includes('0542-4221') && e.includes("אל תזיז"))).toBe(true);
  });

  it('allows a pinned course that stays in its current semester', () => {
    const ctx: PlanValidationContext = {
      ...BASE_CTX,
      pinnedCourseIds: new Set(['0542-4120']),
      currentSemesterByCourseId: { '0542-4120': 'year_3_semester_a' },
    };
    // BASE_PROPOSAL places 0542-4120 in year_3_semester_a — matches its current semester
    const result = validatePlanProposal(BASE_PROPOSAL, ctx);
    expect(result.errors.some(e => e.includes("אל תזיז"))).toBe(false);
  });

  it('warns when a category requirement is not satisfied', () => {
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      requirements_status: [
        { name: 'קורסי בחירה', required: 10, placed: 4, satisfied: false },
      ],
    };
    const result = validatePlanProposal(proposal, BASE_CTX);
    expect(result.warnings.some(w => w.includes('קורסי בחירה') && w.includes('4/10'))).toBe(true);
  });

  it('does not show a stale "שעות/נקודות שנותרו" requirement when the degree-hour model is satisfied (PART A/E)', () => {
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      requirements_status: [
        { name: 'שעות/נקודות שנותרו', required: 49, placed: 0, satisfied: false },
      ],
    };
    const ctx: PlanValidationContext = { ...BASE_CTX, degreeHoursSatisfied: true };
    const result = validatePlanProposal(proposal, ctx);
    expect(result.warnings.some(w => w.includes('שנותרו') || w.includes('0/49'))).toBe(false);
  });

  it('still shows "שעות/נקודות שנותרו" when the degree-hour model is NOT satisfied', () => {
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      requirements_status: [
        { name: 'שעות/נקודות שנותרו', required: 49, placed: 0, satisfied: false },
      ],
    };
    const ctx: PlanValidationContext = { ...BASE_CTX, degreeHoursSatisfied: false };
    const result = validatePlanProposal(proposal, ctx);
    expect(result.warnings.some(w => w.includes('שנותרו'))).toBe(true);
  });
});

describe('PART B/F — getDegreeHoursStatus single source of truth', () => {
  function makeAnalysis(overrides: any = {}): any {
    return {
      scheduled_course_ids: [],
      hours: {
        known_total_hours: 95,
        required_total: 185,
        ...overrides,
      },
    };
  }

  it('1. completed_degree_hours=95 and proposed_plan_hours=90 satisfies 185', () => {
    const analysis = makeAnalysis();
    const proposalSemesters = [{ course_ids: ['A', 'B'] }];
    const courseHours = { A: 45, B: 45 };
    const status = getDegreeHoursStatus(analysis, proposalSemesters, courseHours);
    expect(status.completed_degree_hours).toBe(95);
    expect(status.proposed_plan_hours).toBe(90);
    expect(status.total_after_plan).toBe(185);
    expect(status.degree_required_hours).toBe(185);
    expect(status.missing_hours).toBe(0);
    expect(status.satisfied).toBe(true);
  });

  it('4. if general requirement reaches 6/6, total_after_plan includes all 6 credits', () => {
    // 89 known + 2 already-scheduled שער רוח (not double-counted) + 4 newly added = 95+... -> 185
    const analysis = makeAnalysis({ known_total_hours: 181 });
    const proposalSemesters = [{ course_ids: ['G1', 'G2'] }]; // 2 newly-added שער רוח courses, 2 נק"ז each
    const courseHours = { G1: 2, G2: 2 };
    const status = getDegreeHoursStatus(analysis, proposalSemesters, courseHours);
    expect(status.total_after_plan).toBe(185);
    expect(status.satisfied).toBe(true);
    expect(status.missing_hours).toBe(0);
  });

  it('5. no double-counting when a שער רוח course is already scheduled (excluded via scheduled_course_ids)', () => {
    const analysis: any = {
      scheduled_course_ids: ['G1'],
      hours: { known_total_hours: 183, required_total: 185 },
    };
    const proposalSemesters = [{ course_ids: ['G1', 'G2'] }];
    const courseHours = { G1: 2, G2: 2 };
    const status = getDegreeHoursStatus(analysis, proposalSemesters, courseHours);
    // G1 already counted in known_total_hours (183); only G2's 2 credits are "new".
    expect(status.proposed_plan_hours).toBe(2);
    expect(status.total_after_plan).toBe(185);
    expect(status.satisfied).toBe(true);
  });
});

describe('PART D/F — applyability and top status with 185/185 + complete requirements', () => {
  it('6/7. applyable plan with 185/185, mandatory complete, categories complete, שער רוח complete is applyable and not red', () => {
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      requirements_status: [
        { name: 'שעות/נקודות שנותרו', required: 49, placed: 0, satisfied: false },
      ],
    };
    const ctx: PlanValidationContext = {
      ...BASE_CTX,
      requiredMandatoryCourseIds: ['0542-4120', '0542-4420', '0542-4221'], // all present in BASE_PROPOSAL
      degreeHoursSatisfied: true,
    };
    const { errors, warnings } = validatePlanProposal(proposal, ctx);
    expect(errors).toEqual([]);
    expect(warnings.some(w => w.includes('שנותרו'))).toBe(false);

    const completeness = { incomplete: false, reasons: [] as string[], added_electives: 0, proposed_total_hours: 185 };
    expect(isPlanApplyable(errors, completeness)).toBe(true);
    const status = getPlanPreviewStatus(errors, completeness, 'התוכנית מוכנה');
    expect(status.kind).not.toBe('error');
  });
});

describe('Request A PART E — "אפשר חריגה בעומס" override (overloadAccepted)', () => {
  const OVERLOAD_CTX: PlanValidationContext = {
    completedCourseIds: new Set(),
    maxHoursPerSemester: 14,
    courses: {
      '0542-4120': { hours: 27 },
      '0542-4221': { hours: 5 },
    },
  };
  const OVERLOAD_PROPOSAL: PlanProposal = {
    ...BASE_PROPOSAL,
    semesters: [
      { semester_id: 'year_3_semester_a', course_ids: ['0542-4120'] },
      { semester_id: 'year_3_semester_b', course_ids: ['0542-4221'] },
    ],
  };

  it('1. enables Apply when overload is the only blocker and the user accepted it', () => {
    const without = validatePlanProposal(OVERLOAD_PROPOSAL, OVERLOAD_CTX);
    expect(without.errors.length).toBeGreaterThan(0); // blocked without override

    const ctx: PlanValidationContext = { ...OVERLOAD_CTX, overloadAccepted: true };
    const result = validatePlanProposal(OVERLOAD_PROPOSAL, ctx);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some(w => w.includes('חריגה בעומס שאושרה ידנית'))).toBe(true);

    const completeness = { incomplete: false, reasons: [] as string[], added_electives: 0, proposed_total_hours: 185 };
    expect(isPlanApplyable(result.errors, completeness)).toBe(true);
  });

  it('2a. does not bypass a missing mandatory course even with overloadAccepted', () => {
    const ctx: PlanValidationContext = {
      ...OVERLOAD_CTX,
      overloadAccepted: true,
      requiredMandatoryCourseIds: ['0542-9001'],
    };
    const result = validatePlanProposal(OVERLOAD_PROPOSAL, ctx);
    expect(result.errors.some(e => e.includes('קורס חובה חסר') && e.includes('0542-9001'))).toBe(true);
  });

  it('2b. does not bypass illegal placement (outside effective_allowed_semesters) even with overloadAccepted', () => {
    const ctx: PlanValidationContext = {
      ...OVERLOAD_CTX,
      overloadAccepted: true,
      courses: {
        ...OVERLOAD_CTX.courses,
        '0542-4221': { hours: 5, effective_allowed_semesters: ['year_3_semester_a'] },
      },
    };
    const result = validatePlanProposal(OVERLOAD_PROPOSAL, ctx);
    expect(result.errors.some(e => e.includes('0542-4221') && e.includes('year_3_semester_a'))).toBe(true);
  });

  it('2c. does not bypass a completed course scheduled again even with overloadAccepted', () => {
    const ctx: PlanValidationContext = {
      ...OVERLOAD_CTX,
      overloadAccepted: true,
      completedCourseIds: new Set(['0542-4221']),
    };
    const result = validatePlanProposal(OVERLOAD_PROPOSAL, ctx);
    expect(result.errors.some(e => e.includes('0542-4221') && e.includes('הושלם'))).toBe(true);
  });

  it('8. overloadAccepted is a per-request validation flag, not a permanent change to maxHoursPerSemester', () => {
    const ctx: PlanValidationContext = { ...OVERLOAD_CTX, overloadAccepted: true };
    const result = validatePlanProposal(OVERLOAD_PROPOSAL, ctx);
    expect(result.errors).toEqual([]);
    // the configured cap itself is untouched — only the error→warning downgrade changed
    expect(ctx.maxHoursPerSemester).toBe(14);
  });
});
