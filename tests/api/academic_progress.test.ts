/**
 * A2 — the recognition rules themselves.
 *
 * Every rule here is about what may NOT create an academic consequence. The
 * engine is given typed program requirements and a catalog, and nothing else:
 * no titles, no topics, no aggregate hours, no ids it can special-case. A
 * regression against the REAL TAU Mechanical program data is included at the
 * end, and it asserts the actual shape of that program rather than a shape this
 * epic would have preferred.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  computeAcademicProgress,
  allCategoriesSatisfiedByCompletion,
  type ProgramCategoryRequirement,
} from '../../api/ai/academic_progress';

const catalog = (entries: Record<string, number | null>) =>
  new Map<string, number | null | undefined>(Object.entries(entries));

const CATALOG = catalog({ FLU1: 4, FLU2: 4, SOL1: 3, SOL2: 3, FREE1: 2, NOHOURS: null });

const REQS: ProgramCategoryRequirement[] = [
  { categoryId: 'fluids', name: 'זרימה', minCourses: 1, courseIds: ['FLU1', 'FLU2'] },
  { categoryId: 'solids', name: 'מוצקים', minCourses: 2, courseIds: ['SOL1', 'SOL2'] },
  // A bucket the program does not actually require — membership in it is not a
  // contribution, and must not make a course look ambiguous either.
  { categoryId: 'other', name: 'אחר', minCourses: 0, courseIds: ['FLU1', 'FREE1'] },
];

const run = (completed: string[], reqs = REQS, cat = CATALOG) =>
  computeAcademicProgress({ completedCourseIds: completed, catalogHours: cat, requirements: reqs });

describe('A2 — what counts, and what may never count', () => {
  test('a catalog course in exactly one requiring pool contributes to it', () => {
    const p = run(['FLU1']);
    expect(p.categories.find((c) => c.categoryId === 'fluids')).toMatchObject({
      required: 1, satisfiedBy: ['FLU1'], remainingRequired: 0,
    });
    expect(p.recognizedHours).toBe(4);
    expect(p.perCourse[0]).toMatchObject({ courseId: 'FLU1', status: 'recognized_category', categoryId: 'fluids' });
  });

  test('a partially satisfied category reports what is still owed', () => {
    const p = run(['SOL1']);
    expect(p.categories.find((c) => c.categoryId === 'solids')).toMatchObject({
      required: 2, satisfiedBy: ['SOL1'], remainingRequired: 1,
    });
  });

  test('completing MORE than required never goes negative', () => {
    const p = run(['FLU1', 'FLU2']);
    expect(p.categories.find((c) => c.categoryId === 'fluids')!.remainingRequired).toBe(0);
  });

  test('a duplicate id is collapsed before anything can count it twice', () => {
    const p = run(['FLU1', 'FLU1', 'FLU1']);
    expect(p.completedCourseIds).toEqual(['FLU1']);
    expect(p.recognizedHours).toBe(4);
    expect(p.categories.find((c) => c.categoryId === 'fluids')!.satisfiedBy).toEqual(['FLU1']);
  });

  test('an UNKNOWN id contributes no credits and no category — but is not forgotten', () => {
    const p = run(['GHOST']);
    expect(p.unresolvedCourseIds).toEqual(['GHOST']);
    expect(p.recognizedHours).toBe(0);
    expect(p.categories.every((c) => c.satisfiedBy.length === 0)).toBe(true);
    // Unknown is not the same as "not completed": it is still reported.
    expect(p.completedCourseIds).toEqual(['GHOST']);
  });

  test('a recognized course with UNKNOWN hours credits nothing rather than a guess', () => {
    const p = run(['NOHOURS']);
    expect(p.recognizedHours).toBe(0);
    expect(p.unknownHoursCourseIds).toEqual(['NOHOURS']);
    // It is still recognized — the gap is the hours, not the course.
    expect(p.recognizedCourseIds).toEqual(['NOHOURS']);
  });

  test('a recognized course in NO requiring pool credits hours but satisfies no category', () => {
    const p = run(['FREE1']);
    expect(p.recognizedHours).toBe(2);
    expect(p.perCourse[0].status).toBe('recognized_no_category');
    expect(p.categories.every((c) => c.satisfiedBy.length === 0)).toBe(true);
  });

  test('membership in a min_courses:0 bucket is not a contribution and not an ambiguity', () => {
    // FLU1 is in both `fluids` (required) and `other` (not required).
    const p = run(['FLU1']);
    expect(p.ambiguousCourseIds).toEqual([]);
    expect(p.perCourse[0].status).toBe('recognized_category');
    expect(p.perCourse[0].categoryId).toBe('fluids');
  });

  test('a course claimed by TWO requiring pools is unresolved, never double-counted', () => {
    const overlapping: ProgramCategoryRequirement[] = [
      { categoryId: 'a', name: 'A', minCourses: 1, courseIds: ['SHARED'] },
      { categoryId: 'b', name: 'B', minCourses: 1, courseIds: ['SHARED'] },
    ];
    const p = run(['SHARED'], overlapping, catalog({ SHARED: 4 }));

    expect(p.ambiguousCourseIds).toEqual(['SHARED']);
    // Neither category is satisfied — over-crediting could let someone believe
    // a requirement is met that the program never said was met.
    expect(p.categories.every((c) => c.remainingRequired === 1)).toBe(true);
    expect(p.perCourse[0].candidateCategoryIds).toEqual(['a', 'b']);
    // The hours are still real, though: it is a genuine completed course.
    expect(p.recognizedHours).toBe(4);
  });
});

describe('A2 — nothing about the result may depend on order', () => {
  const shuffled: ProgramCategoryRequirement[] = [...REQS].reverse();

  test('input order is irrelevant', () => {
    expect(run(['SOL1', 'FLU1', 'FREE1'])).toEqual(run(['FREE1', 'FLU1', 'SOL1']));
  });

  test('category declaration order is irrelevant', () => {
    expect(run(['FLU1', 'SOL1'], shuffled)).toEqual(run(['FLU1', 'SOL1'], REQS));
  });

  test('the digest is stable across equivalent inputs and changes when recognition changes', () => {
    expect(run(['FLU1', 'FLU1']).digest).toBe(run(['FLU1']).digest);
    expect(run(['SOL1', 'FLU1']).digest).toBe(run(['FLU1', 'SOL1']).digest);
    expect(run(['FLU1']).digest).not.toBe(run(['SOL1']).digest);
    // An unknown id changes what was recognized, so it changes the digest.
    expect(run(['FLU1', 'GHOST']).digest).not.toBe(run(['FLU1']).digest);
    expect(run([]).digest).toMatch(/^ap_[0-9a-f]{16}$/);
  });

  test('all-satisfied is reported only when every requirement is met', () => {
    expect(allCategoriesSatisfiedByCompletion(run(['FLU1']))).toBe(false); // solids owes 2
    expect(allCategoriesSatisfiedByCompletion(run(['FLU1', 'SOL1', 'SOL2']))).toBe(true);
  });
});

describe('Phase A.3 — authoritative prerequisite contributions', () => {
  const progression = (facts: Array<{ courseId: string; name: string; prerequisiteCourseIds: string[] }>) =>
    computeAcademicProgress({
      completedCourseIds: ['PRE'],
      catalogHours: catalog({ PRE: 2, OTHER: 2, ADV: 2 }),
      requirements: [],
      prerequisiteFacts: facts,
    });

  test('conflicting authoritative prerequisite mappings fail safe instead of accepting the weaker mapping', () => {
    const p = progression([
      { courseId: 'PRE', name: 'יסוד', prerequisiteCourseIds: [] },
      { courseId: 'ADV', name: 'המשך', prerequisiteCourseIds: ['PRE'] },
      { courseId: 'ADV', name: 'המשך', prerequisiteCourseIds: ['PRE', 'OTHER'] },
    ]);

    expect(p.prerequisiteContributions).toEqual([]);
    expect(p.conflictingPrerequisiteCourseIds).toEqual(['ADV']);
  });

  test('a partial prerequisite set never claims that the dependent is unlocked', () => {
    const p = progression([
      { courseId: 'PRE', name: 'יסוד', prerequisiteCourseIds: [] },
      { courseId: 'OTHER', name: 'יסוד נוסף', prerequisiteCourseIds: [] },
      { courseId: 'ADV', name: 'המשך', prerequisiteCourseIds: ['PRE', 'OTHER'] },
    ]);
    expect(p.prerequisiteContributions).toEqual([]);
  });

  test('an unknown completed id creates no prerequisite contribution', () => {
    const p = computeAcademicProgress({
      completedCourseIds: ['GHOST'],
      catalogHours: catalog({ ADV: 2 }),
      requirements: [],
      prerequisiteFacts: [{ courseId: 'ADV', name: 'המשך', prerequisiteCourseIds: ['GHOST'] }],
    });
    expect(p.unresolvedCourseIds).toEqual(['GHOST']);
    expect(p.prerequisiteContributions).toEqual([]);
  });

  test('fact and prerequisite order are irrelevant', () => {
    const forward = progression([
      { courseId: 'PRE', name: 'יסוד', prerequisiteCourseIds: [] },
      { courseId: 'ADV', name: 'המשך', prerequisiteCourseIds: ['PRE'] },
    ]);
    const reverse = progression([
      { courseId: 'ADV', name: 'המשך', prerequisiteCourseIds: ['PRE', 'PRE'] },
      { courseId: 'PRE', name: 'יסוד', prerequisiteCourseIds: [] },
    ]);
    expect(reverse.prerequisiteContributions).toEqual(forward.prerequisiteContributions);
    expect(reverse.digest).toBe(forward.digest);
  });
});

// ── the real program ────────────────────────────────────────────────────────

describe('A2 — regression against the REAL TAU Mechanical program data', () => {
  const board = JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'boards', 'mechanical_engineering_2027.json'), 'utf8'),
  );
  const meta = board.metadata.program_requirements_categories;
  const requirements: ProgramCategoryRequirement[] = meta.categories.map((c: any) => ({
    categoryId: c.category_id,
    name: c.name_he ?? c.category_id,
    minCourses: Number(c.min_courses) || 0,
    courseIds: c.course_ids ?? [],
  }));
  const hours = new Map<string, number | null | undefined>(
    (board.metadata.program_repository_courses ?? []).map((c: any) => [c.course_id, c.weekly_hours ?? null]),
  );

  /**
   * The fact this epic's design rests on, asserted rather than assumed: the
   * categories that actually REQUIRE something have pairwise disjoint pools. So
   * membership is FIXED, and there is no allocation/choice rule to model. If a
   * future catalog update breaks this, this test is where it surfaces.
   */
  test('the requiring category pools are pairwise DISJOINT', () => {
    const requiring = requirements.filter((r) => r.minCourses > 0);
    expect(requiring.length).toBeGreaterThan(0);
    for (let i = 0; i < requiring.length; i++) {
      for (let j = i + 1; j < requiring.length; j++) {
        const overlap = requiring[i].courseIds.filter((id) => requiring[j].courseIds.includes(id));
        expect({ pair: [requiring[i].categoryId, requiring[j].categoryId], overlap }).toEqual({
          pair: [requiring[i].categoryId, requiring[j].categoryId], overlap: [],
        });
      }
    }
  });

  test('min_courses is a COUNT of courses — every requiring category asks for a whole number', () => {
    for (const r of requirements.filter((x) => x.minCourses > 0)) {
      expect(Number.isInteger(r.minCourses)).toBe(true);
      expect(r.minCourses).toBeGreaterThan(0);
      // …and the pool is big enough to satisfy it at all.
      expect(r.courseIds.length).toBeGreaterThanOrEqual(r.minCourses);
    }
  });

  test('completing one real course from a real pool satisfies exactly that category', () => {
    const target = requirements.find((r) => r.minCourses > 0)!;
    const courseId = target.courseIds[0];
    const p = computeAcademicProgress({ completedCourseIds: [courseId], catalogHours: hours, requirements });

    expect(p.ambiguousCourseIds).toEqual([]);
    expect(p.categories.find((c) => c.categoryId === target.categoryId)!.remainingRequired)
      .toBe(target.minCourses - 1);
    // …and no OTHER category was touched.
    for (const c of p.categories.filter((c) => c.categoryId !== target.categoryId)) {
      expect(c.remainingRequired).toBe(c.required);
    }
  });

  test('every real requiring pool course resolves against the real catalog', () => {
    // A pool naming a course the catalog does not carry would be a genuine
    // missing authoritative fact — this reports it rather than guessing.
    const missing: string[] = [];
    for (const r of requirements.filter((x) => x.minCourses > 0)) {
      for (const id of r.courseIds) if (!hours.has(id)) missing.push(`${r.categoryId}:${id}`);
    }
    expect(missing).toEqual([]);
  });

  test('the real robotics introduction authoritatively unlocks the robotics laboratory', () => {
    const facts = (board.metadata.program_repository_courses ?? []).map((c: any) => ({
      courseId: c.course_id,
      name: c.name_he ?? c.course_id,
      prerequisiteCourseIds: c.prerequisites ?? [],
    }));
    const p = computeAcademicProgress({
      completedCourseIds: ['0542-4621'],
      catalogHours: hours,
      requirements,
      prerequisiteFacts: facts,
    });
    expect(p.prerequisiteContributions).toEqual([{
      completedCourseId: '0542-4621',
      unlockedCourseIds: ['0542-4624'],
    }]);
  });
});
