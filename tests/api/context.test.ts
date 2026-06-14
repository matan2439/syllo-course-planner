import {
  buildSystemPrompt,
  computeSemesterLoads,
  checkPrerequisites,
  findMissingDegreeRequirements,
  type PlanContext,
  type SemesterPlan,
} from '../../api/ai/_context';

const SEMESTER_A: SemesterPlan = {
  id: 'year_3_semester_a',
  label: "שנה ג׳ — סמסטר א׳",
  total_hours: 14,
  courses: [
    { course_id: '0542-4420', name_he: 'תורת המכונות', hours: 4, difficulty_level: 'medium', course_type: 'elective' },
    { course_id: '0542-4120', name_he: 'חשבון 1', hours: 5, course_type: 'mandatory' },
    {
      course_id: '0542-4320',
      name_he: 'מכניקת מוצקים',
      hours: 5,
      course_type: 'elective',
      missing_prerequisites: ['0542-4120'],
    },
  ],
};

const SEMESTER_B: SemesterPlan = {
  id: 'year_3_semester_b',
  label: "שנה ג׳ — סמסטר ב׳",
  total_hours: 5,
  courses: [
    { course_id: '0542-4221', name_he: 'דינמיקה', hours: 5, course_type: 'mandatory' },
  ],
};

const PLAN_CONTEXT: PlanContext = {
  program_name: 'הנדסה מכנית',
  semesters: [SEMESTER_A, SEMESTER_B],
  mandatory_unplaced: [{ course_id: '0542-4500', name_he: 'פרויקט גמר', hours: 6 }],
  requirements_progress: {
    completed_hours: 19,
    required_hours: 185,
    categories: [
      { name: 'קורסי ליבה', required: 6, placed: 2 },
      { name: 'קורסי בחירה', required: 10, placed: 1 },
    ],
  },
  prerequisite_issues: [
    { course_id: '0542-4320', name_he: 'מכניקת מוצקים', missing: ['0542-4120'] },
  ],
  grade_signals: {
    '0542-4420': { average_grade: 60.6, num_students_total: 2472 },
  },
};

describe('buildSystemPrompt', () => {
  it('includes program name', () => {
    const prompt = buildSystemPrompt({ program_id: 'mechanical_2027', plan_context: PLAN_CONTEXT });
    expect(prompt).toContain('הנדסה מכנית');
  });

  it('includes course names and IDs', () => {
    const prompt = buildSystemPrompt({ program_id: 'mechanical_2027', plan_context: PLAN_CONTEXT });
    expect(prompt).toContain('תורת המכונות');
    expect(prompt).toContain('0542-4420');
  });

  it('includes mandatory unplaced courses', () => {
    const prompt = buildSystemPrompt({ program_id: 'mechanical_2027', plan_context: PLAN_CONTEXT });
    expect(prompt).toContain('פרויקט גמר');
  });

  it('includes prerequisite issues', () => {
    const prompt = buildSystemPrompt({ program_id: 'mechanical_2027', plan_context: PLAN_CONTEXT });
    expect(prompt).toContain('מכניקת מוצקים');
    expect(prompt).toContain('0542-4120');
  });

  it('includes requirements progress', () => {
    const prompt = buildSystemPrompt({ program_id: 'mechanical_2027', plan_context: PLAN_CONTEXT });
    expect(prompt).toContain('19');
    expect(prompt).toContain('185');
  });

  it('includes grade signals', () => {
    const prompt = buildSystemPrompt({ program_id: 'mechanical_2027', plan_context: PLAN_CONTEXT });
    expect(prompt).toContain('60.6');
    expect(prompt).toContain('2472');
  });

  it('includes personal status — completed, currently taking, planned', () => {
    const ctx: PlanContext = {
      ...PLAN_CONTEXT,
      personal_status: {
        completed:        [{ course_id: '0542-4120', name_he: 'חשבון 1' }],
        currently_taking: [{ course_id: '0542-4220', name_he: 'מכניקת הזורמים (1)', semester_label: "שנה ג׳ — סמסטר א׳" }],
        planned:          [{ course_id: '0542-4221', name_he: 'דינמיקה', semester_label: "שנה ג׳ — סמסטר ב׳" }],
      },
    };
    const prompt = buildSystemPrompt({ program_id: 'mechanical_2027', plan_context: ctx });
    expect(prompt).toContain('חשבון 1');
    expect(prompt).toContain('מכניקת הזורמים (1)');
    expect(prompt).toContain('דינמיקה');
    expect(prompt).toContain("שנה ג׳ — סמסטר א׳");
  });

  it('reports no personal status when none provided', () => {
    const prompt = buildSystemPrompt({ program_id: 'mechanical_2027', plan_context: PLAN_CONTEXT });
    expect(prompt).toContain('לא הוזן מידע אישי');
  });

  it('includes personal prerequisite issues', () => {
    const ctx: PlanContext = {
      ...PLAN_CONTEXT,
      personal_prerequisite_issues: [
        {
          course_id: '0542-4320',
          name_he: 'מכניקת מוצקים',
          issues: ['הקורס חשבון 1 נלמד עכשיו ולכן יכול לשמש כדרישת קדם רק מסמסטר הבא.'],
        },
      ],
    };
    const prompt = buildSystemPrompt({ program_id: 'mechanical_2027', plan_context: ctx });
    expect(prompt).toContain('מכניקת מוצקים');
    expect(prompt).toContain('נלמד עכשיו ולכן יכול לשמש כדרישת קדם רק מסמסטר הבא');
  });

  it('includes course-specific context when provided', () => {
    const prompt = buildSystemPrompt({
      program_id: 'mechanical_2027',
      plan_context: PLAN_CONTEXT,
      course_context: 'קורס ייחודי עם מעבדה',
    });
    expect(prompt).toContain('קורס ייחודי עם מעבדה');
  });

  it('renders semester/lecture/tutorial/lab hours and teaching format from course_context', () => {
    const courseContext = [
      'קוד קורס: 0512-1202',
      'שם קורס: אלקטרוניקה בסיסית',
      'שעות שבועיות: לא ידוע (שעות סמסטריאליות: 2)',
      'שעות מעבדה: 4',
      'אופן הוראה: הרצאה + מעבדה',
    ].join('\n');
    const prompt = buildSystemPrompt({
      program_id: 'mechanical_2027',
      plan_context: PLAN_CONTEXT,
      course_context: courseContext,
    });
    expect(prompt).toContain('שעות סמסטריאליות: 2');
    expect(prompt).toContain('שעות מעבדה: 4');
    expect(prompt).toContain('אופן הוראה: הרצאה + מעבדה');
  });

  it('prepends a deterministic workload summary when course_context has hours/syllabus data', () => {
    const courseContext = [
      'קוד קורס: 0512-1202',
      'שם קורס: אלקטרוניקה בסיסית',
      'היקף לפי הסילבוס: 2 שעות סמסטריאליות (שעות שבועיות לא צוינו)',
      'שעות מעבדה: 4',
      'אופן הוראה: הרצאה + מעבדה',
      'תקציר סילבוס: הקורס עוסק במגברים אופרטיביים...',
    ].join('\n');
    const prompt = buildSystemPrompt({
      program_id: 'mechanical_2027',
      plan_context: PLAN_CONTEXT,
      course_context: courseContext,
    });
    expect(prompt).toContain('סיכום נתוני עומס לקורס זה');
    expect(prompt).toContain('4 שעות מעבדה');
    expect(prompt).toContain('הרצאה + מעבדה');
    expect(prompt).toContain('2 שעות סמסטריאליות');
  });

  it('instructs the model not to treat missing difficulty_score as missing workload evidence', () => {
    const prompt = buildSystemPrompt({ program_id: 'mechanical_2027', plan_context: PLAN_CONTEXT });
    expect(prompt).toContain('אין מדד קושי מספרי');
    expect(prompt).toContain('אין מידע על העומס');
  });

  it('does not contain any API keys or secrets', () => {
    const prompt = buildSystemPrompt({ program_id: 'mechanical_2027', plan_context: PLAN_CONTEXT });
    expect(prompt).not.toMatch(/sk-ant-/);
    expect(prompt).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
    expect(prompt).not.toMatch(/ANTHROPIC_API_KEY/);
  });

  it('handles empty plan gracefully', () => {
    const emptyCtx: PlanContext = { semesters: [] };
    const prompt = buildSystemPrompt({ program_id: 'test', plan_context: emptyCtx });
    expect(prompt).toContain('אין קורסים משובצים עדיין');
  });

  it('flags overloaded semesters (>=16 hours)', () => {
    const heavyCtx: PlanContext = {
      semesters: [{
        id: 'year_3_semester_a', label: "שנה ג׳ — סמסטר א׳", total_hours: 18,
        courses: [{ course_id: '0542-4420', name_he: 'תורת המכונות', hours: 18, course_type: 'mandatory' }],
      }],
    };
    const prompt = buildSystemPrompt({ program_id: 'test', plan_context: heavyCtx });
    expect(prompt).toContain('עומס גבוה');
  });

  it('does not flag light semesters (<16 hours)', () => {
    const lightCtx: PlanContext = {
      semesters: [{
        id: 'year_3_semester_a', label: "שנה ג׳ — סמסטר א׳", total_hours: 5,
        courses: [{ course_id: '0542-4420', name_he: 'תורת המכונות', hours: 5, course_type: 'elective' }],
      }],
    };
    const prompt = buildSystemPrompt({ program_id: 'test', plan_context: lightCtx });
    expect(prompt).not.toContain('ש"ש סה"כ) ⚠ עומס גבוה');
  });

  it('includes difficulty sub-scores when provided', () => {
    const ctx: PlanContext = {
      semesters: [{
        id: 'year_3_semester_a', label: "שנה ג׳ — סמסטר א׳", total_hours: 5,
        courses: [{
          course_id: '0542-4420', name_he: 'תורת המכונות', hours: 5, course_type: 'elective',
          workload_score: 4, conceptual_complexity_score: 5, prerequisite_depth_score: 2,
          assessment_intensity_score: 3,
        }],
      }],
    };
    const prompt = buildSystemPrompt({ program_id: 'test', plan_context: ctx });
    expect(prompt).toContain('עומס 4');
    expect(prompt).toContain('מורכבות 5');
    expect(prompt).toContain('עומק דרישות קדם 2');
    expect(prompt).toContain('עצימות הערכה 3');
  });

  it('flags missing syllabus and low-confidence difficulty data', () => {
    const ctx: PlanContext = {
      semesters: [{
        id: 'year_3_semester_a', label: "שנה ג׳ — סמסטר א׳", total_hours: 5,
        courses: [{
          course_id: '0542-4420', name_he: 'תורת המכונות', hours: 5, course_type: 'elective',
          has_syllabus: false, difficulty_confidence: 0.3,
        }],
      }],
    };
    const prompt = buildSystemPrompt({ program_id: 'test', plan_context: ctx });
    expect(prompt).toContain('אין סילבוס זמין');
    expect(prompt).toContain('אמינות נמוכה');
  });

  it('includes median grade and pass rate in grade signals', () => {
    const ctx: PlanContext = {
      ...PLAN_CONTEXT,
      grade_signals: {
        '0542-4420': { average_grade: 60.6, median_grade: 62, pass_rate: 0.85, num_students_total: 2472 },
      },
    };
    const prompt = buildSystemPrompt({ program_id: 'test', plan_context: ctx });
    expect(prompt).toContain('חציון 62');
    expect(prompt).toContain('85%');
  });

  // PART F — general AI chat must receive the same board state + diagnostics
  // as requestPlanProposal, plus the user's wanted/avoided/pinned preferences.
  it('includes board semesters and diagnostics for chat context', () => {
    const prompt = buildSystemPrompt({ program_id: 'mechanical_2027', plan_context: PLAN_CONTEXT });
    expect(prompt).toContain("שנה ג׳ — סמסטר א׳");
    expect(prompt).toContain('תורת המכונות');
    expect(prompt).toContain('פרויקט גמר'); // mandatory_unplaced
    expect(prompt).toContain('קורסי ליבה'); // requirements_progress
  });

  it('includes wanted/unwanted course preferences in the system prompt', () => {
    const ctx: PlanContext = {
      ...PLAN_CONTEXT,
      preferences: {
        wanted_course_ids:   ['0542-4221'],
        unwanted_course_ids: ['0542-4320'],
        extra_request_he:    'תוריד עומס מסמסטר ג׳ ב׳',
      },
    };
    const prompt = buildSystemPrompt({ program_id: 'test', plan_context: ctx });
    expect(prompt).toContain('0542-4221');
    expect(prompt).toContain('0542-4320');
    expect(prompt).toContain('תוריד עומס מסמסטר ג׳ ב׳');
  });

  it('includes pinned course ids', () => {
    const ctx: PlanContext = { ...PLAN_CONTEXT, pinned_course_ids: ['0542-4120'] };
    const prompt = buildSystemPrompt({ program_id: 'test', plan_context: ctx });
    // pinned ids aren't rendered directly in the prose, but the prompt must
    // still build successfully with the field present.
    expect(prompt).toContain('הנדסה מכנית');
  });

  it('omits the preferences section when no preferences are set', () => {
    const prompt = buildSystemPrompt({ program_id: 'test', plan_context: PLAN_CONTEXT });
    expect(prompt).not.toContain('### העדפות המשתמש');
  });

  it('describes the structured-proposal JSON format for board changes', () => {
    const prompt = buildSystemPrompt({ program_id: 'test', plan_context: PLAN_CONTEXT });
    expect(prompt).toContain('```json');
    expect(prompt).toContain('semester_id');
    expect(prompt).toContain('rationale_he');
  });
});

describe('computeSemesterLoads', () => {
  it('returns correct totals', () => {
    const loads = computeSemesterLoads([SEMESTER_A, SEMESTER_B]);
    expect(loads).toHaveLength(2);
    expect(loads[0].total_hours).toBe(14);
    expect(loads[0].course_count).toBe(3);
    expect(loads[1].total_hours).toBe(5);
  });
});

describe('checkPrerequisites', () => {
  it('returns courses with missing prerequisites', () => {
    const issues = checkPrerequisites([SEMESTER_A, SEMESTER_B]);
    expect(issues).toHaveLength(1);
    expect(issues[0].course_id).toBe('0542-4320');
    expect(issues[0].missing).toContain('0542-4120');
  });

  it('returns empty list when no issues', () => {
    const issues = checkPrerequisites([SEMESTER_B]);
    expect(issues).toHaveLength(0);
  });
});

describe('findMissingDegreeRequirements', () => {
  it('returns categories where placed < required', () => {
    const missing = findMissingDegreeRequirements(PLAN_CONTEXT.requirements_progress);
    expect(missing).toHaveLength(2);
    expect(missing.map(m => m.name)).toContain('קורסי ליבה');
    expect(missing.map(m => m.name)).toContain('קורסי בחירה');
  });

  it('returns empty for undefined progress', () => {
    expect(findMissingDegreeRequirements(undefined)).toEqual([]);
  });

  it('returns empty when all categories fulfilled', () => {
    const fulfilledProgress = {
      completed_hours: 100,
      required_hours: 100,
      categories: [{ name: 'ליבה', required: 4, placed: 4 }],
    };
    expect(findMissingDegreeRequirements(fulfilledProgress)).toHaveLength(0);
  });
});
