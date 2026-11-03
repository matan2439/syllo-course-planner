'use client'
import { useState } from 'react'
import { examWarnings, DEFAULT_EXAM_GAP_DAYS, type ManualExam } from '../../../../shared/planner/student-schedule-tools'
import { useLocale } from '../../locale/LocaleProvider'

const WEEK_HE = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']
const WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * The student's entered exam dates with collision / short-gap warnings, and an optional
 * month view of the exam period. Shared by the timetable and the bidding planner.
 * `semesterId` null = every semester (the bidding tab compares across the whole plan).
 */
export default function ExamOverview({ exams, semesterId, courseName, minGapDays = DEFAULT_EXAM_GAP_DAYS, onGapChange, semesterLabel, showList = true }: {
  exams: readonly ManualExam[]
  semesterId: string | null
  courseName: (courseId: string) => string
  minGapDays?: number
  onGapChange?: (days: number) => void
  semesterLabel?: (semesterId: string) => string
  /** Off when the caller already lists the exams (with its own edit controls). */
  showList?: boolean
}) {
  const { t, locale } = useLocale()
  const scoped = [...(semesterId === null ? exams : exams.filter((exam) => exam.semesterId === semesterId))]
    .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`))
  const warnings = examWarnings(scoped, null, minGapDays)
  const flagged = new Set(warnings.flatMap((w) => [w.firstId, w.secondId]))
  const [month, setMonth] = useState<string | null>(null)
  const months = [...new Set(scoped.map((exam) => exam.date.slice(0, 7)))]
  const shown = month && months.includes(month) ? month : null
  const byId = (id: string) => scoped.find((exam) => exam.id === id)!
  const sitting = (exam: ManualExam) => exam.kind === 'a' ? t('מועד א׳', 'Sitting A') : exam.kind === 'b' ? t('מועד ב׳', 'Sitting B') : t('אחר', 'Other')

  return <div className="space-y-2 text-xs">
    {onGapChange && <label className="flex items-center gap-2">
      {t('התרעה כשהמרווח בין מבחנים קטן מ־', 'Warn when exams are fewer than')}
      <input type="number" min={1} max={14} value={minGapDays} aria-label={t('מרווח מינימלי בימים', 'Minimum gap in days')}
        onChange={(e) => { const n = Math.floor(Number(e.target.value)); if (n >= 1 && n <= 14) onGapChange(n) }}
        className="w-14 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1" />
      {t('ימים', 'days apart')}
    </label>}
    {showList && scoped.length === 0 && <p className="text-[var(--text-muted)]">{t('לא הוזנו מבחנים.', 'No exams entered.')}</p>}
    {showList && scoped.length > 0 && <ul className="space-y-1">{scoped.map((exam) => <li key={exam.id} data-flagged={flagged.has(exam.id) || undefined}
      className={`flex flex-wrap gap-x-2 ${flagged.has(exam.id) ? 'font-semibold text-amber-700 dark:text-amber-300' : ''}`}>
      <bdi>{exam.date}</bdi><span>{courseName(exam.courseId)}</span><span className="text-[var(--text-muted)]">{sitting(exam)}{semesterId === null && semesterLabel ? ` · ${semesterLabel(exam.semesterId)}` : ''}</span>
    </li>)}</ul>}
    {warnings.map((w) => <p key={`${w.firstId}:${w.secondId}`} role="status" className="text-amber-700 dark:text-amber-300">
      ⚠ {courseName(byId(w.firstId).courseId)} / {courseName(byId(w.secondId).courseId)}: {w.kind === 'same_day' ? t('באותו יום', 'Same day') : t(`מרווח של ${w.days} ימים`, `${w.days} days apart`)}
    </p>)}
    {months.length > 0 && <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('לוח חודשי של המבחנים', 'Monthly exam calendar')}>
      {months.map((m) => <button key={m} type="button" aria-pressed={shown === m} onClick={() => setMonth(shown === m ? null : m)}
        className="rounded-md border border-[var(--border)] px-2 py-1 hover:border-[var(--purple)] aria-pressed:border-[var(--purple)]">
        {new Date(`${m}-01T00:00:00Z`).toLocaleDateString(locale === 'he' ? 'he-IL' : 'en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
      </button>)}
    </div>}
    {shown && <MonthGrid month={shown} exams={scoped} flagged={flagged} courseName={courseName} weekdays={locale === 'he' ? WEEK_HE : WEEK_EN} />}
  </div>
}

function MonthGrid({ month, exams, flagged, courseName, weekdays }: {
  month: string; exams: readonly ManualExam[]; flagged: Set<string>; courseName: (id: string) => string; weekdays: string[]
}) {
  const first = new Date(`${month}-01T00:00:00Z`)
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const cells = [...Array(first.getUTCDay()).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  return <div role="grid" aria-label={month} className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-[var(--border)] bg-[var(--border)]">
    {weekdays.map((d) => <div key={d} role="columnheader" className="bg-[var(--surface-panel)] p-1 text-center font-semibold text-[var(--text-muted)]">{d}</div>)}
    {cells.map((day, i) => {
      const date = day ? `${month}-${String(day).padStart(2, '0')}` : ''
      const today = exams.filter((exam) => exam.date === date)
      return <div key={i} role="gridcell" className="min-h-12 bg-[var(--surface-panel)] p-1">
        {day && <span className="text-[var(--text-muted)]">{day}</span>}
        {today.map((exam) => <div key={exam.id} className={`mt-0.5 truncate rounded px-1 ${flagged.has(exam.id) ? 'bg-amber-500/20 font-semibold' : 'bg-[var(--purple)]/15'}`} title={courseName(exam.courseId)}>{courseName(exam.courseId)}</div>)}
      </div>
    })}
  </div>
}
