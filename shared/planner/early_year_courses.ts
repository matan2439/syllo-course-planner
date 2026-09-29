/**
 * early_year_courses.ts — a program's official Years 1–2 mandatory courses, as DATA.
 *
 * The board the planner schedules for Years 3–4 carries no Years 1–2 courses, so this
 * list comes from data/config/early_year_courses.json, which
 * scripts/build_early_years_board.py generates from TAU's official program page
 * (the same run that publishes the Years 1–2 window board). No course id, name or
 * credit value lives in code: re-run the script after a yearly data refresh.
 *
 * These are AUTHORITATIVE catalog facts. A student may report whether they completed
 * one — never edit its credits, prerequisites, or category.
 */

import earlyYearIndex from '../../data/config/early_year_courses.json'
import { programIdOfBoard } from './window_board'

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

const EARLY_YEARS_BY_PROGRAM: Record<string, EarlyYearCourse[]> = earlyYearIndex

/** `mechanical_engineering_biomedical_track_2025` → `mechanical_engineering_biomedical_track`. */
const baseOf = (programId: string) => programId.replace(/_\d{4}$/, '')

/**
 * Program id (or one of its window boards) → its official early-year courses. A program
 * without its own generated entry uses the newest entry of its program family (same base
 * id prefix, e.g. an archived catalog year or a track of the same degree); none → empty
 * list, and the UI offers only the explicit "none completed" answer.
 * ponytail: family = id prefix; add an explicit alias in the generator if a family ever splits.
 */
export function earlyYearCoursesFor(programId: string): EarlyYearCourse[] {
  const program = programIdOfBoard(programId)
  const own = EARLY_YEARS_BY_PROGRAM[program]
  if (own) return own
  const family = Object.keys(EARLY_YEARS_BY_PROGRAM)
    .filter((id) => baseOf(program).startsWith(baseOf(id)))
    .sort()
    .pop()
  return family ? EARLY_YEARS_BY_PROGRAM[family] : []
}

/** Authoritative credit hours by course id for a program's early years. */
export function earlyYearHoursById(programId: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of earlyYearCoursesFor(programId)) out[c.courseId] = c.creditHours
  return out
}
