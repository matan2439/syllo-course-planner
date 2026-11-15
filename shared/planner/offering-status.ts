/**
 * Is a course offered in a given semester — and how sure are we? Four answers, never blurred:
 *
 *  confirmed    the semester belongs to the academic year whose official timetable is published
 *               (the catalog year) and the course has groups in it;
 *  projected    a LATER academic year whose timetable is not published yet: the catalog-year pattern
 *               (the same term letter) is assumed to repeat. An estimate, never a fact;
 *  unavailable  officially confirmed: the catalog year's timetable has no groups for it in that semester;
 *  unknown      not enough to say: no catalog-year offering, a past year, or no data.
 *
 * Availability RULES (what may be placed) are not decided here; this only labels the basis, so the
 * board and the assistant can say honestly which placements rest on an estimate.
 */
import type { SemesterTerm } from './schedule'
import { defaultTermMapping } from './schedule'

export type OfferingStatus = 'confirmed' | 'projected' | 'unavailable' | 'unknown'

/**
 * The academic year (its first calendar year) of the official timetable the course data was taken
 * from: תשפ"ז = 2026. Course records name it in their source URL (`year=2026`, `shana=2026`); this
 * constant is only the fallback for the labels on screen, and a test keeps it in line with the data.
 */
export const PLANNING_CATALOG_YEAR = 2026

export interface OfferingEvidence {
  /** Semester ids the course may be placed in, from the catalog-year pattern. */
  allowedSemesterIds: readonly string[] | null | undefined
  /** False when the official catalog-year timetable lists no groups for the course at all. */
  offeredInCatalogYear: boolean | null | undefined
  /** The academic year the data comes from, when known. */
  catalogYear: number | null | undefined
}

export const catalogYearFromUrl = (url: string | null | undefined): number | null => {
  const match = /[?&](?:year|shana)=(\d{4})/.exec(url ?? '')
  return match ? Number(match[1]) : null
}

export function offeringStatus(semesterId: string, term: SemesterTerm | undefined, evidence: OfferingEvidence): OfferingStatus {
  const catalogYear = evidence.catalogYear ?? null
  if (!term || catalogYear === null) return 'unknown'
  const allowed = evidence.allowedSemesterIds ?? []
  if (term.year < catalogYear) return 'unknown'
  if (term.year === catalogYear) {
    if (evidence.offeredInCatalogYear === false) return 'unavailable'
    if (allowed.length === 0) return 'unknown'
    return allowed.includes(semesterId) ? 'confirmed' : 'unavailable'
  }
  // A later year: only a pattern from a catalog year in which the course actually ran can be projected.
  if (evidence.offeredInCatalogYear === false || allowed.length === 0) return 'unknown'
  return allowed.includes(semesterId) ? 'projected' : 'unknown'
}

/** Hebrew wording, so every surface says the same thing. */
export const OFFERING_STATUS_HE: Record<OfferingStatus, string> = {
  confirmed: 'מאושר במערכת השעות הרשמית',
  projected: 'צפוי — לפי דפוס השנה הנוכחית; מערכת השעות של שנה זו טרם פורסמה',
  unavailable: 'לא נלמד בסמסטר הזה לפי מערכת השעות הרשמית',
  unknown: 'אין מידע מספיק על הצעת הקורס בסמסטר הזה',
}

export const PROJECTED_NOTE_HE = 'זמינות הקורסים בשנה זו צפויה בלבד — מערכת השעות הרשמית טרם פורסמה והיא עשויה להשתנות.'

/**
 * Which board semesters belong to an academic year whose timetable is not published yet.
 * `degreeYear` is the student's current year in the degree (null = unknown: the first column is taken
 * as the current year, as everywhere else).
 */
export function projectedSemesterIds(
  semesterIds: readonly string[], degreeYear: number | null | undefined, today: Date, catalogYear: number = PLANNING_CATALOG_YEAR,
): Set<string> {
  const mapping = defaultTermMapping(semesterIds, today, degreeYear)
  return new Set(semesterIds.filter((id) => mapping[id] && mapping[id].year > catalogYear))
}
