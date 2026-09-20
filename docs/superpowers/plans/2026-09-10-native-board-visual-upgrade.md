# Native Planner Board Visual Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/planner/native` (React), fix the currently-broken drag-and-drop, then add category colors, a compact always-visible degree-progress widget, correct annual-course handling (spanning both semester columns, locked), and animation polish — all reusing existing data and components rather than building new systems.

**Architecture:** Extend the canonical `shared/planner` model (wire schema → model → adapters) with three passthrough fields the raw board data already ships but the client currently drops: `program_category_id`, `placement_policy`, and `program_requirements_validation`. Thread them through the existing `BoardVM`/`CourseVM` view-model layer into the existing `CourseCard`/`SemesterColumn`/`NativePlannerBoard` components, plus two new small presentational components (`CategoryLegend`, `AnnualCourseBand`, `ProgressBadge`). Fix the one real bug (bare `"A"`/`"B"` semester codes never matching full semester ids) in the adapter, once, so every downstream consumer benefits.

**Tech Stack:** TypeScript, React 19, Next.js 15, Tailwind, zod, Jest + ts-jest (jsdom for `web/`, ambient DOM types).

**Reference:** Design spec at `docs/superpowers/specs/2026-09-10-native-board-visual-upgrade-design.md`.

---

## Before you start

- Run `npm test` inside `web/` once to confirm the baseline is green: `cd web && npm test`.
- All new tests in this plan live under `web/` (even though they exercise `shared/planner/*`), because `web/jest.config.js` is the only jest config that will discover them. `shared/planner/*.test.ts` files at the repo root are **not** picked up by any jest config in this repo — do not create tests there.
- Every task after Task 1 depends on Task 1 and Task 2 having landed (they extend the same shared types). Do the tasks in order.

---

### Task 1: Fix the root-cause bug — normalize bare semester codes

Board data encodes legal semesters as bare `"A"`/`"B"` codes. `CourseCard.tsx` compares `offeredSemesters` (copied verbatim from this field) against full semester ids like `"year_4_semester_a"`, which never match — so no course is currently draggable. Fix this once, in the adapter that produces the canonical model, mirroring the legacy `normalizeLegalSemesterIdsLocal` (`app/web/semester_board_viewer.html:9864`).

**Files:**
- Modify: `shared/planner/adapters.ts`
- Test: `web/lib/planner/adapters.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `web/lib/planner/adapters.test.ts`:

```ts
/**
 * Tests for shared/planner/adapters.ts, colocated under web/ so web's jest
 * config (the only one that runs TS tests outside tests/api) picks them up.
 */
import { boardResponseToModel } from '../../../shared/planner/adapters'

const BASE_BOARD = {
  metadata: { board_data_version: 'rev-1' },
  semesters: [
    { semester_id: 'year_3_semester_a', courses: [] },
    { semester_id: 'year_3_semester_b', courses: [] },
    { semester_id: 'year_4_semester_a', courses: [] },
    { semester_id: 'year_4_semester_b', courses: [] },
  ],
}

test('expands bare "A"/"B" offered_semesters into every real semester id ending in that half', () => {
  const board = {
    ...BASE_BOARD,
    semesters: [
      {
        semester_id: 'year_3_semester_a',
        courses: [{ course_id: 'C-1', name_he: 'קורס', weekly_hours: 3, course_type: 'mandatory', offered_semesters: ['A', 'B'] }],
      },
      ...BASE_BOARD.semesters.slice(1),
    ],
  }
  const model = boardResponseToModel(board)
  expect(model.courseCatalog['C-1'].offeredSemesters).toEqual([
    'year_3_semester_a', 'year_4_semester_a', 'year_3_semester_b', 'year_4_semester_b',
  ])
})

test('a course offered in only one bare half expands to every semester id of that half', () => {
  const board = {
    ...BASE_BOARD,
    semesters: [
      {
        semester_id: 'year_4_semester_a',
        courses: [{ course_id: 'C-2', name_he: 'קורס', weekly_hours: 2, course_type: 'elective', offered_semesters: ['A'] }],
      },
      ...BASE_BOARD.semesters.filter((s) => s.semester_id !== 'year_4_semester_a'),
    ],
  }
  const model = boardResponseToModel(board)
  expect(model.courseCatalog['C-2'].offeredSemesters).toEqual(['year_3_semester_a', 'year_4_semester_a'])
})

test('already-full semester ids pass through unchanged, and unknown tokens are dropped', () => {
  const board = {
    ...BASE_BOARD,
    semesters: [
      {
        semester_id: 'year_3_semester_a',
        courses: [{ course_id: 'C-3', name_he: 'קורס', weekly_hours: 2, course_type: 'elective', offered_semesters: ['year_3_semester_a', 'nonsense'] }],
      },
      ...BASE_BOARD.semesters.slice(1),
    ],
  }
  const model = boardResponseToModel(board)
  expect(model.courseCatalog['C-3'].offeredSemesters).toEqual(['year_3_semester_a'])
})

test('a course with no offered_semesters field keeps offeredSemesters absent (unknown, not "any")', () => {
  const board = {
    ...BASE_BOARD,
    semesters: [
      { semester_id: 'year_3_semester_a', courses: [{ course_id: 'C-4', name_he: 'קורס', weekly_hours: 2, course_type: 'elective' }] },
      ...BASE_BOARD.semesters.slice(1),
    ],
  }
  const model = boardResponseToModel(board)
  expect(model.courseCatalog['C-4'].offeredSemesters).toBeUndefined()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx jest lib/planner/adapters.test.ts`
Expected: FAIL — `offeredSemesters` still holds the raw bare codes (e.g. `['A', 'B']`, not the expanded full-id list).

- [ ] **Step 3: Implement the normalization**

Replace the top of `shared/planner/adapters.ts` (imports through `courseToModel`, lines 1–29) with:

```ts
/**
 * ADAPTERS — wire payload → canonical model. Lossless; half-hour conversion is
 * exact (throws on unsupported precision, never rounds). Runtime-neutral.
 */
import { boardResponseSchema, generatePlanResponseSchema } from './wire';
import { toHalfHours, catalogRevision, normalizeCourseId } from './model';
import type { BoardModel, BoardCourseModel, GeneratedPlanModel } from './model';

/** Raw course shape shared by placed courses and program_repository_courses. */
type RawCourse = {
  course_id: string;
  name_he?: string | null;
  weekly_hours?: number | null;
  course_type?: string;
  is_mandatory?: boolean;
  offered_semesters?: string[] | null;
  program_category_id?: string | null;
  placement_policy?: string;
};

/**
 * Board data encodes a legal-semester "half" two ways: a full semester id
 * ("year_3_semester_a") or a bare offering code ("A"/"B", case-insensitive,
 * or Hebrew "א"/"ב") meaning "that half of ANY year in this board". Expand
 * bare codes against the board's own known semester ids so downstream
 * movable/drop-target checks (which compare against full ids) work. Mirrors
 * the legacy normalizeLegalSemesterIdsLocal (app/web/semester_board_viewer.html).
 */
function normalizeSemesterIds(raw: string[], knownSemesterIds: string[]): string[] {
  const knownSet = new Set(knownSemesterIds);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => { if (!seen.has(id)) { seen.add(id); out.push(id); } };
  for (const tok of raw) {
    if (tok == null) continue;
    const s = String(tok).trim();
    if (!s) continue;
    if (knownSet.has(s)) { push(s); continue; }
    const low = s.toLowerCase();
    let half: '_semester_a' | '_semester_b' | null = null;
    if (low === 'a' || s === 'א') half = '_semester_a';
    else if (low === 'b' || s === 'ב') half = '_semester_b';
    if (!half) continue; // unknown token — can never match a real placement
    for (const id of knownSemesterIds) if (id.endsWith(half)) push(id);
  }
  return out;
}

/** Map one raw course (from either source) to the canonical model. Half-hour exact. */
function courseToModel(c: RawCourse, knownSemesterIds: string[]): BoardCourseModel {
  return {
    courseId: normalizeCourseId(c.course_id),
    nameHe: c.name_he ?? '',
    halfHours: c.weekly_hours == null ? null : toHalfHours(c.weekly_hours),
    courseType: c.course_type ?? '',
    isMandatory: c.is_mandatory ?? false,
    ...(c.offered_semesters != null
      ? { offeredSemesters: normalizeSemesterIds(c.offered_semesters, knownSemesterIds) }
      : {}),
    ...(c.program_category_id != null ? { programCategoryId: c.program_category_id } : {}),
    ...(c.placement_policy != null ? { placementPolicy: c.placement_policy } : {}),
  };
}
```

Then update `boardResponseToModel` (currently lines 31–65) to compute `knownSemesterIds` once and pass it to every `courseToModel` call:

```ts
/** Parse + map a raw /api/board response into the canonical BoardModel + catalog. */
export function boardResponseToModel(raw: unknown): BoardModel {
  const parsed = boardResponseSchema.parse(raw);
  const knownSemesterIds = parsed.semesters.map((s) => s.semester_id);

  const semesters = parsed.semesters.map((s) => ({
    semesterId: s.semester_id,
    courses: s.courses.map((c) => courseToModel(c, knownSemesterIds)),
  }));

  // courseCatalog = placed ∪ program_repository_courses, keyed by normalized id.
  // Order-independent merge: within a source, the last occurrence wins; across
  // sources the REPOSITORY entry is authoritative for shared fields, while the
  // placement-only `courseType` (repo entries carry none) is retained.
  const placedIndex: Record<string, BoardCourseModel> = {};
  for (const s of parsed.semesters) {
    for (const c of s.courses) placedIndex[normalizeCourseId(c.course_id)] = courseToModel(c, knownSemesterIds);
  }
  const repoIndex: Record<string, BoardCourseModel> = {};
  for (const c of parsed.metadata.program_repository_courses ?? []) {
    repoIndex[normalizeCourseId(c.course_id)] = courseToModel(c, knownSemesterIds);
  }
  const courseCatalog: Record<string, BoardCourseModel> = {};
  for (const id of new Set([...Object.keys(placedIndex), ...Object.keys(repoIndex)])) {
    const placed = placedIndex[id];
    const repo = repoIndex[id];
    courseCatalog[id] =
      repo && placed ? { ...repo, courseType: repo.courseType || placed.courseType } : repo ?? placed;
  }

  return {
    catalogRevision: catalogRevision(parsed.metadata.board_data_version),
    semesters,
    courseCatalog,
  };
}
```

Note: this step references `program_category_id` and `placement_policy` on `RawCourse`, and the `BoardCourseModel` fields `programCategoryId`/`placementPolicy` — those model/wire fields don't exist yet. Task 2 adds them. For Task 1 alone to typecheck and pass its own tests, temporarily comment out the two `programCategoryId`/`placementPolicy` lines inside `courseToModel` and the two fields on `RawCourse`; Task 2 will restore them. (If doing Task 1 and Task 2 back-to-back in one sitting, skip the temporary comment-out and just proceed straight to Task 2's schema/model changes before running the type checker.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx jest lib/planner/adapters.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full existing suite to confirm no regression**

Run: `cd web && npm test`
Expected: PASS — in particular `lib/planner/board-vm.test.ts` and any `NativePlannerBoard`/`CourseCard`/`SemesterColumn` tests must still pass unchanged (this fix only makes `offeredSemesters` correct where it was wrong before; it never removes offering data).

- [ ] **Step 6: Commit**

```bash
git add shared/planner/adapters.ts web/lib/planner/adapters.test.ts
git commit -m "fix(planner): normalize bare A/B semester codes so board drag actually works

CourseCard compared offeredSemesters against full semester ids, but the
board data ships bare 'A'/'B' offering codes. They never matched, so no
course was draggable on /planner/native. Expand them once in the shared
adapter, mirroring the legacy normalizeLegalSemesterIdsLocal.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Extend the canonical model — category id + placement policy

Add `programCategoryId` and `placementPolicy` to the canonical model (wire schema, model type, and the `isAnnualCourse` helper), pure passthrough of data that already exists in the board JSON.

**Files:**
- Modify: `shared/planner/wire.ts`
- Modify: `shared/planner/model.ts`
- Modify: `shared/planner/adapters.ts` (restore the two lines commented out in Task 1, if they were)
- Test: `web/lib/planner/adapters.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Add to `web/lib/planner/adapters.test.ts`:

```ts
import { isAnnualCourse } from '../../../shared/planner/model'

test('program_category_id and placement_policy pass through to the catalog unchanged', () => {
  const board = {
    metadata: { board_data_version: 'rev-1' },
    semesters: [
      {
        semester_id: 'year_3_semester_a',
        courses: [
          { course_id: 'FLU-1', name_he: 'זרימה', weekly_hours: 3, course_type: 'elective', program_category_id: 'fluids', placement_policy: 'elective' },
          { course_id: 'MAND-1', name_he: 'חובה', weekly_hours: 4, course_type: 'mandatory', placement_policy: 'fixed' },
        ],
      },
      { semester_id: 'year_3_semester_b', courses: [] },
      { semester_id: 'year_4_semester_a', courses: [] },
      { semester_id: 'year_4_semester_b', courses: [] },
    ],
  }
  const model = boardResponseToModel(board)
  expect(model.courseCatalog['FLU-1'].programCategoryId).toBe('fluids')
  expect(model.courseCatalog['MAND-1'].programCategoryId).toBeUndefined()
  expect(model.courseCatalog['MAND-1'].placementPolicy).toBe('fixed')
})

test('isAnnualCourse is true only for placement_policy "annual"', () => {
  expect(isAnnualCourse({ courseId: 'x', nameHe: '', halfHours: null, courseType: '', isMandatory: true, placementPolicy: 'annual' })).toBe(true)
  expect(isAnnualCourse({ courseId: 'x', nameHe: '', halfHours: null, courseType: '', isMandatory: true, placementPolicy: 'flexible' })).toBe(false)
  expect(isAnnualCourse({ courseId: 'x', nameHe: '', halfHours: null, courseType: '', isMandatory: false })).toBe(false)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx jest lib/planner/adapters.test.ts`
Expected: FAIL — TypeScript compile error (`programCategoryId`/`placementPolicy` not on `BoardCourseModel`, `isAnnualCourse` not exported).

- [ ] **Step 3: Implement**

In `shared/planner/wire.ts`, replace the `boardCourseSchema` block (lines 16–30) with:

```ts
const boardCourseSchema = z
  .object({
    course_id: z.string().min(1),
    // Present in the real catalog as a decimal half-hour (e.g. 3.5) or null.
    weekly_hours: z.number().nullable().optional(),
    // The real program_repository_courses carry name_he: null for some courses
    // (no known Hebrew name). nullish() accepts string | null | absent; the
    // adapter coalesces null → '' (never fabricates a name). course_type is
    // never null in the real payload (absent on repo entries), so it stays optional.
    name_he: z.string().nullish(),
    course_type: z.string().optional(),
    is_mandatory: z.boolean().optional(),
    offered_semesters: z.array(z.string().min(1)).nullable().optional(),
    // Elective category (fluids/solids/systems/advanced_labs/other_specialization/…);
    // null/absent for mandatory courses and uncategorized electives.
    program_category_id: z.string().nullable().optional(),
    // Opaque string as shipped ("fixed" | "flexible" | "annual" | "elective" today);
    // never treated as a closed enum, matching course_type elsewhere in this schema.
    placement_policy: z.string().optional(),
  })
  .passthrough();
```

In `shared/planner/model.ts`, replace `BoardCourseModel` (lines 80–89) with:

```ts
export interface BoardCourseModel {
  courseId: string;
  nameHe: string;
  /** Exact half-hour units, or null when the catalog has no weekly hours. */
  halfHours: number | null;
  courseType: string;
  isMandatory: boolean;
  /** Catalog-authorized semester ids; absent when the source carries no offering fact. */
  offeredSemesters?: string[];
  /** Elective category id (fluids/solids/systems/advanced_labs/other_specialization/…). Absent for mandatory courses and uncategorized electives. */
  programCategoryId?: string;
  /** Opaque, as shipped: "fixed" | "flexible" | "annual" | "elective" today. */
  placementPolicy?: string;
}

/** A year-long course spans both semester halves as one atomic placement — never independently movable, never split. */
export function isAnnualCourse(c: BoardCourseModel): boolean {
  return c.placementPolicy === 'annual';
}
```

In `shared/planner/adapters.ts`, confirm (or restore, if Task 1 commented them out) that `RawCourse` has `program_category_id?: string | null;` and `placement_policy?: string;`, and that `courseToModel` includes:

```ts
    ...(c.program_category_id != null ? { programCategoryId: c.program_category_id } : {}),
    ...(c.placement_policy != null ? { placementPolicy: c.placement_policy } : {}),
```

(This is the exact code already shown in Task 1 Step 3 — if Task 1 was implemented without commenting these out, this step is a no-op; just verify.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx jest lib/planner/adapters.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Run the full suite**

Run: `cd web && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add shared/planner/wire.ts shared/planner/model.ts shared/planner/adapters.ts web/lib/planner/adapters.test.ts
git commit -m "feat(planner): thread program_category_id and placement_policy into the canonical model

Pure passthrough of fields the board data already ships. Adds
isAnnualCourse() as the single source of truth for 'this course is a
year-long placement, never independently movable' — used by the
upcoming annual-course rendering and category-color work.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Extend the canonical model — degree-requirements passthrough

Thread `metadata.program_requirements_validation` (hours + per-category counts, already computed data-side) through to `BoardModel`, and make sure it survives the client-side board-merge used after every manual edit/apply.

**Files:**
- Modify: `shared/planner/wire.ts`
- Modify: `shared/planner/model.ts`
- Modify: `shared/planner/adapters.ts`
- Modify: `web/lib/planner/apply-plan.ts`
- Test: `web/lib/planner/adapters.test.ts` (extend)
- Test: `web/lib/planner/apply-plan.test.ts` (extend existing file)

- [ ] **Step 1: Write the failing tests**

Add to `web/lib/planner/adapters.test.ts`:

```ts
test('program_requirements_validation passes through to BoardModel.requirementsValidation', () => {
  const board = {
    metadata: {
      board_data_version: 'rev-1',
      program_requirements_validation: {
        valid: false,
        total_required_hours: 185,
        planned_hours: 128.5,
        remaining_hours: 56.5,
        core_courses_total_min: 6,
        core_courses_selected: 0,
        core_courses_satisfied: false,
        category_results: [
          { category_id: 'fluids', name_he: 'זורמים', min_courses: 1, selected_count: 0, satisfied: false, missing_count: 1 },
        ],
        warnings: ['שעות חסרות: 56.5'],
      },
    },
    semesters: [
      { semester_id: 'year_3_semester_a', courses: [] },
      { semester_id: 'year_3_semester_b', courses: [] },
      { semester_id: 'year_4_semester_a', courses: [] },
      { semester_id: 'year_4_semester_b', courses: [] },
    ],
  }
  const model = boardResponseToModel(board)
  expect(model.requirementsValidation).toEqual({
    valid: false,
    totalRequiredHours: 185,
    plannedHours: 128.5,
    remainingHours: 56.5,
    coreCoursesTotalMin: 6,
    coreCoursesSelected: 0,
    coreCoursesSatisfied: false,
    categories: [
      { categoryId: 'fluids', nameHe: 'זורמים', minCourses: 1, selectedCount: 0, satisfied: false, missingCount: 1 },
    ],
    warnings: ['שעות חסרות: 56.5'],
  })
})

test('requirementsValidation is absent when the board carries no requirements block', () => {
  const model = boardResponseToModel(BASE_BOARD)
  expect(model.requirementsValidation).toBeUndefined()
})
```

Find the existing `web/lib/planner/apply-plan.test.ts` and add:

```ts
test('requirementsValidation survives a manual-edit merge unchanged (never recomputed client-side)', () => {
  const base = {
    catalogRevision: catalogRevision('rev-1'),
    courseCatalog: {},
    semesters: [{ semesterId: 'year_3_semester_a', courseIds: [] } as never].map(() => ({ semesterId: 'year_3_semester_a', courses: [] })),
    requirementsValidation: {
      valid: false, totalRequiredHours: 185, plannedHours: 128.5, remainingHours: 56.5,
      coreCoursesTotalMin: 6, coreCoursesSelected: 0, coreCoursesSatisfied: false,
      categories: [], warnings: [],
    },
  }
  const result = applyGeneratedToBoard({ semesters: [], moves: [], warningsHe: [], errors: [], blocked: false }, base)
  expect(result.requirementsValidation).toBe(base.requirementsValidation)
})
```

(Check the top of `apply-plan.test.ts` for its existing `catalogRevision` import and adjust the import line if it already imports it under a different alias — keep the rest of the file untouched.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx jest lib/planner/adapters.test.ts lib/planner/apply-plan.test.ts`
Expected: FAIL — `requirementsValidation` does not exist on `BoardModel`.

- [ ] **Step 3: Implement**

In `shared/planner/wire.ts`, add a new schema above `boardResponseSchema` and reference it from the `metadata` object (replace the `boardResponseSchema` block, lines 43–57):

```ts
const boardRequirementCategoryResultSchema = z
  .object({
    category_id: z.string().min(1),
    name_he: z.string(),
    min_courses: z.number(),
    selected_count: z.number(),
    satisfied: z.boolean(),
    missing_count: z.number(),
  })
  .passthrough();

const boardRequirementsValidationSchema = z
  .object({
    valid: z.boolean(),
    total_required_hours: z.number(),
    planned_hours: z.number(),
    remaining_hours: z.number(),
    core_courses_total_min: z.number(),
    core_courses_selected: z.number(),
    core_courses_satisfied: z.boolean(),
    category_results: z.array(boardRequirementCategoryResultSchema).optional(),
    warnings: z.array(z.string()).optional(),
  })
  .passthrough();

export const boardResponseSchema = z
  .object({
    metadata: z
      .object({
        board_data_version: z.string().min(1),
        // The elective universe the planner draws from, alongside placed courses.
        // Optional: some program payloads may omit it (catalog is then placed-only).
        program_repository_courses: z.array(boardCourseSchema).optional(),
        program_requirements_validation: boardRequirementsValidationSchema.optional(),
      })
      .passthrough(),
    semesters: z.array(boardSemesterSchema),
    summary: z.object({ total_courses: z.number().optional() }).passthrough().optional(),
    warnings: z.array(z.string()).optional(),
  })
  .passthrough();
export type BoardResponse = z.infer<typeof boardResponseSchema>;
```

In `shared/planner/model.ts`, add below `BoardCourseModel`/`isAnnualCourse` (after the code added in Task 2) and update `BoardModel`:

```ts
export interface BoardRequirementCategoryModel {
  categoryId: string;
  nameHe: string;
  minCourses: number;
  selectedCount: number;
  satisfied: boolean;
  missingCount: number;
}

/** Pass-through of shipped numbers only — never recomputed client-side. */
export interface BoardRequirementsModel {
  valid: boolean;
  totalRequiredHours: number;
  plannedHours: number;
  remainingHours: number;
  coreCoursesTotalMin: number;
  coreCoursesSelected: number;
  coreCoursesSatisfied: boolean;
  categories: BoardRequirementCategoryModel[];
  warnings: string[];
}
```

Replace `BoardModel` (originally lines 94–104) with:

```ts
export interface BoardModel {
  catalogRevision: CatalogRevision;
  semesters: BoardSemesterModel[];
  /**
   * Full display universe from the SAME /api/board payload: placed courses
   * (semesters[].courses) ∪ metadata.program_repository_courses, keyed by
   * normalized course id. This is the authoritative lookup for interpreting
   * generated course ids; `semesters` remain PLACEMENTS, not the whole universe.
   */
  courseCatalog: Record<string, BoardCourseModel>;
  /** Degree-progress snapshot as of this board load; absent if the source board carried none. Never recomputed client-side. */
  requirementsValidation?: BoardRequirementsModel;
}
```

In `shared/planner/adapters.ts`, add a small mapper and wire it into `boardResponseToModel`'s return. Add above `boardResponseToModel`:

```ts
function requirementsToModel(
  v: NonNullable<ReturnType<typeof boardResponseSchema.parse>['metadata']['program_requirements_validation']>,
): BoardRequirementsModel {
  return {
    valid: v.valid,
    totalRequiredHours: v.total_required_hours,
    plannedHours: v.planned_hours,
    remainingHours: v.remaining_hours,
    coreCoursesTotalMin: v.core_courses_total_min,
    coreCoursesSelected: v.core_courses_selected,
    coreCoursesSatisfied: v.core_courses_satisfied,
    categories: (v.category_results ?? []).map((c) => ({
      categoryId: c.category_id,
      nameHe: c.name_he,
      minCourses: c.min_courses,
      selectedCount: c.selected_count,
      satisfied: c.satisfied,
      missingCount: c.missing_count,
    })),
    warnings: v.warnings ?? [],
  };
}
```

Add `BoardRequirementsModel` to the `import type { BoardModel, BoardCourseModel, GeneratedPlanModel }` line at the top of `adapters.ts`.

Update the `return` statement at the end of `boardResponseToModel` (originally lines 60–64) to:

```ts
  return {
    catalogRevision: catalogRevision(parsed.metadata.board_data_version),
    semesters,
    courseCatalog,
    ...(parsed.metadata.program_requirements_validation
      ? { requirementsValidation: requirementsToModel(parsed.metadata.program_requirements_validation) }
      : {}),
  };
```

In `web/lib/planner/apply-plan.ts`, add `requirementsValidation: base.requirementsValidation` to the object `applyGeneratedToBoard` returns:

```ts
export function applyGeneratedToBoard(generated: GeneratedPlanModel, base: BoardModel): BoardModel {
  return {
    catalogRevision: base.catalogRevision,
    courseCatalog: base.courseCatalog,
    requirementsValidation: base.requirementsValidation,
    semesters: generated.semesters.map((s) => ({
      semesterId: s.semesterId,
      courses: s.courseIds.map((id) => resolve(base, id)),
    })),
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx jest lib/planner/adapters.test.ts lib/planner/apply-plan.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `cd web && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add shared/planner/wire.ts shared/planner/model.ts shared/planner/adapters.ts web/lib/planner/apply-plan.ts web/lib/planner/adapters.test.ts web/lib/planner/apply-plan.test.ts
git commit -m "feat(planner): thread program_requirements_validation into the canonical model

Pure passthrough (hours + per-category counts), same discipline as
web/lib/requirements.ts already documents for /plan: never recomputed
in the UI. Preserved across the client-side board merge used after
every manual edit/apply, so it doesn't silently vanish after the first
drag on /planner/native. It reflects the numbers as of the last board
fetch, not a live recomputation during manual edits — same honesty
tradeoff the rest of this client already makes.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: View-model — thread category id and annual flag to `CourseVM`

**Files:**
- Modify: `web/lib/board.ts`
- Modify: `web/lib/planner/board-vm.ts`
- Test: `web/lib/planner/board-vm.test.ts` (extend existing file)

- [ ] **Step 1: Write the failing test**

Add to `web/lib/planner/board-vm.test.ts`:

```ts
test('categoryId is copied from the catalog for electives; mandatory courses stay uncategorized', () => {
  const board = {
    metadata: { board_data_version: 'rev-1' },
    semesters: [
      {
        semester_id: 'year_3_semester_a',
        courses: [
          { course_id: 'FLU-1', name_he: 'זרימה', weekly_hours: 3, course_type: 'elective', program_category_id: 'fluids' },
          { course_id: 'ELEC-2', name_he: 'בחירה כללית', weekly_hours: 2, course_type: 'elective' },
          { course_id: 'MAND-1', name_he: 'חובה', weekly_hours: 4, course_type: 'mandatory' },
        ],
      },
      { semester_id: 'year_3_semester_b', courses: [] },
      { semester_id: 'year_4_semester_a', courses: [] },
      { semester_id: 'year_4_semester_b', courses: [] },
    ],
  }
  const vm = boardModelToVM(boardResponseToModel(board))
  const [flu, elec, mand] = vm.semesters[0].courses
  expect(flu.categoryId).toBe('fluids')
  expect(elec.categoryId).toBe('other_specialization') // uncategorized elective falls back
  expect(mand.categoryId).toBeUndefined() // categories are an elective-only concept
})

test('isAnnual is copied from the catalog placement policy', () => {
  const board = {
    metadata: { board_data_version: 'rev-1' },
    semesters: [
      {
        semester_id: 'year_3_semester_a',
        courses: [{ course_id: 'ANN-1', name_he: 'שנתי', weekly_hours: 4, course_type: 'mandatory', placement_policy: 'annual' }],
      },
      { semester_id: 'year_3_semester_b', courses: [] },
      { semester_id: 'year_4_semester_a', courses: [] },
      { semester_id: 'year_4_semester_b', courses: [] },
    ],
  }
  const vm = boardModelToVM(boardResponseToModel(board))
  expect(vm.semesters[0].courses[0].isAnnual).toBe(true)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx jest lib/planner/board-vm.test.ts`
Expected: FAIL — `categoryId`/`isAnnual` are `undefined` on the resulting VM (fields don't exist yet).

- [ ] **Step 3: Implement**

In `web/lib/board.ts`, add the general-elective fallback constant and extend `CourseVM` (replace lines 50–59):

```ts
/** Category to fall back to for elective courses without a recognized categoryId. Mirrors legacy GENERAL_ELECTIVE_CAT_ID. */
export const GENERAL_ELECTIVE_CATEGORY_ID = 'other_specialization'

export type CourseVM = {
  id: string
  name: string
  weeklyHours: number | null
  type: string
  difficulty: string | null
  syllabusUrl: string | null
  hasWarnings: boolean
  offeredSemesters?: string[]
  /** Elective category id, defaulted to GENERAL_ELECTIVE_CATEGORY_ID for uncategorized electives. Absent for mandatory courses. */
  categoryId?: string
  /** A year-long course spanning both semester halves as one atomic placement — never independently movable. */
  isAnnual?: boolean
}
```

In `web/lib/planner/board-vm.ts`, update the import and the course-mapping block inside `boardModelToVM` (replace lines 14 and 49–63):

```ts
import { SEMESTER_ORDER, GENERAL_ELECTIVE_CATEGORY_ID, type BoardVM } from '../board'
import { fromHalfHours } from '../../../shared/planner/model'
import { isAnnualCourse } from '../../../shared/planner/model'
import type { BoardModel } from '../../../shared/planner/model'
```

```ts
      courses: s.courses.map((c) => {
        const catalogCourse = model.courseCatalog[c.courseId]
        const isElectiveLike = c.courseType !== 'mandatory'
        return {
          id: c.courseId,
          name: c.nameHe,
          weeklyHours: c.halfHours == null ? null : fromHalfHours(c.halfHours),
          type: c.courseType,
          difficulty: null, // deferred (D1)
          syllabusUrl: null, // deferred (D1)
          hasWarnings: false, // deferred (D1)
          ...(catalogCourse?.offeredSemesters !== undefined
            ? { offeredSemesters: [...catalogCourse.offeredSemesters] }
            : {}),
          ...(isElectiveLike
            ? { categoryId: catalogCourse?.programCategoryId ?? GENERAL_ELECTIVE_CATEGORY_ID }
            : {}),
          ...(catalogCourse && isAnnualCourse(catalogCourse) ? { isAnnual: true } : {}),
        }
      }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx jest lib/planner/board-vm.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `cd web && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/lib/board.ts web/lib/planner/board-vm.ts web/lib/planner/board-vm.test.ts
git commit -m "feat(planner): thread categoryId and isAnnual into CourseVM

View-model plumbing only — no rendering changes yet. Electives default
to the general-elective category when uncategorized; mandatory courses
stay uncategorized (categories are an elective-only concept in this
program's data model).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Category colors — tokens, `CourseCard` accent, `CategoryLegend`

**Files:**
- Modify: `web/app/globals.css`
- Modify: `web/app/components/CourseCard.tsx`
- Create: `web/app/components/CategoryLegend.tsx`
- Test: `web/app/components/CategoryLegend.test.tsx` (new)
- Test: `web/app/components/CourseCard.test.tsx` (new — verified during planning that no such file exists yet, despite CourseCard.tsx itself being an existing component)

- [ ] **Step 1: Write the failing tests**

Create `web/app/components/CategoryLegend.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import CategoryLegend from './CategoryLegend'

test('renders one chip per category, including mandatory', () => {
  render(<CategoryLegend />)
  expect(screen.getByText('חובה')).toBeInTheDocument()
  expect(screen.getByText('זורמים')).toBeInTheDocument()
  expect(screen.getByText('מוצקים')).toBeInTheDocument()
  expect(screen.getByText('מערכות')).toBeInTheDocument()
  expect(screen.getByText('מעבדה')).toBeInTheDocument()
})
```

Create `web/app/components/CourseCard.test.tsx` (this component has no test file yet):

```tsx
import { render, screen } from '@testing-library/react'
import CourseCard from './CourseCard'

test('an elective with a categoryId gets the matching category accent class', () => {
  render(<CourseCard course={{
    id: 'FLU-1', name: 'זרימה', weeklyHours: 3, type: 'elective', difficulty: null,
    syllabusUrl: null, hasWarnings: false, categoryId: 'fluids',
  }} />)
  expect(screen.getByText('זרימה').closest('[data-category]')).toHaveAttribute('data-category', 'fluids')
})

test('a mandatory course has no data-category attribute', () => {
  render(<CourseCard course={{
    id: 'M-1', name: 'חובה', weeklyHours: 4, type: 'mandatory', difficulty: null,
    syllabusUrl: null, hasWarnings: false,
  }} />)
  expect(screen.getByText('חובה').closest('[data-category]')).toBeNull()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx jest app/components/CategoryLegend.test.tsx app/components/CourseCard.test.tsx`
Expected: FAIL — `CategoryLegend` module doesn't exist; `CourseCard` renders no `data-category` attribute.

- [ ] **Step 3: Implement**

In `web/app/globals.css`, add category color tokens to all three existing token blocks (append inside each, right before the closing `}`):

In the light block (`:root { ... }`, ends at line 24), before the closing brace add:

```css
  --cat-fluids-accent:  #0E7490; --cat-fluids-bg:  rgba(8,145,178,.12);
  --cat-solids-accent:  #B45309; --cat-solids-bg:  rgba(217,119,6,.12);
  --cat-systems-accent: #6D28D9; --cat-systems-bg: rgba(124,58,237,.11);
  --cat-labs-accent:    #047857; --cat-labs-bg:    rgba(5,150,105,.12);
  --cat-other-accent:   #475569; --cat-other-bg:   rgba(100,116,139,.09);
```

In the `:root[data-theme='dark']` block (ends at line 43), before the closing brace add:

```css
  --cat-fluids-accent:  #22D3EE; --cat-fluids-bg:  rgba(8,145,178,.12);
  --cat-solids-accent:  #FBBF24; --cat-solids-bg:  rgba(217,119,6,.12);
  --cat-systems-accent: #A78BFA; --cat-systems-bg: rgba(124,58,237,.12);
  --cat-labs-accent:    #34D399; --cat-labs-bg:    rgba(5,150,105,.12);
  --cat-other-accent:   #94A3B8; --cat-other-bg:   rgba(100,116,139,.08);
```

In the `@media (prefers-color-scheme: dark) { :root:not([data-theme]) { ... } }` block (ends at line 59), before its closing braces add the same five lines as the dark block above.

Then, after that media block (after line 59, before the next section), add the category CSS classes:

```css
/* ── Category accents (electives only) — ported from the legacy planner's
      already-validated palette (app/web/semester_board_viewer.html CAT_CSS). ── */
.card-cat-fluids  { border-inline-end-color: var(--cat-fluids-accent)  !important; background: var(--cat-fluids-bg)  !important; }
.card-cat-solids  { border-inline-end-color: var(--cat-solids-accent)  !important; background: var(--cat-solids-bg)  !important; }
.card-cat-systems { border-inline-end-color: var(--cat-systems-accent) !important; background: var(--cat-systems-bg) !important; }
.card-cat-labs    { border-inline-end-color: var(--cat-labs-accent)    !important; background: var(--cat-labs-bg)    !important; }
.card-cat-other_specialization { border-inline-end-color: var(--cat-other-accent) !important; background: var(--cat-other-bg) !important; }
```

Create `web/app/components/CategoryLegend.tsx`:

```tsx
const CATEGORIES: Array<{ id: string; label: string; accentVar: string }> = [
  { id: 'mandatory', label: 'חובה', accentVar: '--purple' },
  { id: 'fluids', label: 'זורמים', accentVar: '--cat-fluids-accent' },
  { id: 'solids', label: 'מוצקים', accentVar: '--cat-solids-accent' },
  { id: 'systems', label: 'מערכות', accentVar: '--cat-systems-accent' },
  { id: 'advanced_labs', label: 'מעבדה', accentVar: '--cat-labs-accent' },
]

/** Small, collapsible color key so the CourseCard category accents are decodable at a glance. */
export default function CategoryLegend() {
  return (
    <details className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium text-[var(--text-muted)]">מקרא צבעים</summary>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
        {CATEGORIES.map((c) => (
          <span key={c.id} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block size-2.5 rounded-full"
              style={{ background: `var(${c.accentVar})` }}
            />
            {c.label}
          </span>
        ))}
      </div>
    </details>
  )
}
```

In `web/app/components/CourseCard.tsx`, map `categoryId` to the CSS class + `data-category` attribute. Add above the component (after the existing label maps):

```ts
const CATEGORY_CLASS: Record<string, string> = {
  fluids: 'card-cat-fluids',
  solids: 'card-cat-solids',
  systems: 'card-cat-systems',
  advanced_labs: 'card-cat-labs',
  other_specialization: 'card-cat-other_specialization',
}
```

Update the `<Card ...>` element (currently `<Card className="group px-3.5 py-3 transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-y-px hover:border-purple-500/30 hover:shadow-[var(--shadow-premium)]">`) to:

```tsx
    <Card
      data-category={course.categoryId ?? undefined}
      className={`group border-e-4 px-3.5 py-3 transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-y-px hover:shadow-[var(--shadow-premium)] ${
        course.categoryId ? CATEGORY_CLASS[course.categoryId] ?? '' : 'hover:border-purple-500/30'
      }`}
    >
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx jest app/components/CategoryLegend.test.tsx app/components/CourseCard.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `cd web && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/app/globals.css web/app/components/CourseCard.tsx web/app/components/CategoryLegend.tsx web/app/components/CategoryLegend.test.tsx web/app/components/CourseCard.test.tsx
git commit -m "feat(planner): color-code course cards by elective category

Ports the legacy planner's already-validated fluids/solids/systems/labs
palette (light+dark) to web/app/globals.css, applies it to CourseCard
as a border+background accent, and adds a small collapsible legend so
the colors are decodable without opening each card.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Annual courses — span both semester columns, locked

**Files:**
- Create: `web/lib/planner/annual-bands.ts`
- Create: `web/lib/planner/annual-bands.test.ts`
- Create: `web/app/components/AnnualCourseBand.tsx`
- Modify: `web/app/components/SemesterColumn.tsx`
- Modify: `web/app/components/NativePlannerBoard.tsx`
- Test: `web/app/components/NativePlannerBoard.test.tsx` (extend existing file)

- [ ] **Step 1: Write the failing test for the pure helper**

Create `web/lib/planner/annual-bands.test.ts`:

```ts
import { annualBandsOf } from './annual-bands'
import type { BoardVM } from '../board'

const board: BoardVM = {
  semesters: [
    { id: 'year_3_semester_a', title: 'א', totalWeeklyHours: null, averageDifficulty: null, warnings: [], courses: [
      { id: 'ANN-1', name: 'שנתי', weeklyHours: 4, type: 'mandatory', difficulty: null, syllabusUrl: null, hasWarnings: false, isAnnual: true },
      { id: 'M-1', name: 'רגיל', weeklyHours: 3, type: 'mandatory', difficulty: null, syllabusUrl: null, hasWarnings: false },
    ] },
    { id: 'year_3_semester_b', title: 'ב', totalWeeklyHours: null, averageDifficulty: null, warnings: [], courses: [
      { id: 'ANN-1', name: 'שנתי', weeklyHours: 4, type: 'mandatory', difficulty: null, syllabusUrl: null, hasWarnings: false, isAnnual: true },
    ] },
    { id: 'year_4_semester_a', title: 'ג', totalWeeklyHours: null, averageDifficulty: null, warnings: [], courses: [] },
    { id: 'year_4_semester_b', title: 'ד', totalWeeklyHours: null, averageDifficulty: null, warnings: [], courses: [] },
  ],
}

test('one band per unique annual course, positioned at the start of its year pair', () => {
  const bands = annualBandsOf(board)
  expect(bands).toEqual([{ course: board.semesters[0].courses[0], startIndex: 0 }])
})

test('no bands when there are no annual courses', () => {
  const noAnnual: BoardVM = { semesters: board.semesters.map((s) => ({ ...s, courses: s.courses.filter((c) => !c.isAnnual) })) }
  expect(annualBandsOf(noAnnual)).toEqual([])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx jest lib/planner/annual-bands.test.ts`
Expected: FAIL — module `./annual-bands` does not exist.

- [ ] **Step 3: Implement the pure helper**

Create `web/lib/planner/annual-bands.ts`:

```ts
import type { BoardVM, CourseVM } from '../board'

export type AnnualBand = { course: CourseVM; startIndex: number }

/**
 * A year-long course appears once in each of its year's two semester
 * columns (isAnnual: true on both). De-duplicate it into ONE band per
 * year-pair, positioned at the pair's first (even) index — so it can be
 * rendered once, spanning both columns, instead of as two independent cards.
 * Assumes the canonical 4-semester a/b/a/b ordering (SEMESTER_ORDER).
 */
export function annualBandsOf(board: BoardVM): AnnualBand[] {
  const bands: AnnualBand[] = []
  for (let i = 0; i + 1 < board.semesters.length; i += 2) {
    const seen = new Set<string>()
    for (const semester of [board.semesters[i], board.semesters[i + 1]]) {
      for (const course of semester.courses) {
        if (!course.isAnnual || seen.has(course.id)) continue
        seen.add(course.id)
        bands.push({ course, startIndex: i })
      }
    }
  }
  return bands
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx jest lib/planner/annual-bands.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing component test**

Add to `web/app/components/NativePlannerBoard.test.tsx` (matching its existing `board` fixture style — check the existing file for how it builds a `BoardVM`, and reuse the same shape):

```tsx
test('an annual course renders once, spanning both columns of its year, not inside either SemesterColumn', () => {
  const board: BoardVM = {
    semesters: [
      { id: 'year_3_semester_a', title: 'שנה ג׳ — סמסטר א׳', totalWeeklyHours: null, averageDifficulty: null, warnings: [], courses: [
        { id: 'ANN-1', name: 'קורס שנתי', weeklyHours: 4, type: 'mandatory', difficulty: null, syllabusUrl: null, hasWarnings: false, isAnnual: true },
      ] },
      { id: 'year_3_semester_b', title: 'שנה ג׳ — סמסטר ב׳', totalWeeklyHours: null, averageDifficulty: null, warnings: [], courses: [
        { id: 'ANN-1', name: 'קורס שנתי', weeklyHours: 4, type: 'mandatory', difficulty: null, syllabusUrl: null, hasWarnings: false, isAnnual: true },
      ] },
      { id: 'year_4_semester_a', title: 'שנה ד׳ — סמסטר א׳', totalWeeklyHours: null, averageDifficulty: null, warnings: [], courses: [] },
      { id: 'year_4_semester_b', title: 'שנה ד׳ — סמסטר ב׳', totalWeeklyHours: null, averageDifficulty: null, warnings: [], courses: [] },
    ],
  }
  render(<NativePlannerBoard board={board} />)
  expect(screen.getAllByText('קורס שנתי')).toHaveLength(1)
  expect(screen.getByText('שנתי (א׳+ב׳)')).toBeInTheDocument()
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd web && npx jest app/components/NativePlannerBoard.test.tsx`
Expected: FAIL — the course currently renders twice (once per column), and no "שנתי (א׳+ב׳)" badge exists.

- [ ] **Step 7: Implement the band component and board layout**

Create `web/app/components/AnnualCourseBand.tsx`:

```tsx
import type { CourseVM } from '../../lib/board'
import { Badge, Card } from './ui'

/** A year-long course rendered once, spanning both semester columns of its year. Never draggable — moving or splitting it would break the atomic placement. */
export default function AnnualCourseBand({ course, startIndex }: { course: CourseVM; startIndex: number }) {
  return (
    <div
      style={{ gridColumn: `${startIndex + 1} / span 2`, gridRow: 1 }}
      className="min-w-0"
    >
      <Card className="flex items-center justify-between gap-3 border-e-4 border-[var(--purple)] px-3.5 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold leading-snug">{course.name}</h3>
          <span dir="ltr" className="text-[11px] font-mono tracking-tight text-[var(--text-muted)]">{course.id}</span>
        </div>
        <Badge variant="purple">שנתי (א׳+ב׳)</Badge>
      </Card>
    </div>
  )
}
```

In `web/app/components/SemesterColumn.tsx`, exclude annual courses from the per-column list (they render once, at the board level, instead). Replace the `semester.courses.length === 0 ? ... : semester.courses.map(...)` block (lines 149–157) and the course-count badge (line 111–115) using a single derived list:

Add right after the function signature's opening brace (after line 33's `}) {`):

```ts
  const visibleCourses = semester.courses.filter((c) => !c.isAnnual)
```

Replace the header's course-count span (originally):
```tsx
          {semester.courses.length > 0 && (
            <span className="text-[11px] text-[var(--text-muted)]">
              {semester.courses.length} קורסים
            </span>
          )}
```
with:
```tsx
          {visibleCourses.length > 0 && (
            <span className="text-[11px] text-[var(--text-muted)]">
              {visibleCourses.length} קורסים
            </span>
          )}
```

Replace the rendering block (originally):
```tsx
      {semester.courses.length === 0 ? (
        <EmptyState>אין קורסים משובצים</EmptyState>
      ) : (
        semester.courses.map((c) => <CourseCard
          key={c.id} course={c} onRemove={onRemoveCourse} onMove={onMoveCourse}
          moveDestinations={moveDestinations} mutationPending={mutationPending}
          onDragStateChange={onDragStateChange}
        />)
      )}
```
with:
```tsx
      {visibleCourses.length === 0 ? (
        <EmptyState>אין קורסים משובצים</EmptyState>
      ) : (
        visibleCourses.map((c) => <CourseCard
          key={c.id} course={c} onRemove={onRemoveCourse} onMove={onMoveCourse}
          moveDestinations={moveDestinations} mutationPending={mutationPending}
          onDragStateChange={onDragStateChange}
        />)
      )}
```

In `web/app/components/NativePlannerBoard.tsx`, switch the grid from auto column-flow to an explicit 2-row grid and render the annual bands in row 1. Replace the whole file body from the import block through the closing of the component (the full file, since the grid container changes):

```tsx
import SemesterColumn from './SemesterColumn'
import AnnualCourseBand from './AnnualCourseBand'
import { EmptyState } from './ui'
import type { BoardVM } from '../../lib/board'
import { annualBandsOf } from '../../lib/planner/annual-bands'
import type { PlannerDragPayload } from '../../lib/planner/drag-payload'

/**
 * Native semester board for the canonical planner. It renders the shared
 * board view model and delegates every manual mutation to the journey's
 * server-authority callbacks. The shared drag intent keeps feedback truthful
 * even when a browser hides DataTransfer contents during dragover. Annual
 * (year-long) courses are pulled out of their two semester columns and
 * rendered once, in row 1, spanning both columns of their year — they are
 * never independently movable.
 */
export default function NativePlannerBoard({ board, onRemoveCourse, onAddCourse, onMoveCourse, mutationPending = false, activeDrag, rejectedSemesterId, rejectedDropKey, onDragStateChange, readOnly = false }: {
  board: BoardVM
  onRemoveCourse?: (courseId: string) => void
  onAddCourse?: (courseId: string, semesterId: string) => void
  onMoveCourse?: (courseId: string, semesterId: string) => void
  mutationPending?: boolean
  activeDrag?: PlannerDragPayload | null
  /** The last target refused by server-side academic validation. */
  rejectedSemesterId?: string | null
  /** Changes on every refusal so the target feedback animation restarts. */
  rejectedDropKey?: string | number | null
  onDragStateChange?: (drag: PlannerDragPayload | null) => void
  readOnly?: boolean
}) {
  if (board.semesters.length === 0) {
    return <EmptyState>נתוני הלוח לתוכנית זו עדיין לא זמינים כאן</EmptyState>
  }
  const annualBands = annualBandsOf(board)
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
    <div
      role="list"
      aria-label="לוח סמסטרים"
      className="grid min-w-full gap-2 p-2"
      style={{ gridTemplateColumns: `repeat(${board.semesters.length}, minmax(17rem, 1fr))` }}
    >
      {annualBands.map((band) => (
        <AnnualCourseBand key={band.course.id} course={band.course} startIndex={band.startIndex} />
      ))}
      {board.semesters.map((s, i) => (
        <div role="listitem" key={s.id} style={{ gridColumn: i + 1, gridRow: 2 }} className="min-w-0">
          <SemesterColumn
            semester={s} index={i} onRemoveCourse={readOnly ? undefined : onRemoveCourse} onAddCourse={readOnly ? undefined : onAddCourse} onMoveCourse={readOnly ? undefined : onMoveCourse}
            moveDestinations={board.semesters
              .filter((destination) => destination.id !== s.id)
              .map((destination) => ({ semesterId: destination.id, label: destination.title }))}
            mutationPending={readOnly || mutationPending}
            activeDrag={readOnly ? null : activeDrag}
            rejected={rejectedSemesterId === s.id}
            rejectedKey={rejectedDropKey}
            onDragStateChange={readOnly ? undefined : onDragStateChange}
          />
        </div>
      ))}
    </div>
    </div>
  )
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd web && npx jest app/components/NativePlannerBoard.test.tsx lib/planner/annual-bands.test.ts`
Expected: PASS

- [ ] **Step 9: Run the full suite**

Run: `cd web && npm test`
Expected: PASS (no `SemesterColumn.test.tsx` exists yet at this point in the plan — it's created in Task 8).

- [ ] **Step 10: Commit**

```bash
git add web/lib/planner/annual-bands.ts web/lib/planner/annual-bands.test.ts web/app/components/AnnualCourseBand.tsx web/app/components/SemesterColumn.tsx web/app/components/NativePlannerBoard.tsx web/app/components/NativePlannerBoard.test.tsx
git commit -m "feat(planner): render annual courses as one band spanning both semester columns

Year-long courses previously rendered as two independent (and, after
the Task 1 fix, independently draggable) half-cards — one per semester
— which could split an atomic placement. They now render once, in a
new row above the semester columns, spanning both halves of their
year, and are excluded from each SemesterColumn's own list/count.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Compact degree-progress widget

**Files:**
- Modify: `web/lib/requirements.ts`
- Create: `web/app/components/ProgressBadge.tsx`
- Test: `web/lib/requirements.test.ts` (extend existing file, or create if none exists)
- Test: `web/app/components/ProgressBadge.test.tsx` (new)
- Modify: `web/app/components/NativePlannerJourney.tsx`

- [ ] **Step 1: Write the failing tests**

Check whether `web/lib/requirements.test.ts` already exists; add this test to it (create the file with this one test if it doesn't exist):

```ts
import { adaptRequirementsFromModel } from './requirements'
import type { BoardModel } from '../../shared/planner/model'

test('adaptRequirementsFromModel maps BoardModel.requirementsValidation into the existing RequirementsVM shape', () => {
  const model = {
    catalogRevision: 'rev-1' as never, courseCatalog: {}, semesters: [],
    requirementsValidation: {
      valid: false, totalRequiredHours: 185, plannedHours: 128.5, remainingHours: 56.5,
      coreCoursesTotalMin: 6, coreCoursesSelected: 0, coreCoursesSatisfied: false,
      categories: [{ categoryId: 'fluids', nameHe: 'זורמים', minCourses: 1, selectedCount: 0, satisfied: false, missingCount: 1 }],
      warnings: ['שעות חסרות: 56.5'],
    },
  } satisfies BoardModel
  expect(adaptRequirementsFromModel(model)).toEqual({
    valid: false, plannedHours: 128.5, totalRequiredHours: 185, remainingHours: 56.5,
    core: { selected: 0, min: 6, satisfied: false },
    categories: [{ id: 'fluids', title: 'זורמים', minCourses: 1, selectedCount: 0, satisfied: false, missingCount: 1 }],
    warnings: ['שעות חסרות: 56.5'], explanation: null,
  })
})

test('adaptRequirementsFromModel returns null when the model carries no requirements block', () => {
  const model = { catalogRevision: 'rev-1' as never, courseCatalog: {}, semesters: [] } satisfies BoardModel
  expect(adaptRequirementsFromModel(model)).toBeNull()
})
```

Create `web/app/components/ProgressBadge.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import ProgressBadge from './ProgressBadge'
import type { RequirementsVM } from '../../lib/requirements'

const VM: RequirementsVM = {
  valid: false, plannedHours: 128.5, totalRequiredHours: 185, remainingHours: 56.5,
  core: { selected: 0, min: 6, satisfied: false },
  categories: [{ id: 'fluids', title: 'זורמים', minCourses: 1, selectedCount: 0, satisfied: false, missingCount: 1 }],
  warnings: [], explanation: null,
}

test('shows the hours summary collapsed, and expands the category breakdown on click', () => {
  render(<ProgressBadge requirements={VM} />)
  expect(screen.getByText('128.5/185 ש״ש')).toBeInTheDocument()
  expect(screen.queryByText('זורמים')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /התקדמות בתוכנית/ }))
  expect(screen.getByText('זורמים')).toBeInTheDocument()
})

test('renders nothing when there is no requirements data', () => {
  const { container } = render(<ProgressBadge requirements={null} />)
  expect(container).toBeEmptyDOMElement()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx jest lib/requirements.test.ts app/components/ProgressBadge.test.tsx`
Expected: FAIL — `adaptRequirementsFromModel` not exported; `ProgressBadge` module doesn't exist.

- [ ] **Step 3: Implement**

Add to `web/lib/requirements.ts` (below the existing `adaptRequirements`):

```ts
import type { BoardModel } from '../../shared/planner/model'

/**
 * Same RequirementsVM shape as adaptRequirements, sourced from the canonical
 * BoardModel (used by /planner/native) instead of the raw board JSON (used
 * by /plan). Both paths pass through shipped numbers only — never recomputed.
 */
export function adaptRequirementsFromModel(model: BoardModel): RequirementsVM | null {
  const v = model.requirementsValidation
  if (!v) return null
  return {
    valid: v.valid,
    plannedHours: v.plannedHours,
    totalRequiredHours: v.totalRequiredHours,
    remainingHours: v.remainingHours,
    core: { selected: v.coreCoursesSelected, min: v.coreCoursesTotalMin, satisfied: v.coreCoursesSatisfied },
    categories: v.categories.map((c) => ({
      id: c.categoryId, title: c.nameHe, minCourses: c.minCourses,
      selectedCount: c.selectedCount, satisfied: c.satisfied, missingCount: c.missingCount,
    })),
    warnings: v.warnings,
    explanation: null,
  }
}
```

Create `web/app/components/ProgressBadge.tsx`:

```tsx
import type { RequirementsVM } from '../../lib/requirements'
import { Badge } from './ui'

/**
 * Small always-visible header badge showing degree-progress at a glance
 * (hours placed/required + per-category coverage), expandable for detail.
 * Reuses the same RequirementsVM RequirementsProgressPanel (/plan) renders —
 * this is a compact trigger for the same data, not a second computation.
 */
export default function ProgressBadge({ requirements }: { requirements: RequirementsVM | null }) {
  if (!requirements) return null
  const satisfied = requirements.remainingHours <= 0
  const [open, setOpen] = useReactState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`התקדמות בתוכנית: ${requirements.plannedHours} מתוך ${requirements.totalRequiredHours} ש״ש`}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]"
      >
        <span
          aria-hidden="true"
          className={`size-2 rounded-full ${satisfied ? 'bg-emerald-500' : 'bg-amber-400'}`}
        />
        {requirements.plannedHours}/{requirements.totalRequiredHours} ש״ש
      </button>
      {open && (
        <div className="absolute z-10 mt-2 w-72 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-premium)] backdrop-blur-sm">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold">נותרו {requirements.remainingHours} ש״ש</span>
            <span className="text-[var(--text-muted)]">קורסי ליבה: {requirements.core.selected}/{requirements.core.min}</span>
          </div>
          <div className="mt-2 flex flex-col gap-1.5">
            {requirements.categories.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-xs">
                <span>{c.title}</span>
                {c.satisfied
                  ? <Badge variant="success">הושלם</Badge>
                  : <Badge variant="warn">{c.selectedCount}/{c.minCourses}</Badge>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

The `aria-label`/click target above needs the accessible name to contain "התקדמות בתוכנית" per the test — adjust the button's visible+accessible text so `getByRole('button', { name: /התקדמות בתוכנית/ })` matches; simplest fix: change `aria-label` to `` `התקדמות בתוכנית — ${requirements.plannedHours} מתוך ${requirements.totalRequiredHours} ש״ש` ``.

Add the React import at the top of the file (the sketch above uses a placeholder `useReactState` — replace it with a real import):

```tsx
import { useState } from 'react'
import type { RequirementsVM } from '../../lib/requirements'
import { Badge } from './ui'
```

and use `useState(false)` instead of `useReactState(false)` in the component body.

Wire it into `web/app/components/NativePlannerJourney.tsx`. Add the import near the top (alongside the other component imports, e.g. after `import NativePlannerBoard from './NativePlannerBoard'`):

```tsx
import ProgressBadge from './ProgressBadge'
import { adaptRequirementsFromModel } from '../../lib/requirements'
```

In the returned JSX, inside `<section aria-label="התוכנית הנוכחית">` (around the `<h2>` header), add the badge next to the existing header row. Replace:

```tsx
        <section aria-label="התוכנית הנוכחית">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold tracking-tight">התוכנית הנוכחית</h2>
            {alternativeBoard && <span className="text-xs text-[var(--text-muted)]">לא נשמר עד לאישור מפורש</span>}
          </div>
```

with:

```tsx
        <section aria-label="התוכנית הנוכחית">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold tracking-tight">התוכנית הנוכחית</h2>
            <div className="flex items-center gap-2">
              {alternativeBoard && <span className="text-xs text-[var(--text-muted)]">לא נשמר עד לאישור מפורש</span>}
              <ProgressBadge requirements={adaptRequirementsFromModel(current)} />
            </div>
          </div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx jest lib/requirements.test.ts app/components/ProgressBadge.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `cd web && npm test`
Expected: PASS — in particular check `NativePlannerJourney.test.tsx` still passes (the new badge is additive; if any existing snapshot or exact-header-text assertion breaks, update it to account for the new badge markup, don't loosen the assertion's intent).

- [ ] **Step 6: Commit**

```bash
git add web/lib/requirements.ts web/lib/requirements.test.ts web/app/components/ProgressBadge.tsx web/app/components/ProgressBadge.test.tsx web/app/components/NativePlannerJourney.tsx
git commit -m "feat(planner): add a compact always-visible degree-progress badge

Reuses the same RequirementsVM RequirementsProgressPanel (/plan) already
renders, via a new adaptRequirementsFromModel() that reads the canonical
BoardModel.requirementsValidation threaded through in the prior task.
No new computation — a compact expandable trigger for the same shipped
numbers, always visible on /planner/native instead of buried in a drawer.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Animation polish

**Files:**
- Modify: `web/app/globals.css`
- Modify: `web/app/components/SemesterColumn.tsx`
- Modify: `web/app/components/NativePlannerJourney.tsx`
- Test: `web/app/components/SemesterColumn.test.tsx` (new — verified during planning that no such file exists yet, despite SemesterColumn.tsx itself being an existing component)

- [ ] **Step 1: Write the failing test**

Create `web/app/components/SemesterColumn.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import SemesterColumn from './SemesterColumn'
import type { SemesterVM } from '../../lib/board'

const SEMESTER_FIXTURE: SemesterVM = {
  id: 'year_3_semester_a', title: 'שנה ג׳ — סמסטר א׳', totalWeeklyHours: null, averageDifficulty: null,
  warnings: [], courses: [],
}

test('a successful placement flashes the target column via data-just-placed, keyed to re-trigger on repeat', () => {
  const { rerender } = render(
    <SemesterColumn semester={SEMESTER_FIXTURE} index={0} justPlaced justPlacedKey={1} />,
  )
  expect(screen.getByLabelText(SEMESTER_FIXTURE.title)).toHaveAttribute('data-just-placed', 'true')
  rerender(<SemesterColumn semester={SEMESTER_FIXTURE} index={0} justPlaced={false} justPlacedKey={1} />)
  expect(screen.getByLabelText(SEMESTER_FIXTURE.title)).not.toHaveAttribute('data-just-placed')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx jest app/components/SemesterColumn.test.tsx`
Expected: FAIL — `SemesterColumn` accepts no `justPlaced`/`justPlacedKey` props yet.

- [ ] **Step 3: Implement**

In `web/app/globals.css`, add a landing-pulse keyframe and class after the existing `.planner-drop-target-rejected` rule (near line 319–321):

```css
@keyframes planner-drop-placed {
  0%   { box-shadow: inset 0 0 0 2px rgb(16 185 129 / 0%),  0 0 0 0 rgb(16 185 129 / 0%); }
  35%  { box-shadow: inset 0 0 0 3px rgb(16 185 129 / 80%), 0 0 0 8px rgb(16 185 129 / 16%); }
  100% { box-shadow: inset 0 0 0 2px rgb(16 185 129 / 0%),  0 0 0 0 rgb(16 185 129 / 0%); }
}
.planner-drop-target-placed {
  animation: planner-drop-placed 420ms ease-out both;
}
```

In `web/app/components/SemesterColumn.tsx`, accept the two new props and apply the class. Add to the props destructure (line 9–20):

```tsx
export default function SemesterColumn({
  semester,
  index,
  onRemoveCourse,
  onAddCourse,
  onMoveCourse,
  moveDestinations,
  mutationPending,
  activeDrag,
  rejected = false,
  rejectedKey,
  justPlaced = false,
  justPlacedKey,
  onDragStateChange,
}: {
  semester: SemesterVM
  index: number
  onRemoveCourse?: (courseId: string) => void
  onAddCourse?: (courseId: string, semesterId: string) => void
  onMoveCourse?: (courseId: string, semesterId: string) => void
  moveDestinations?: Array<{ semesterId: string; label: string }>
  mutationPending?: boolean
  activeDrag?: PlannerDragPayload | null
  rejected?: boolean
  rejectedKey?: string | number | null
  /** True for one render right after a successful add/move lands in this column. */
  justPlaced?: boolean
  /** Changes on every placement so the flash animation restarts on a repeat. */
  justPlacedKey?: string | number | null
  onDragStateChange?: (drag: PlannerDragPayload | null) => void
}) {
```

Update the root `<section>` element (originally lines 83–107) to add the data attribute and class. Replace:

```tsx
    <section
      aria-label={semester.title}
      data-drop-state={rejected ? 'rejected' : visibleDragState ?? undefined}
      onDragEnter={updateDragState}
      onDragOver={updateDragState}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragState(null)
      }}
      onDrop={(event) => {
        setDragState(null)
        onDragStateChange?.(null)
        if (mutationPending) return
        const payload = readPlannerDrag(event.dataTransfer) ?? activeDrag ?? null
        if (!acceptsPayload(payload)) return
        if (payload.kind === 'repository' && onAddCourse) {
          event.preventDefault()
          onAddCourse(payload.courseId, semester.id)
        } else if (payload.kind === 'board' && onMoveCourse) {
          event.preventDefault()
          onMoveCourse(payload.courseId, semester.id)
        }
      }}
      className={`rise flex min-h-[28rem] min-w-0 flex-col gap-2.5 border-l border-[var(--border)] p-3 last:border-l-0 ${index > 0 ? `rise-${Math.min(index, 3)}` : ''} ${visibleDragState === 'allowed' ? 'planner-drop-target-active' : ''} ${visibleDragState === 'invalid' ? 'planner-drop-target-invalid' : ''} ${visibleDragState === 'unknown' ? 'planner-drop-target-pending' : ''} ${rejected ? 'planner-drop-target-rejected' : ''}`}
    >
```

with:

```tsx
    <section
      aria-label={semester.title}
      data-drop-state={rejected ? 'rejected' : visibleDragState ?? undefined}
      data-just-placed={justPlaced ? 'true' : undefined}
      onDragEnter={updateDragState}
      onDragOver={updateDragState}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragState(null)
      }}
      onDrop={(event) => {
        setDragState(null)
        onDragStateChange?.(null)
        if (mutationPending) return
        const payload = readPlannerDrag(event.dataTransfer) ?? activeDrag ?? null
        if (!acceptsPayload(payload)) return
        if (payload.kind === 'repository' && onAddCourse) {
          event.preventDefault()
          onAddCourse(payload.courseId, semester.id)
        } else if (payload.kind === 'board' && onMoveCourse) {
          event.preventDefault()
          onMoveCourse(payload.courseId, semester.id)
        }
      }}
      className={`rise flex min-h-[28rem] min-w-0 flex-col gap-2.5 border-l border-[var(--border)] p-3 last:border-l-0 ${index > 0 ? `rise-${Math.min(index, 3)}` : ''} ${visibleDragState === 'allowed' ? 'planner-drop-target-active' : ''} ${visibleDragState === 'invalid' ? 'planner-drop-target-invalid' : ''} ${visibleDragState === 'unknown' ? 'planner-drop-target-pending' : ''} ${rejected ? 'planner-drop-target-rejected' : ''} ${justPlaced ? 'planner-drop-target-placed' : ''}`}
    >
```

A CSS `animation` on a class restarts only when the element is freshly mounted (or the class is removed then re-added) — since `justPlaced` here just toggles a class on an element that stays mounted, a *second* placement in the *same* column back-to-back would not replay the animation. Force a fresh mount on each placement by keying the element **from its parent** (`NativePlannerBoard.tsx`, where this column is created inside `.map()` — a `key` set directly on `SemesterColumn`'s own root has no such effect). In `NativePlannerBoard.tsx`, change:

```tsx
        <div role="listitem" key={s.id} style={{ gridColumn: i + 1, gridRow: 2 }} className="min-w-0">
```

to

```tsx
        <div role="listitem" key={`${s.id}-${justPlacedSemesterId === s.id ? justPlacedKey ?? 'p' : 'idle'}`} style={{ gridColumn: i + 1, gridRow: 2 }} className="min-w-0">
```

`NativePlannerBoard` needs two new props, `justPlacedSemesterId`/`justPlacedKey`, threaded the same way `rejectedSemesterId`/`rejectedDropKey` already are — add them to its prop list and pass `justPlaced={justPlacedSemesterId === s.id}` / `justPlacedKey={justPlacedKey}` to each `SemesterColumn`.

In `web/app/components/NativePlannerJourney.tsx`, add the state and set it on success, mirroring the existing `showRejectedDrop` pattern exactly. Add near `showRejectedDrop` (after its `useEffect` cleanup, around line 246):

```tsx
  const [justPlaced, setJustPlaced] = useState<{ semesterId: string; key: number } | null>(null)
  const justPlacedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showJustPlaced = useCallback((semesterId: string) => {
    if (justPlacedTimerRef.current) clearTimeout(justPlacedTimerRef.current)
    const key = Date.now()
    setJustPlaced({ semesterId, key })
    justPlacedTimerRef.current = setTimeout(() => {
      setJustPlaced((current) => current?.key === key ? null : current)
      justPlacedTimerRef.current = null
    }, 500)
  }, [])
  useEffect(() => () => {
    if (justPlacedTimerRef.current) clearTimeout(justPlacedTimerRef.current)
  }, [])
```

Call `showJustPlaced(semesterId)` on the success path of both `commitManualAdd` and `commitManualMove`, right after `setCurrent(...)` in each. In `commitManualAdd`, after the line `setCurrent(applyGeneratedToBoard({ semesters: result.board.semesters } as GeneratedPlanModel, current))` (inside that function), add `showJustPlaced(semesterId)`. In `commitManualMove`, after its equivalent `setCurrent(...)` line, add `showJustPlaced(semesterId)`.

Finally, pass the new state into `NativePlannerBoard`'s call site (next to the existing `rejectedSemesterId`/`rejectedDropKey` props):

```tsx
            justPlacedSemesterId={alternativeBoard ? null : justPlaced?.semesterId}
            justPlacedKey={alternativeBoard ? null : justPlaced?.key}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx jest app/components/SemesterColumn.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `cd web && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/app/globals.css web/app/components/SemesterColumn.tsx web/app/components/NativePlannerBoard.tsx web/app/components/NativePlannerJourney.tsx web/app/components/SemesterColumn.test.tsx
git commit -m "feat(planner): add a landing-pulse animation on successful placement

Mirrors the existing rejected-drop feedback mechanism (state + timer +
a keyed remount to restart the animation on repeat) for the success
case: the target semester column flashes green briefly after a manual
add/move actually lands. Existing hover/drag-source/drop-target
animations were already present and are unchanged.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Manual verification on `/planner/native` with real data

**Files:** none (verification only)

- [ ] **Step 1: Start the real API server locally**

Per the project's documented local-verification flow (no DB, no AI key needed):

```bash
AI_DEV_MODE=true AI_DEV_BYPASS_QUOTA=true npx tsx scripts/dev_api_server.ts
```

Run this from the repo root, in a separate terminal, and leave it running (port 3002).

- [ ] **Step 2: Point the web app at it**

Ensure `web/.env.local` (git-ignored) contains:

```
PLANNER_API_ORIGIN=http://localhost:3002
```

- [ ] **Step 3: Start the Next dev server and open the board**

```bash
cd web && npm run dev
```

Open `http://localhost:3001/planner/native?program=mechanical_engineering_2027` in a browser (use the Browser pane tools, not Bash, to drive this).

- [ ] **Step 4: Verify each feature against the real ME-2027 board**

This program's board data has real fixed/flexible/annual/categorized courses (confirmed during design: 7 fixed, 4 flexible, 2 annual mandatory course-placements; fluids/solids/systems/advanced_labs each populated with real course ids), so every code path in this plan is exercisable:

- A flexible-mandatory course (e.g. `0542-3620`) shows a drag handle and can actually be dropped into its other legal semester.
- The annual course (`0542-3792`) renders once, spanning both columns of year 3, has no drag handle, and carries a "שנתי (א׳+ב׳)" badge.
- Elective cards show a colored left-accent matching their category; the "מקרא צבעים" legend below the board decodes the colors.
- The header shows the compact `X/185 ש״ש` progress badge; clicking it expands the per-category ✓/⚠ breakdown.
- Dragging a course over a valid vs. invalid semester column shows the existing allowed/invalid feedback; dropping successfully triggers the new green landing flash.

- [ ] **Step 5: Screenshot and share**

Take a screenshot of the board (via the Browser pane's screenshot tool) showing the colored cards, the annual band, and the expanded progress badge, and share it as proof of the working feature — do not just claim it works.

- [ ] **Step 6: Stop the dev servers**

Stop both the `dev_api_server.ts` process and `next dev` (per the project's documented gotcha: leaving a `next dev` server running while later running `npm run build` will corrupt `.next` — always stop the dev server first if a production build is needed afterward).

---

## Self-review notes (for whoever executes this plan)

- **Spec coverage:** §1 (bug fix) → Task 1. §2 (category+placement-policy model) → Task 2. §3 (requirements passthrough) → Task 3. §4 (category colors) → Tasks 4–5. §5 (annual spanning) → Tasks 4, 6. §6 (flexible-mandatory dragging) → Task 1 (no new mechanism needed, confirmed by the spec). §7 (progress widget) → Task 7. §8 (animation polish) → Task 8.
- **Type consistency:** `BoardCourseModel.programCategoryId`/`placementPolicy` (Task 2) are read by `board-vm.ts` (Task 4) via the exact same field names; `BoardModel.requirementsValidation` (Task 3) is read by `adaptRequirementsFromModel` (Task 7) via the exact same field names (`plannedHours`, `coreCoursesTotalMin`, etc.) — verified consistent across tasks.
- Task 8's `key` placement note (React `key` only works when set by the mapping parent) is called out explicitly in-line rather than left as a subtle bug — implement the corrected version (keying at `NativePlannerBoard`'s `.map()`), not the first draft shown before the correction.
