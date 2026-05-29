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

  it('includes course-specific context when provided', () => {
    const prompt = buildSystemPrompt({
      program_id: 'mechanical_2027',
      plan_context: PLAN_CONTEXT,
      course_context: 'קורס ייחודי עם מעבדה',
    });
    expect(prompt).toContain('קורס ייחודי עם מעבדה');
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
