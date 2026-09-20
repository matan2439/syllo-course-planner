/**
 * View model for the Next-native read-only course-details panel.
 *
 * `buildCourseDetails` normalizes a loose raw course into a stable shape,
 * tolerating both the Next repository VM (camelCase) and a legacy `courseMap`
 * entry (snake_case). Feeding from the repository VM is the live path today;
 * the snake_case branch is the seam for the future same-origin selection bridge
 * off the legacy iframe — so the panel needs no rewrite when that lands.
 *
 * Pure presentation mapping: no selection, eligibility, scoring or board logic.
 */

export type CoursePrereq = { id: string; name: string | null }

export type CourseDetailsVM = {
  id: string
  name: string
  weeklyHours: number | null
  credits: number | null
  category: string | null
  offered: string[]
  prerequisites: CoursePrereq[]
  syllabusUrl: string | null
}

type RawPrereq = {
  course_id?: string | null
  id?: string | null
  name_he?: string | null
  name?: string | null
}

export type RawCourseDetails = {
  course_id?: string | null
  id?: string | null
  name_he?: string | null
  name?: string | null
  weekly_hours?: number | null
  weeklyHours?: number | null
  credits?: number | null
  program_category_name_he?: string | null
  category?: string | null
  offered_semesters?: string[] | null
  offered?: string[] | null
  prerequisite_details?: RawPrereq[] | null
  prerequisites?: Array<string | RawPrereq> | null
  syllabus_url?: string | null
  syllabusUrl?: string | null
}

function normalizePrereqs(raw: RawCourseDetails): CoursePrereq[] {
  // Prefer the id+name pairs; fall back to a plain id array (name unknown).
  const source: Array<string | RawPrereq> =
    raw.prerequisite_details ?? raw.prerequisites ?? []
  return source
    .map((p) =>
      typeof p === 'string'
        ? { id: p, name: null }
        : { id: p.course_id ?? p.id ?? '', name: p.name_he ?? p.name ?? null }
    )
    .filter((p) => p.id) // drop falsy ids — never a nameless, idless chip
}

export function buildCourseDetails(raw: RawCourseDetails): CourseDetailsVM {
  const id = raw.course_id ?? raw.id ?? ''
  return {
    id,
    // Real data ships name_he: null rows — never let a null/empty name render.
    name: raw.name_he ?? raw.name ?? `קורס ${id}`,
    weeklyHours: raw.weekly_hours ?? raw.weeklyHours ?? null,
    credits: raw.credits ?? null,
    category: raw.program_category_name_he ?? raw.category ?? null,
    offered: raw.offered_semesters ?? raw.offered ?? [],
    prerequisites: normalizePrereqs(raw),
    syllabusUrl: raw.syllabus_url ?? raw.syllabusUrl ?? null,
  }
}
