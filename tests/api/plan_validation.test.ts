import {
  planProposalSchema,
  validatePlanProposal,
  normalizeSemesterId,
  normalizePlanProposal,
  droppedPlacementWarnings,
  type PlanProposal,
  type PlanValidationContext,
} from '../../api/ai/plan_validation';

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
});
