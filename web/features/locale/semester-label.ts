import type { Locale } from './LocaleProvider'

/** Translate structural semester labels; preserve unknown catalog labels verbatim. */
export function semesterLabel(semesterId: string, original: string, locale: Locale): string {
  if (locale === 'he') return original
  const match = /^year_(\d+)_semester_([ab])$/.exec(semesterId)
  return match ? `Year ${match[1]} — Semester ${match[2].toUpperCase()}` : original
}
