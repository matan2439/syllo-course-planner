/**
 * UI VIEW-MODEL layer (web) — maps the canonical BoardModel (shared/planner)
 * to the existing presentational BoardVM (lib/board.ts), so the read-only
 * native board reuses SemesterColumn/CourseCard without duplicating schemas.
 *
 * Fields NOT carried by the canonical board contract (difficulty, syllabus,
 * per-course warnings, semester totals/averages/warnings) are intentionally
 * deferred (null/[]/false) in Slice 1 per decision D1 — shared/planner is not
 * enlarged speculatively to approximate legacy-card parity.
 *
 * Direct module imports (not the shared barrel): model.ts is pure TS (no zod),
 * so this view-model pulls no runtime schema code into the client bundle.
 */
import { SEMESTER_ORDER, type BoardVM } from '../board'
import { fromHalfHours } from '../../../shared/planner/model'
import type { BoardModel } from '../../../shared/planner/model'

const YEAR_HE: Record<string, string> = {
  '1': 'א׳', '2': 'ב׳', '3': 'ג׳', '4': 'ד׳', '5': 'ה׳', '6': 'ו׳',
}
const SEMESTER_HE: Record<string, string> = { a: 'א׳', b: 'ב׳' }

/**
 * Program-agnostic Hebrew title derived from a canonical semester id
 * (e.g. "year_3_semester_a" → "שנה ג׳ — סמסטר א׳"). Falls back to the raw id
 * for any shape it does not recognize — no hard-coded program specifics.
 */
export function semesterTitleHe(semesterId: string): string {
  const m = /^year_(\d+)_semester_([ab])$/.exec(semesterId)
  if (!m) return semesterId
  return `שנה ${YEAR_HE[m[1]] ?? m[1]} — סמסטר ${SEMESTER_HE[m[2]]}`
}

/** Canonical BoardModel → presentational BoardVM (ordered by SEMESTER_ORDER). */
export function boardModelToVM(model: BoardModel): BoardVM {
  const rank = (id: string) => {
    const i = (SEMESTER_ORDER as readonly string[]).indexOf(id)
    return i === -1 ? SEMESTER_ORDER.length : i
  }
  const semesters = [...model.semesters]
    .sort((a, b) => rank(a.semesterId) - rank(b.semesterId))
    .map((s) => ({
      id: s.semesterId,
      title: semesterTitleHe(s.semesterId),
      // Deferred (D1) — canonical board contract carries none of these yet:
      totalWeeklyHours: null,
      averageDifficulty: null,
      warnings: [],
      courses: s.courses.map((c) => ({
        id: c.courseId,
        name: c.nameHe,
        weeklyHours: c.halfHours == null ? null : fromHalfHours(c.halfHours),
        type: c.courseType,
        difficulty: null, // deferred (D1)
        syllabusUrl: null, // deferred (D1)
        hasWarnings: false, // deferred (D1)
      })),
    }))
  return { semesters }
}
