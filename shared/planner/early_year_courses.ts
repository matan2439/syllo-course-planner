/**
 * early_year_courses.ts — the program's standard early-year (Years 1–2) course
 * structure, as typed DATA keyed by program id.
 *
 * WHY A STATIC TABLE. The board catalog only carries the years the planner
 * schedules (Year 3+): the Years 1–2 mandatory courses are deliberately absent
 * from `program_repository_courses`, so there is no catalog field to derive them
 * from. The legacy planner solved this with an inline `YEAR_1_2_MANDATORY_COURSES`
 * constant (app/web/semester_board_viewer.html); this module preserves that
 * authoritative data while removing it from UI logic — components look courses up
 * generically by program id and never contain course ids of their own, so another
 * degree or institution is added here as data, not by touching a component.
 *
 * These are the program's own published mandatory courses and their credit hours;
 * they are AUTHORITATIVE catalog facts. A student may report whether they
 * completed one — never edit its credits, prerequisites, or category.
 */

export interface EarlyYearCourse {
  courseId: string
  nameHe: string
  /** The program's own early-year semester bucket (grouping/display only). */
  semesterId: string
  /** Authoritative credit hours — the only source for completed-credit accounting. */
  creditHours: number
}

export interface EarlyYearSemester {
  id: string
  titleHe: string
}

export const EARLY_YEAR_SEMESTERS: EarlyYearSemester[] = [
  { id: 'year_1_semester_a', titleHe: 'שנה א׳ — סמסטר א׳' },
  { id: 'year_1_semester_b', titleHe: 'שנה א׳ — סמסטר ב׳' },
  { id: 'year_2_semester_a', titleHe: 'שנה ב׳ — סמסטר א׳' },
  { id: 'year_2_semester_b', titleHe: 'שנה ב׳ — סמסטר ב׳' },
]

/** TAU Mechanical Engineering — mirrors the legacy YEAR_1_2_MANDATORY_COURSES table. */
const MECHANICAL_ENGINEERING_EARLY_YEARS: EarlyYearCourse[] = [
  { courseId: '0509-1510', nameHe: 'גרפיקה הנדסית', semesterId: 'year_1_semester_a', creditHours: 4.0 },
  { courseId: '0509-1624', nameHe: 'אלגברה ליניארית להנדסה מכנית', semesterId: 'year_1_semester_a', creditHours: 6.5 },
  { courseId: '0509-1646', nameHe: 'חשבון דיפרנציאלי ואינטגרלי 1ב׳ להנדסה מכנית ומדע והנדסה של חומרים', semesterId: 'year_1_semester_a', creditHours: 5.5 },
  { courseId: '0509-1815', nameHe: 'כימיה בסיסית להנדסה', semesterId: 'year_1_semester_a', creditHours: 3.0 },
  { courseId: '0509-1820', nameHe: 'תכנות - (פייתון)', semesterId: 'year_1_semester_a', creditHours: 3.5 },
  { courseId: '0542-1800', nameHe: 'מבוא להנדסה מכנית', semesterId: 'year_1_semester_a', creditHours: 0.0 },
  { courseId: '0509-1645', nameHe: 'משוואות דיפרנציאליות רגילות להנדסה מכנית', semesterId: 'year_1_semester_b', creditHours: 4.0 },
  { courseId: '0509-1647', nameHe: 'חשבון דיפרנציאלי ואינטגרלי 2ב׳ למכנית', semesterId: 'year_1_semester_b', creditHours: 5.5 },
  { courseId: '0509-1834', nameHe: 'מעבדה בפיזיקה', semesterId: 'year_1_semester_b', creditHours: 2.0 },
  { courseId: '0542-1810', nameHe: 'מכניקה של חלקיקים', semesterId: 'year_1_semester_b', creditHours: 4.5 },
  { courseId: '0542-1820', nameHe: 'סטטיקה של גוף קשיח', semesterId: 'year_1_semester_b', creditHours: 4.0 },
  { courseId: '0581-1111', nameHe: 'מבוא למדע והנדסה של חומרים', semesterId: 'year_1_semester_b', creditHours: 4.0 },
  { courseId: '0581-1132', nameHe: 'מבוא למדע והנדסה של חומרים - מעבדה', semesterId: 'year_1_semester_b', creditHours: 0.5 },
  { courseId: '0509-1829', nameHe: 'פיזיקה (2)', semesterId: 'year_2_semester_a', creditHours: 5.5 },
  { courseId: '0509-2805', nameHe: 'מבוא להסתברות וסטטיסטיקה להנדסה מכנית וחומרים', semesterId: 'year_2_semester_a', creditHours: 4.0 },
  { courseId: '0509-2844', nameHe: 'פונקציות מרוכבות', semesterId: 'year_2_semester_a', creditHours: 3.0 },
  { courseId: '0542-2110', nameHe: 'דינמיקה של גוף קשיח', semesterId: 'year_2_semester_a', creditHours: 4.0 },
  { courseId: '0542-2200', nameHe: 'מכניקת המוצקים (1)', semesterId: 'year_2_semester_a', creditHours: 5.0 },
  { courseId: '0542-2600', nameHe: 'תרמודינמיקה (1)', semesterId: 'year_2_semester_a', creditHours: 5.0 },
  { courseId: '0509-2804', nameHe: 'אנליזה נומרית', semesterId: 'year_2_semester_b', creditHours: 4.0 },
  { courseId: '0509-2843', nameHe: 'אנליזה הרמונית', semesterId: 'year_2_semester_b', creditHours: 3.0 },
  { courseId: '0509-2846', nameHe: 'משוואות דיפרנציאליות חלקיות', semesterId: 'year_2_semester_b', creditHours: 3.0 },
  { courseId: '0512-1205', nameHe: 'מבוא למעגלים מערכות ואותות חשמליים', semesterId: 'year_2_semester_b', creditHours: 4.0 },
  { courseId: '0542-2500', nameHe: 'מכניקת הזורמים (1)', semesterId: 'year_2_semester_b', creditHours: 5.0 },
]

/**
 * Program id → its early-year structure. A program with no entry returns an
 * empty list: the UI then offers only the catalog-backed elective path and the
 * explicit "none completed" answer, rather than showing another degree's courses.
 */
const EARLY_YEARS_BY_PROGRAM: Record<string, EarlyYearCourse[]> = {
  mechanical_engineering_2027: MECHANICAL_ENGINEERING_EARLY_YEARS,
  mechanical_engineering_2025: MECHANICAL_ENGINEERING_EARLY_YEARS,
  mechanical_engineering_biomedical_track_2025: MECHANICAL_ENGINEERING_EARLY_YEARS,
}

export function earlyYearCoursesFor(programId: string): EarlyYearCourse[] {
  return EARLY_YEARS_BY_PROGRAM[programId] ?? []
}

/** Authoritative credit hours by course id for a program's early years. */
export function earlyYearHoursById(programId: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of earlyYearCoursesFor(programId)) out[c.courseId] = c.creditHours
  return out
}
