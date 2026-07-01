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

  it('Scenario B — rejects a plan that re-proposes a currently_taking/planned course', () => {
    const ctx: PlanValidationContext = {
      ...BASE_CTX,
      currentlyPlannedCourseIds: new Set(['0542-4120']),
    };
    const result = validatePlanProposal(BASE_PROPOSAL, ctx);
    expect(result.errors.some(e => e.includes('0542-4120') && e.includes('מתוכנן/נלמד'))).toBe(true);
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

  it('Issue 4 — REJECTS (error) a course whose prerequisite is neither completed nor scheduled', () => {
    const ctx: PlanValidationContext = {
      ...BASE_CTX,
      courses: {
        ...BASE_CTX.courses,
        '0542-4221': { hours: 5, missing_prerequisites: ['0542-9999'] },
      },
    };
    const result = validatePlanProposal(BASE_PROPOSAL, ctx);
    // Strict prerequisite rule: an unsatisfied prereq is a blocking ERROR
    // (no longer a soft warning), naming the missing prereq.
    expect(result.errors.some(e => e.includes('0542-4221') && e.includes('0542-9999'))).toBe(true);
  });

  it('Issue 4 — unions prerequisites ∪ missing_prerequisites and rejects same-semester prereq', () => {
    const ctx: PlanValidationContext = {
      ...BASE_CTX,
      courses: {
        ...BASE_CTX.courses,
        // prereq supplied only via `prerequisites` (not missing_prerequisites)
        '0542-4221': { hours: 5, prerequisites: ['0542-4120'] },
        '0542-4120': { hours: 4 },
      },
    };
    // Both placed in the SAME semester (year_3_semester_b in BASE_PROPOSAL):
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      semesters: [
        { semester_id: 'year_3_semester_a', course_ids: [] },
        { semester_id: 'year_3_semester_b', course_ids: ['0542-4221', '0542-4120'] },
      ],
    };
    const result = validatePlanProposal(proposal, ctx);
    expect(result.errors.some(e => e.includes('0542-4221') && e.includes('0542-4120') && e.includes('באותו סמסטר'))).toBe(true);
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

  it('Phase 2C — 23h warns (mild overload above SOFT_LOAD_MAX=22)', () => {
    const ctx: PlanValidationContext = {
      completedCourseIds: new Set(),
      courses: { A: { hours: 23 } },
    };
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      semesters: [
        { semester_id: 'year_3_semester_a', course_ids: ['A'] },
      ],
    };
    const result = validatePlanProposal(proposal, ctx);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some(w => w.includes('23') && w.includes('מעל הטווח המומלץ'))).toBe(true);
  });

  it('Phase 2C — 26h warns (boundary, equals HARD_LOAD_CAP)', () => {
    const ctx: PlanValidationContext = {
      completedCourseIds: new Set(),
      courses: { A: { hours: 26 } },
    };
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['A'] }],
    };
    const result = validatePlanProposal(proposal, ctx);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some(w => w.includes('26'))).toBe(true);
  });

  it('Phase 2C — 27h blocks without overload acceptance (> HARD_LOAD_CAP)', () => {
    const ctx: PlanValidationContext = {
      completedCourseIds: new Set(),
      courses: { A: { hours: 27 } },
    };
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['A'] }],
    };
    const result = validatePlanProposal(proposal, ctx);
    expect(result.errors.some(e => e.includes('27') && e.includes('המגבלה הקשיחה'))).toBe(true);
  });

  it('Phase 2C — 27h blocks when overloadAccepted=true but no confirmation timestamp', () => {
    const ctx: PlanValidationContext = {
      completedCourseIds: new Set(),
      overloadAccepted: true,
      // overloadConfirmedAt intentionally NOT set
      courses: { A: { hours: 27 } },
    };
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['A'] }],
    };
    const result = validatePlanProposal(proposal, ctx);
    expect(result.errors.some(e => e.includes('המגבלה הקשיחה'))).toBe(true);
  });

  it('Phase 2C — 27h with overloadAccepted + overloadConfirmedAt downgrades to warning ("אושרה ידנית")', () => {
    const ctx: PlanValidationContext = {
      completedCourseIds: new Set(),
      overloadAccepted: true, overloadConfirmedAt: Date.now(),
      courses: { A: { hours: 27 } },
    };
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['A'] }],
    };
    const result = validatePlanProposal(proposal, ctx);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some(w => w.includes('אושרה ידנית'))).toBe(true);
  });

  it('Phase 2C — 31h is always an error, even with overloadAccepted + overloadConfirmedAt', () => {
    const ctx: PlanValidationContext = {
      completedCourseIds: new Set(),
      overloadAccepted: true, overloadConfirmedAt: Date.now(),
      courses: { A: { hours: 31 } },
    };
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['A'] }],
    };
    const result = validatePlanProposal(proposal, ctx);
    expect(result.errors.some(e => e.includes('חריגה לא סבירה') && e.includes('31'))).toBe(true);
  });

  it('Phase 2C — 22h or below produces no overload message', () => {
    const ctx: PlanValidationContext = {
      completedCourseIds: new Set(),
      courses: { A: { hours: 22 }, B: { hours: 5 } },
    };
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      semesters: [
        { semester_id: 'year_3_semester_a', course_ids: ['A'] },
        { semester_id: 'year_3_semester_b', course_ids: ['B'] },
      ],
    };
    const result = validatePlanProposal(proposal, ctx);
    expect(result.errors).toEqual([]);
    expect(result.warnings.filter(w => w.includes('שעות שבועיות'))).toEqual([]);
  });

  // Phase 1b — hardCap/softLoadMax/absoluteMaxReasonable are now sourced from
  // ctx (populated from ConstraintModel), falling back to load_constants.ts's
  // defaults when ctx omits them — so a different PolicyProvider/program can
  // override thresholds without editing this shared file.
  it('Phase 1b — a raised ctx.hardCap lets 27h through (no longer blocks at the default 26)', () => {
    const ctx: PlanValidationContext = {
      completedCourseIds: new Set(),
      hardCap: 40,
      courses: { A: { hours: 27 } },
    };
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['A'] }],
    };
    const result = validatePlanProposal(proposal, ctx);
    expect(result.errors).toEqual([]);
  });

  it('Phase 1b — a raised ctx.absoluteMaxReasonable lets 31h through (no longer always-blocking at the default 30)', () => {
    const ctx: PlanValidationContext = {
      completedCourseIds: new Set(),
      hardCap: 40, absoluteMaxReasonable: 50,
      overloadAccepted: true, overloadConfirmedAt: Date.now(),
      courses: { A: { hours: 31 } },
    };
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['A'] }],
    };
    const result = validatePlanProposal(proposal, ctx);
    expect(result.errors).toEqual([]);
  });

  it('Phase 1b — a lowered ctx.softLoadMax produces the mild-overload warning earlier than the default 22', () => {
    const ctx: PlanValidationContext = {
      completedCourseIds: new Set(),
      softLoadMax: 5,
      courses: { A: { hours: 10 } },
    };
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['A'] }],
    };
    const result = validatePlanProposal(proposal, ctx);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some(w => w.includes('10') && w.includes('מעל הטווח המומלץ'))).toBe(true);
  });

  it('Phase 1b — omitting hardCap/softLoadMax/absoluteMaxReasonable from ctx falls back to load_constants.ts defaults (no behavior change)', () => {
    // Identical scenario to "27h blocks without overload acceptance" above, with ctx
    // omitting the new fields entirely — pins that the default path is unchanged.
    const ctx: PlanValidationContext = {
      completedCourseIds: new Set(),
      courses: { A: { hours: 27 } },
    };
    const proposal: PlanProposal = {
      ...BASE_PROPOSAL,
      semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['A'] }],
    };
    const result = validatePlanProposal(proposal, ctx);
    expect(result.errors.some(e => e.includes('27') && e.includes('המגבלה הקשיחה'))).toBe(true);
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

  it('Phase 2C — 27h is blocked even without maxHoursPerSemester (HARD_LOAD_CAP is global)', () => {
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
    expect(result.errors.some(e => e.includes('המגבלה הקשיחה'))).toBe(true);
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

    const ctx: PlanValidationContext = { ...OVERLOAD_CTX, overloadAccepted: true, overloadConfirmedAt: Date.now() };
    const result = validatePlanProposal(OVERLOAD_PROPOSAL, ctx);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some(w => w.includes('חריגה בעומס שאושרה ידנית'))).toBe(true);

    const completeness = { incomplete: false, reasons: [] as string[], added_electives: 0, proposed_total_hours: 185 };
    expect(isPlanApplyable(result.errors, completeness)).toBe(true);
  });

  it('2a. does not bypass a missing mandatory course even with overloadAccepted', () => {
    const ctx: PlanValidationContext = {
      ...OVERLOAD_CTX,
      overloadAccepted: true, overloadConfirmedAt: Date.now(),
      requiredMandatoryCourseIds: ['0542-9001'],
    };
    const result = validatePlanProposal(OVERLOAD_PROPOSAL, ctx);
    expect(result.errors.some(e => e.includes('קורס חובה חסר') && e.includes('0542-9001'))).toBe(true);
  });

  it('2b. does not bypass illegal placement (outside effective_allowed_semesters) even with overloadAccepted', () => {
    const ctx: PlanValidationContext = {
      ...OVERLOAD_CTX,
      overloadAccepted: true, overloadConfirmedAt: Date.now(),
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
      overloadAccepted: true, overloadConfirmedAt: Date.now(),
      completedCourseIds: new Set(['0542-4221']),
    };
    const result = validatePlanProposal(OVERLOAD_PROPOSAL, ctx);
    expect(result.errors.some(e => e.includes('0542-4221') && e.includes('הושלם'))).toBe(true);
  });

  it('8. overloadAccepted is a per-request validation flag, not a permanent change to maxHoursPerSemester', () => {
    const ctx: PlanValidationContext = { ...OVERLOAD_CTX, overloadAccepted: true, overloadConfirmedAt: Date.now() };
    const result = validatePlanProposal(OVERLOAD_PROPOSAL, ctx);
    expect(result.errors).toEqual([]);
    // the configured cap itself is untouched — only the error→warning downgrade changed
    expect(ctx.maxHoursPerSemester).toBe(14);
  });
});

// ── Dynamic semester IDs ──────────────────────────────────────────────────────

describe('normalizePlanProposal — knownSemesterIds option', () => {
  it('keeps a non-KNOWN semester when it is in knownSemesterIds', () => {
    const proposal: PlanProposal = {
      semesters: [{ semester_id: 'year_2_semester_a', course_ids: ['EARLY'] }],
      moves: [], warnings_he: [], rationale_he: '', requirements_status: [],
    };
    const { proposal: norm, dropped } = normalizePlanProposal(proposal, { knownSemesterIds: ['year_2_semester_a', 'year_3_semester_a'] });
    expect(dropped).toHaveLength(0);
    const sem = norm.semesters.find(s => s.semester_id === 'year_2_semester_a');
    expect(sem).toBeDefined();
    expect(sem?.course_ids).toContain('EARLY');
  });

  it('drops a course in a semester not in knownSemesterIds', () => {
    const proposal: PlanProposal = {
      semesters: [{ semester_id: 'year_2_semester_a', course_ids: ['EARLY'] }],
      moves: [], warnings_he: [], rationale_he: '', requirements_status: [],
    };
    // default knownSemesterIds = KNOWN_SEMESTER_IDS (years 3-4 only)
    const { dropped } = normalizePlanProposal(proposal);
    expect(dropped.map(d => d.course_id)).toContain('EARLY');
  });
});

describe('validatePlanState — dynamic knownSemesterIds via model', () => {
  it('validates courses in year_2_semester_a when model includes that semester', () => {
    // This test exercises the planner_validate path — import buildValidationContext
    // and validatePlanState directly to confirm year_2 semester is not silently dropped.
    const { validatePlanState, buildValidationContext } = require('../../api/ai/planner_validate');
    const { emptyState } = require('../../api/ai/planner_types');

    const knownSemesterIds = ['year_2_semester_a', 'year_3_semester_a', 'year_3_semester_b', 'year_4_semester_a', 'year_4_semester_b'];
    const profiles = new Map();
    profiles.set('EARLY', {
      course_id: 'EARLY', hours: 3, is_mandatory: true, prerequisites: [],
      effective_allowed_semesters: ['year_2_semester_a'],
    });

    const model: any = {
      profiles, knownSemesterIds,
      completedCourseIds: new Set(),
      requiredMandatoryCourseIds: ['EARLY'],
      categories: [], degreeRequiredHours: 3, priorHours: 0,
      maxHoursPerSemester: 22, hardCap: 26,
      disallowedCourseIds: new Set(), pinnedCourseIds: new Set(), wantedCourseIds: new Set(),
    };

    const state = emptyState(knownSemesterIds);
    state.semesters['year_2_semester_a'] = ['EARLY'];

    // Without dynamic semester IDs, validatePlanState would not check year_2_semester_a courses.
    // With the fix, the proposal built from model.knownSemesterIds includes year_2_semester_a.
    const result = validatePlanState(state, model, {});
    // EARLY is placed in its only legal semester — no errors expected
    expect(result.errors).toHaveLength(0);
  });
});
