/**
 * Course Catalog reader — extracts the deterministic course universe out of a
 * raw board_json into the minimal shape needed for deterministic topic
 * inference (courseId, nameHe, categoryId).
 *
 * The universe definition MIRRORS buildCourseProfiles (course_profile.ts):
 * placed semester courses UNION metadata.program_repository_courses (the board
 * carries no general candidates for this program). We keep only the fields the
 * deterministic keyword inference needs — no syllabus text, no grades, no
 * prerequisites — so this reader stays small and its output stable.
 *
 * This is the SUPPLY-SIDE catalog source for the academic-interest evaluation
 * stack. It reads the same committed local board loadLocalBoardJson serves; it
 * does not touch the DB, generate-plan, PlannerWorker, or any UI.
 */

import { loadLocalBoardJson } from './board_loader';

export const MECHANICAL_ENGINEERING_2027_PROGRAM_ID = 'mechanical_engineering_2027';

export interface CatalogCourse {
  courseId: string;
  /** Hebrew course name; null when the board has none (never fabricated). */
  nameHe: string | null;
  /** Program category id (e.g. 'fluids'); null when unknown (e.g. placed-only courses). */
  categoryId: string | null;
}

function normalizeName(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function normalizeCategory(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Extract the catalog course universe from a raw board_json. Deterministic:
 * deduped by courseId, sorted by courseId ascending. For a course appearing in
 * both a semester and the repository, the repository's category/name take
 * precedence (repository records are the richer, canonical source), falling
 * back to the placed record's fields. Pure — never mutates the input board.
 */
export function extractCatalogCourses(board: any): CatalogCourse[] {
  const byId = new Map<string, CatalogCourse>();

  const add = (raw: any, preferAsCanonical: boolean) => {
    if (!raw || typeof raw.course_id !== 'string') return;
    const courseId = raw.course_id;
    const incoming: CatalogCourse = {
      courseId,
      nameHe: normalizeName(raw.name_he),
      categoryId: normalizeCategory(raw.category_id),
    };
    const existing = byId.get(courseId);
    if (!existing) {
      byId.set(courseId, incoming);
      return;
    }
    // Merge: canonical (repository) fields win; otherwise fill gaps from either source.
    byId.set(courseId, {
      courseId,
      nameHe: preferAsCanonical ? incoming.nameHe ?? existing.nameHe : existing.nameHe ?? incoming.nameHe,
      categoryId: preferAsCanonical
        ? incoming.categoryId ?? existing.categoryId
        : existing.categoryId ?? incoming.categoryId,
    });
  };

  // Placed first (non-canonical), then repository (canonical) so repository wins on merge.
  for (const sem of board?.semesters ?? []) {
    for (const c of sem?.courses ?? []) add(c, false);
  }
  for (const c of board?.metadata?.program_repository_courses ?? []) add(c, true);

  return [...byId.values()].sort((a, b) => a.courseId.localeCompare(b.courseId));
}

/** Load the full TAU Mechanical Engineering 2027 catalog universe from the committed local board. */
export function loadMechanicalEngineering2027Catalog(): CatalogCourse[] {
  const board = loadLocalBoardJson(MECHANICAL_ENGINEERING_2027_PROGRAM_ID);
  return extractCatalogCourses(board);
}
