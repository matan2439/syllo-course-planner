/**
 * Structured prerequisites (AND/OR) from the official syllabus pages, and the one
 * evaluator every consumer uses. Data: data/prerequisites/tau.json, built by
 * scripts/ingest_prerequisites.py.
 *
 * SHADOW MODE ONLY for now: nothing in the planner or the validators blocks on this
 * yet. `shadowPrerequisiteAudit` reports what strict enforcement WOULD block, so
 * coverage and correctness can be reviewed per program before it is switched on.
 *
 * A missing record is `unknown` — never "no prerequisites".
 */
import { readFileSync } from 'fs';
import { join } from 'path';

export type PrerequisiteExpression =
  | { course: string }
  | { all: PrerequisiteExpression[] }
  | { any: PrerequisiteExpression[] };

export type PrerequisiteStatus =
  /** The official page lists prerequisites. */
  | 'verified'
  /** The official page exists and lists none. */
  | 'verified_none'
  /** No official syllabus page for the course: assumed none (product rule), revisit when one appears. */
  | 'assumed_none_no_syllabus'
  /** No usable record. */
  | 'unknown';

export interface PrerequisiteRecord {
  status: PrerequisiteStatus;
  expression: PrerequisiteExpression | null;
  corequisites: PrerequisiteExpression | null;
  source_url?: string;
  fetched_at?: string;
  content_hash?: string;
  needs_review?: boolean;
}

export type PrerequisiteCatalog = Readonly<Record<string, PrerequisiteRecord>>;

const UNKNOWN: PrerequisiteRecord = { status: 'unknown', expression: null, corequisites: null };
const DATA_FILE = join(__dirname, '..', '..', 'data', 'prerequisites', 'tau.json');
let cached: PrerequisiteCatalog | null | undefined;

/** The committed catalog, or null when the file is absent (then every course is `unknown`). */
export function loadPrerequisiteCatalog(): PrerequisiteCatalog | null {
  if (cached === undefined) {
    try { cached = JSON.parse(readFileSync(DATA_FILE, 'utf8')).courses as PrerequisiteCatalog; } catch { cached = null; }
  }
  return cached;
}

export const prerequisiteRecord = (catalog: PrerequisiteCatalog | null, courseId: string): PrerequisiteRecord =>
  catalog?.[courseId] ?? UNKNOWN;

/** Every course id an expression mentions. */
export function referencedCourseIds(expression: PrerequisiteExpression | null): string[] {
  if (!expression) return [];
  if ('course' in expression) return [expression.course];
  return ('all' in expression ? expression.all : expression.any).flatMap(referencedCourseIds);
}

/** True when the expression holds; `null` (no requirement) always holds. */
export function evaluatePrerequisites(expression: PrerequisiteExpression | null, satisfied: (courseId: string) => boolean): boolean {
  if (!expression) return true;
  if ('course' in expression) return satisfied(expression.course);
  if ('all' in expression) return expression.all.every((child) => evaluatePrerequisites(child, satisfied));
  return expression.any.some((child) => evaluatePrerequisites(child, satisfied));
}

/**
 * The smallest unmet parts, for an explanation: each entry is one requirement the student
 * still has to meet, as the alternatives that would meet it ("X or Y").
 */
export function unmetRequirements(expression: PrerequisiteExpression | null, satisfied: (courseId: string) => boolean): string[][] {
  if (!expression || evaluatePrerequisites(expression, satisfied)) return [];
  if ('course' in expression) return [[expression.course]];
  if ('all' in expression) return expression.all.flatMap((child) => unmetRequirements(child, satisfied));
  // An unmet OR: any one alternative would do; list the single-course ones, else every course in it.
  return [[...new Set(referencedCourseIds(expression))]];
}

export interface PlacementCheck {
  courseId: string;
  semesterId: string;
  status: PrerequisiteStatus;
  /** Requirements not met by completed courses or earlier semesters (alternatives per requirement). */
  unmetPrerequisites: string[][];
  /** Corequisites not completed and not in this or an earlier semester. */
  unmetCorequisites: string[][];
}

export interface ShadowAudit {
  /** Placements strict enforcement would reject. */
  wouldBlock: PlacementCheck[];
  /** Placed courses whose prerequisites are unknown (strict mode would not auto-place them). */
  unknown: string[];
  /** Placed courses relying on the no-syllabus assumption. */
  assumedNone: string[];
}

/**
 * What strict prerequisite enforcement would say about a plan. A prerequisite is met by a
 * completed course or one placed in a STRICTLY earlier semester; a corequisite also by the
 * same semester. `completedCourseIds` is what the student reported, catalog member or not.
 */
export function shadowPrerequisiteAudit(input: {
  semesters: ReadonlyArray<{ semesterId: string; courseIds: readonly string[] }>;
  completedCourseIds: Iterable<string>;
  catalog?: PrerequisiteCatalog | null;
}): ShadowAudit {
  const catalog = input.catalog === undefined ? loadPrerequisiteCatalog() : input.catalog;
  const completed = new Set(input.completedCourseIds);
  const firstIndex = new Map<string, number>();
  input.semesters.forEach((semester, index) => {
    for (const id of semester.courseIds) if (!firstIndex.has(id)) firstIndex.set(id, index);
  });
  const audit: ShadowAudit = { wouldBlock: [], unknown: [], assumedNone: [] };
  input.semesters.forEach((semester, index) => {
    for (const courseId of semester.courseIds) {
      if (firstIndex.get(courseId) !== index) continue; // an annual course is checked at its first semester
      const record = prerequisiteRecord(catalog, courseId);
      if (record.status === 'unknown') { audit.unknown.push(courseId); continue; }
      if (record.status === 'assumed_none_no_syllabus') { audit.assumedNone.push(courseId); continue; }
      const before = (id: string) => completed.has(id) || (firstIndex.get(id) ?? Infinity) < index;
      const byNow = (id: string) => completed.has(id) || (firstIndex.get(id) ?? Infinity) <= index;
      const unmetPrerequisites = unmetRequirements(record.expression, before);
      const unmetCorequisites = unmetRequirements(record.corequisites, byNow);
      if (unmetPrerequisites.length || unmetCorequisites.length) {
        audit.wouldBlock.push({ courseId, semesterId: semester.semesterId, status: record.status, unmetPrerequisites, unmetCorequisites });
      }
    }
  });
  return audit;
}
