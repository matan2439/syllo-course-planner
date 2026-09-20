/**
 * Phase 3 — tests for api/ai/planner_capabilities.ts.
 *
 * Covers:
 *   - detectGaps: pure scan of ConstraintModel.profiles for data gaps
 *   - GapRecord / GapType shape
 *   - Capability interfaces: SearchCapability, KnowledgeCapability,
 *     ValidationCapability, ExplanationCapability
 *   - PassThroughKnowledgeCapability: no-op P1 implementation
 *
 * Required tests (from Phase 3 spec):
 *   1. detectGaps finds null hours
 *   2. detectGaps finds missing/unresolved category_id
 *   3. detectGaps finds prerequisite IDs absent from model.profiles
 *   4. detectGaps finds missing allowed_semesters (all semester fields null)
 *   5. fully specified profiles produce no gaps
 *   6. capability interfaces compile with object-literal mock implementations
 */

import type { ConstraintModel, CategoryReq } from '../../api/ai/planner_types';
import type { CourseProfile } from '../../api/ai/course_profile';
import {
  detectGaps,
  PassThroughKnowledgeCapability,
  type GapRecord,
  type GapType,
  type SearchCapability,
  type KnowledgeCapability,
  type ValidationCapability,
  type ExplanationCapability,
} from '../../api/ai/planner_capabilities';

// ── Minimal fixture helpers ───────────────────────────────────────────────────

/** A fully-valid profile — all gap-checked fields populated. Override per test. */
function makeProfile(id: string, over: Partial<CourseProfile> = {}): CourseProfile {
  return {
    course_id: id,
    name_he: id,
    category_id: 'cat_1',
    category_name_he: null,
    is_mandatory: false,
    course_type: 'elective',
    placement_policy: 'elective',
    hours: 4,
    offered_semesters: ['semester_a'],
    effective_allowed_semesters: ['semester_a'],
    recommended_semester: null,
    allowed_semesters: null,
    program_allowed_semesters: null,
    prerequisites: [],
    corequisites: [],
    syllabus_url: null,
    syllabus_available: false,
    syllabus_summary_he: null,
    syllabus_topics_he: [],
    assessment_type: null,
    workload_score: null,
    difficulty_score: null,
    difficulty_level: null,
    grade_average: null,
    is_wanted: false,
    is_unwanted: false,
    excluded: false,
    exclusion_reason: null,
    data_confidence: 0.8,
    provenance: { source: null, data_quality: null, offering_source_url: null, name_source: null },
    ...over,
  };
}

function makeModel(
  profiles: CourseProfile[],
  categories: CategoryReq[] = [],
): ConstraintModel {
  const profileMap = new Map<string, CourseProfile>();
  for (const p of profiles) profileMap.set(p.course_id, p);
  return {
    profiles: profileMap,
    knownSemesterIds: ['semester_a', 'semester_b'],
    completedCourseIds: new Set(),
    requiredMandatoryCourseIds: [],
    categories,
    degreeRequiredHours: 100,
    priorHours: 0,
    maxHoursPerSemester: 20,
    hardCap: 30,
    disallowedCourseIds: new Set(),
    pinnedCourseIds: new Set(),
    wantedCourseIds: new Set(),
  };
}

const KNOWN_CAT: CategoryReq = { id: 'cat_1', name: 'Known Category', required: 1, candidateIds: [] };

// ── GapType literal union ─────────────────────────────────────────────────────

const _allGapTypes: GapType[] = [
  'null_hours',
  'unresolved_category',
  'missing_prerequisite',
  'missing_allowed_semesters',
];
void _allGapTypes;

// ── detectGaps tests ──────────────────────────────────────────────────────────

describe('detectGaps', () => {
  // 1 — null hours
  test('flags courses with null hours', () => {
    const model = makeModel(
      [makeProfile('c1', { hours: null })],
      [KNOWN_CAT],
    );
    const gaps = detectGaps(model);
    const match = gaps.find(g => g.courseId === 'c1' && g.gapType === 'null_hours');
    expect(match).toBeDefined();
  });

  // 2 — unresolved category_id
  test('flags category_id that is not present in model.categories', () => {
    const model = makeModel(
      // category_id set to 'unknown_cat' — not in model.categories
      [makeProfile('c1', { category_id: 'unknown_cat' })],
      [KNOWN_CAT],  // only 'cat_1' is known
    );
    const gaps = detectGaps(model);
    const match = gaps.find(
      g => g.courseId === 'c1' && g.gapType === 'unresolved_category',
    );
    expect(match).toBeDefined();
    expect(match!.detail).toBe('unknown_cat');
  });

  test('does not flag null category_id (null = no category assigned)', () => {
    const model = makeModel([makeProfile('c1', { category_id: null })], [KNOWN_CAT]);
    const gaps = detectGaps(model);
    expect(gaps.some(g => g.courseId === 'c1' && g.gapType === 'unresolved_category')).toBe(false);
  });

  // 3 — prerequisite IDs absent from profiles
  test('flags prerequisites whose course_id is absent from model.profiles', () => {
    const model = makeModel(
      [makeProfile('c1', { prerequisites: ['known_prereq', 'ghost_prereq'] }),
       makeProfile('known_prereq')],
      [KNOWN_CAT],
    );
    const gaps = detectGaps(model);
    const match = gaps.find(
      g => g.courseId === 'c1' && g.gapType === 'missing_prerequisite',
    );
    expect(match).toBeDefined();
    expect(match!.detail).toBe('ghost_prereq');
    // known_prereq is in profiles — must not be flagged
    expect(
      gaps.some(g => g.courseId === 'c1' && g.gapType === 'missing_prerequisite' && g.detail === 'known_prereq'),
    ).toBe(false);
  });

  test('does not flag prerequisites that exist in model.profiles', () => {
    const model = makeModel(
      [makeProfile('c1', { prerequisites: ['c2'] }), makeProfile('c2')],
      [KNOWN_CAT],
    );
    const gaps = detectGaps(model);
    expect(gaps.filter(g => g.courseId === 'c1' && g.gapType === 'missing_prerequisite')).toHaveLength(0);
  });

  // 4 — missing allowed_semesters (all four semester fields null)
  test('flags courses with all semester scheduling fields null', () => {
    const model = makeModel(
      [makeProfile('c1', {
        effective_allowed_semesters: null,
        offered_semesters: null,
        allowed_semesters: null,
        program_allowed_semesters: null,
      })],
      [KNOWN_CAT],
    );
    const gaps = detectGaps(model);
    const match = gaps.find(g => g.courseId === 'c1' && g.gapType === 'missing_allowed_semesters');
    expect(match).toBeDefined();
  });

  test('does not flag missing_allowed_semesters when offered_semesters is set', () => {
    const model = makeModel(
      [makeProfile('c1', {
        effective_allowed_semesters: null,
        offered_semesters: ['semester_a'],  // at least one source present
      })],
      [KNOWN_CAT],
    );
    const gaps = detectGaps(model);
    expect(gaps.some(g => g.courseId === 'c1' && g.gapType === 'missing_allowed_semesters')).toBe(false);
  });

  // 5 — fully specified profile → no gaps for that course
  test('returns no gaps for fully specified profiles', () => {
    const prereq = makeProfile('prereq');
    const course = makeProfile('c1', { prerequisites: ['prereq'] });
    const model = makeModel([course, prereq], [KNOWN_CAT]);
    const coursGaps = detectGaps(model).filter(g => g.courseId === 'c1');
    expect(coursGaps).toHaveLength(0);
  });

  test('returns empty array when all profiles are fully specified', () => {
    const model = makeModel(
      [makeProfile('c1'), makeProfile('c2')],
      [KNOWN_CAT],
    );
    expect(detectGaps(model)).toHaveLength(0);
  });

  // GapRecord shape
  test('GapRecord has courseId, gapType, and optional detail', () => {
    const model = makeModel(
      [makeProfile('c1', { hours: null, category_id: 'unknown_cat' })],
      [],
    );
    const gaps = detectGaps(model);
    expect(gaps.length).toBeGreaterThan(0);
    for (const g of gaps) {
      expect(g).toHaveProperty('courseId');
      expect(g).toHaveProperty('gapType');
      // detail is optional — just verify property access doesn't throw
      void (g.detail);
    }
  });
});

// ── Capability interface shape tests ──────────────────────────────────────────

describe('capability interfaces compile with mock implementations', () => {
  type S2 = { n: number };
  type A2 = { d: number };

  // 6a — SearchCapability
  test('SearchCapability<S,A> accepts a matching object literal', () => {
    const cap: SearchCapability<S2, A2> = {
      search: (s, _deps, _opts) => ({ finalState: s }),
    };
    const result = cap.search({ n: 0 }, {} as never, { maxSteps: 1 });
    expect(result.finalState).toEqual({ n: 0 });
  });

  // 6b — KnowledgeCapability + PassThroughKnowledgeCapability
  test('PassThroughKnowledgeCapability satisfies KnowledgeCapability and resolves void', async () => {
    const cap: KnowledgeCapability = new PassThroughKnowledgeCapability();
    const gaps: GapRecord[] = [{ courseId: 'c1', gapType: 'null_hours' }];
    await expect(cap.resolve(gaps)).resolves.toBeUndefined();
  });

  test('KnowledgeCapability accepts an object-literal pass-through', async () => {
    const cap: KnowledgeCapability = { resolve: async (_gaps) => { /* no-op */ } };
    await expect(cap.resolve([])).resolves.toBeUndefined();
  });

  // 6c — ValidationCapability
  test('ValidationCapability accepts a matching object literal', () => {
    const cap: ValidationCapability = {
      validateState: (_s: unknown) => ({ valid: true }),
    };
    expect(cap.validateState({ n: 42 })).toEqual({ valid: true });
  });

  test('ValidationCapability can carry a rejection reason', () => {
    const cap: ValidationCapability = {
      validateState: (_s: unknown) => ({ valid: false, reason: 'overloaded' }),
    };
    const result = cap.validateState({});
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('overloaded');
  });

  // 6d — ExplanationCapability
  test('ExplanationCapability accepts a matching object literal', async () => {
    const cap: ExplanationCapability = {
      explain: async (_trace: unknown[]) => 'הסבר בעברית',
    };
    await expect(cap.explain([])).resolves.toBe('הסבר בעברית');
  });
});
