import type { Locale } from './LocaleProvider'

const DAYS: Record<string, string> = { א: 'Sunday', ב: 'Monday', ג: 'Tuesday', ד: 'Wednesday', ה: 'Thursday', ו: 'Friday' }
const TEACHING: Record<string, string> = {
  'ראשית': 'Primary', 'משנית': 'Secondary', 'שיעור': 'Lecture', 'תרגיל': 'Tutorial',
  'שיעור ותרגיל': 'Lecture and tutorial', 'מעבדה': 'Lab', 'סמינר': 'Seminar', 'סדנה': 'Workshop', 'פרויקט': 'Project',
}

export const weekDayLabel = (day: string, locale: Locale) => locale === 'en' ? DAYS[day] ?? day : day
export const teachingLabel = (mode: string, locale: Locale) => locale === 'en' ? TEACHING[mode] ?? mode : mode
