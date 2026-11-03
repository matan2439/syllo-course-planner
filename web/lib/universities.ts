/**
 * Universities the planner supports. Every program today belongs to Tel Aviv University;
 * a new university adds an entry here plus its own programs (lib/programs.ts) and boards.
 */
export interface UniversityVM {
  id: string
  nameHe: string
  nameEn: string
  /** Path under /public; replace the file with the university's official logo when licensed. */
  logo: string
}

export const UNIVERSITIES: readonly UniversityVM[] = [
  { id: 'tau', nameHe: 'אוניברסיטת תל אביב', nameEn: 'Tel Aviv University', logo: '/universities/tau.svg' },
]

export const DEFAULT_UNIVERSITY_ID = 'tau'

export function getUniversity(id: string | undefined): UniversityVM {
  return UNIVERSITIES.find((university) => university.id === id) ?? UNIVERSITIES.find((u) => u.id === DEFAULT_UNIVERSITY_ID)!
}

/** Case- and niqqud-insensitive match on either name. */
export function searchUniversities(query: string, list: readonly UniversityVM[] = UNIVERSITIES): UniversityVM[] {
  const norm = (text: string) => text.normalize('NFKD').replace(/[֑-ׇ]/g, '').toLowerCase().trim()
  const q = norm(query)
  return q ? list.filter((u) => norm(u.nameHe).includes(q) || norm(u.nameEn).includes(q)) : [...list]
}
