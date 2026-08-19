/**
 * academic_progress.ts — ONE authoritative recognition of what a student has
 * already completed, and what the degree therefore still requires.
 *
 * ── The defect this exists to fix ────────────────────────────────────────────
 * The shared requirement accounting was asymmetric. `assessCompleteness`
 * filtered mandatory requirements by `completedCourseIds`, and `priorHours`
 * credited completed hours — but `CategoryReq.required` was the program's FULL
 * `min_courses` and nothing ever reduced it, while `categoriesSatisfied`
 * counted only courses PLACED in the plan state (which
 * `planContextToState` has already stripped completed courses from). A student
 * who had genuinely completed the one course their category required was still
 * told to take another from the same category.
 *
 * ── What is authoritative here ───────────────────────────────────────────────
 * Only two things: the program's own requirement declaration
 * (`metadata.program_requirements_categories` — `min_courses` plus an explicit
 * `course_ids` pool per category) and the catalog record for a course id.
 * Nothing else may create a contribution:
 *
 *   - an aggregate hours total never creates a course identity;
 *   - a user-entered label never creates a course identity;
 *   - a course TITLE never determines a category;
 *   - a syllabus topic never determines a formal degree category.
 *
 * ── Category semantics, established from the real data, not assumed ──────────
 * `min_courses` is a COUNT of courses, not credits. In the TAU Mechanical
 * program the pools of the categories that actually require something
 * (`min_courses > 0`) are pairwise DISJOINT — verified directly against
 * `data/boards/mechanical_engineering_2027.json`. So membership is FIXED, and
 * there is no allocation/choice rule to model: a deterministic allocation layer
 * would have been inventing a rule this program does not have.
 *
 * That is a fact about today's data, not a licence to assume it forever. So a
 * course found in two or more requiring pools is NOT silently allocated to one
 * of them and NOT counted twice: it is reported as `ambiguous` and contributes
 * to no category, because over-crediting could let someone believe a
 * requirement is met when the program never said so. Under-crediting is
 * recoverable — the planner simply schedules a course — and it is surfaced
 * rather than hidden.
 *
 * ── Generic by construction ─────────────────────────────────────────────────
 * Nothing here reads a course id, a Hebrew category name, a year, or a title.
 * It consumes typed requirements and a course→pool mapping, so a different
 * program model is the only thing another degree needs.
 */
import { createHash } from 'crypto';

/** One category as the PROGRAM declares it. */
export interface ProgramCategoryRequirement {
  categoryId: string;
  name: string;
  /** Minimum number of courses the program requires from this pool. */
  minCourses: number;
  /** The authoritative membership pool. Nothing else confers membership. */
  courseIds: readonly string[];
}

/** Why a completed course did or did not contribute. Never inferred. */
export type RecognitionStatus =
  /** In the catalog, and mapped to exactly one requiring category. */
  | 'recognized_category'
  /** In the catalog, but no requiring category claims it. Credits still count. */
  | 'recognized_no_category'
  /** In two or more requiring pools with no authoritative rule to choose. */
  | 'ambiguous_category'
  /** No authoritative catalog record — contributes nothing at all. */
  | 'unresolved';

export interface CompletedCourseRecognition {
  courseId: string;
  status: RecognitionStatus;
  /** Authoritative hours, or null when the catalog does not state them. */
  hours: number | null;
  /** The single category it contributed to, when status is recognized_category. */
  categoryId?: string;
  /** Every requiring pool containing it — populated for the ambiguous case. */
  candidateCategoryIds?: string[];
}

export interface CategoryProgress {
  categoryId: string;
  name: string;
  /** The program's own minimum. Never mutated. */
  required: number;
  /** Completed course ids authoritatively recognized for this category. */
  satisfiedBy: string[];
  /** What the plan must still supply: `max(0, required - satisfiedBy.length)`. */
  remainingRequired: number;
}

export interface AcademicProgress {
  /** Deduplicated and sorted — the same id reported twice is one course. */
  completedCourseIds: string[];
  /** Completed ids with an authoritative catalog record. */
  recognizedCourseIds: string[];
  /** Completed ids with NO authoritative record. Unknown, not absent. */
  unresolvedCourseIds: string[];
  /** Completed ids claimed by two or more requiring pools. */
  ambiguousCourseIds: string[];
  /**
   * Hours credited from authoritative course records only. A recognized course
   * whose catalog hours are unknown adds nothing rather than a guess.
   */
  recognizedHours: number;
  /** Recognized courses whose authoritative hours are unknown — disclosure. */
  unknownHoursCourseIds: string[];
  categories: CategoryProgress[];
  perCourse: CompletedCourseRecognition[];
  /**
   * A stable digest of the RECOGNITION RESULT, for audit and for proving every
   * alternative in one response was planned against the same progress.
   *
   * Deliberately distinct from `apply_runtime.academicStatusDigest`, which
   * digests the raw status a CLIENT claims. This one digests what the SERVER
   * actually recognized from it; they answer different questions and a single
   * value could not honestly serve both.
   */
  digest: string;
}

export interface ComputeAcademicProgressInput {
  /** Raw completed ids as reported — duplicates and unknowns welcome. */
  completedCourseIds: readonly string[];
  /** Authoritative catalog hours by course id. Absent id ⇒ no catalog record. */
  catalogHours: ReadonlyMap<string, number | null | undefined>;
  /** The program's declared requirements. */
  requirements: readonly ProgramCategoryRequirement[];
}

const sha16 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);

/**
 * Recognize completion against the authoritative program and catalog.
 *
 * Pure and deterministic: every output list is sorted, so nothing depends on
 * the order ids arrived in, the order categories are declared in, or object
 * key order.
 */
export function computeAcademicProgress(input: ComputeAcademicProgressInput): AcademicProgress {
  // Duplicates collapse here, once, before anything can count them twice —
  // including the same id appearing in both a "courses" and an "electives"
  // section of the request, which arrive as one list by the time they reach us.
  const completedCourseIds = [...new Set(input.completedCourseIds.map((id) => String(id)))].sort();

  // Only categories that actually REQUIRE something can be satisfied. A pool
  // with `minCourses: 0` (an "other/by approval" bucket) is not a requirement,
  // so membership in it is not a contribution and does not make a course
  // ambiguous either.
  const requiring = input.requirements
    .filter((c) => c.minCourses > 0)
    .slice()
    .sort((a, b) => (a.categoryId < b.categoryId ? -1 : a.categoryId > b.categoryId ? 1 : 0));

  /** course id → every requiring category claiming it. */
  const claims = new Map<string, string[]>();
  for (const cat of requiring) {
    for (const id of new Set(cat.courseIds)) {
      const list = claims.get(id) ?? [];
      if (!list.includes(cat.categoryId)) list.push(cat.categoryId);
      claims.set(id, list);
    }
  }

  const perCourse: CompletedCourseRecognition[] = [];
  const satisfiedByCategory = new Map<string, string[]>();
  const unknownHoursCourseIds: string[] = [];
  let recognizedHours = 0;

  for (const courseId of completedCourseIds) {
    const hasRecord = input.catalogHours.has(courseId);
    if (!hasRecord) {
      // No authoritative record: no credits, no category, no prerequisite claim
      // beyond what the planner's own engine derives from the id itself.
      perCourse.push({ courseId, status: 'unresolved', hours: null });
      continue;
    }

    const raw = input.catalogHours.get(courseId);
    const hours = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    if (hours === null) unknownHoursCourseIds.push(courseId);
    else recognizedHours += hours;

    const claimedBy = (claims.get(courseId) ?? []).slice().sort();
    if (claimedBy.length === 0) {
      // Genuinely completed and credited, but no requiring category claims it.
      perCourse.push({ courseId, status: 'recognized_no_category', hours });
      continue;
    }
    if (claimedBy.length > 1) {
      // Two authoritative pools, no authoritative rule to choose between them.
      // Counting it for both would manufacture a satisfied requirement; picking
      // one arbitrarily would be a decision the program never made.
      perCourse.push({ courseId, status: 'ambiguous_category', hours, candidateCategoryIds: claimedBy });
      continue;
    }

    const categoryId = claimedBy[0];
    perCourse.push({ courseId, status: 'recognized_category', hours, categoryId });
    satisfiedByCategory.set(categoryId, [...(satisfiedByCategory.get(categoryId) ?? []), courseId]);
  }

  const categories: CategoryProgress[] = requiring.map((cat) => {
    const satisfiedBy = (satisfiedByCategory.get(cat.categoryId) ?? []).slice().sort();
    return {
      categoryId: cat.categoryId,
      name: cat.name,
      required: cat.minCourses,
      satisfiedBy,
      // A student cannot "over-satisfy" a category into negative work.
      remainingRequired: Math.max(0, cat.minCourses - satisfiedBy.length),
    };
  });

  const byStatus = (s: RecognitionStatus) =>
    perCourse.filter((c) => c.status === s).map((c) => c.courseId).sort();

  const progress: Omit<AcademicProgress, 'digest'> = {
    completedCourseIds,
    recognizedCourseIds: perCourse.filter((c) => c.status !== 'unresolved').map((c) => c.courseId).sort(),
    unresolvedCourseIds: byStatus('unresolved'),
    ambiguousCourseIds: byStatus('ambiguous_category'),
    recognizedHours,
    unknownHoursCourseIds: unknownHoursCourseIds.slice().sort(),
    categories,
    perCourse,
  };

  // Digest the DECISIONS, not the inputs: two different inputs that were
  // recognized identically describe the same academic reality.
  const digestSource = JSON.stringify({
    recognized: progress.recognizedCourseIds,
    unresolved: progress.unresolvedCourseIds,
    ambiguous: progress.ambiguousCourseIds,
    hours: progress.recognizedHours,
    categories: progress.categories.map((c) => [c.categoryId, c.required, c.remainingRequired, c.satisfiedBy]),
  });

  return { ...progress, digest: `ap_${sha16(digestSource)}` };
}

/** True when nothing about the degree is still outstanding by category. */
export function allCategoriesSatisfiedByCompletion(progress: AcademicProgress): boolean {
  return progress.categories.every((c) => c.remainingRequired === 0);
}
