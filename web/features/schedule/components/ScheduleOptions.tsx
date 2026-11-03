'use client'
import { useState } from 'react'
import type { WeeklyScheduleState } from '../../../lib/planner/schedule-storage'
import { busyTimeSchema, manualExamSchema, calendarRangeSchema, busyTimesForSemester, DEFAULT_EXAM_GAP_DAYS } from '../../../../shared/planner/student-schedule-tools'
import ExamOverview from './ExamOverview'
import { buildScheduleCalendar, type CalendarMeeting } from '../../../lib/planner/schedule-calendar'
import { useLocale } from '../../locale/LocaleProvider'
import { weekDayLabel } from '../../locale/schedule-labels'
import { uuidv4 } from '../../../lib/ai-session-token'

const field = 'w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm'
const button = 'rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs hover:border-[var(--purple)] disabled:opacity-40'
export default function ScheduleOptions({ programId, semesterId, state, onChange, meetings, courses }: {
  programId: string; semesterId: string; state: WeeklyScheduleState; onChange: (state: WeeklyScheduleState) => void
  meetings: readonly CalendarMeeting[]; courses: readonly { courseId: string; name: string }[]
}) {
  const { t, locale } = useLocale()
  const [busy, setBusy] = useState({ day: 'א', start: '09:00', end: '10:00', label: '' })
  const [exam, setExam] = useState({ courseId: '', date: '', start: '09:00', end: '12:00', kind: 'a' })
  const [range, setRange] = useState(state.calendarRange ?? { startDate: '', endDate: '' })
  const [error, setError] = useState('')
  const [exported, setExported] = useState(0)
  const scopedBusy = busyTimesForSemester(state.busyTimes ?? [], semesterId)
  const exams = (state.exams ?? []).filter(item => item.semesterId === semesterId)
  const courseName = (id: string) => courses.find(c => c.courseId === id)?.name ?? id
  const invalid = () => setError(t('בדקו תאריך תקין ושעת סיום מאוחרת משעת ההתחלה.', 'Check the date and make sure the end time follows the start time.'))
  const setDates = (next: typeof range) => {
    setRange(next); setError(''); setExported(0)
    const parsed = calendarRangeSchema.safeParse(next)
    if (parsed.success) onChange({ ...state, calendarRange: parsed.data })
  }
  return <details className="my-3 rounded-lg border border-[var(--border)] text-xs">
    <summary className="cursor-pointer px-3 py-2 font-medium">{t('אפשרויות מערכת וייצוא ליומן', 'Timetable options and calendar export')}</summary>
    <div className="space-y-5 border-t border-[var(--border)] p-3">
      <section className="space-y-2">
        <h3 className="font-semibold">{t('שעות שאינני פנוי בהן', 'Times I am unavailable')}</h3>
        <p className="text-[var(--text-muted)]">{t('לסמסטר הנבחר. קבוצות קיימות אינן נמחקות; בחירה חדשה וחיפוש קבוצות מתחשבים באילוצים.', 'For the selected semester. Existing groups stay selected; new choices and group search respect these times.')}</p>
        {scopedBusy.map(item => <div key={item.id} className="flex items-center justify-between gap-2"><span>{item.label} · {weekDayLabel(item.day, locale)} <bdi>{item.start}–{item.end}</bdi></span><button type="button" className={button} aria-label={t(`הסרת אילוץ ${item.label}`, `Remove unavailable time ${item.label}`)} onClick={() => onChange({ ...state, busyTimes: state.busyTimes?.filter(value => value.id !== item.id) })}>{t('הסרה', 'Remove')}</button></div>)}
        <form className="grid grid-cols-2 gap-2 sm:grid-cols-4" onSubmit={event => {
          event.preventDefault(); const parsed = busyTimeSchema.safeParse({ ...busy, id: `busy_${uuidv4()}`, semesterId })
          if (!parsed.success) { invalid(); return }
          if ((state.busyTimes?.length ?? 0) >= 50) return
          onChange({ ...state, busyTimes: [...(state.busyTimes ?? []), parsed.data] }); setBusy({ ...busy, label: '' }); setError('')
        }}>
          <label>{t('תיאור', 'Label')}<input className={field} maxLength={80} value={busy.label} onChange={e => setBusy({ ...busy, label: e.target.value })} /></label>
          <label>{t('יום', 'Day')}<select className={field} value={busy.day} onChange={e => setBusy({ ...busy, day: e.target.value })}>{['א', 'ב', 'ג', 'ד', 'ה', 'ו'].map(day => <option key={day} value={day}>{weekDayLabel(day, locale)}</option>)}</select></label>
          <label>{t('תחילת זמן חסום', 'Unavailable from')}<input className={field} type="time" value={busy.start} onChange={e => setBusy({ ...busy, start: e.target.value })} /></label>
          <label>{t('סיום זמן חסום', 'Unavailable until')}<input className={field} type="time" value={busy.end} onChange={e => setBusy({ ...busy, end: e.target.value })} /></label>
          <button className={`${button} w-fit`} disabled={!busy.label.trim() || (state.busyTimes?.length ?? 0) >= 50}>{t('הוספת אילוץ', 'Add unavailable time')}</button>
        </form>
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">{t('מבחנים — הזנה ידנית', 'Exams — manual dates')}</h3>
        <p className="text-[var(--text-muted)]">{t('יש לבדוק מול המקור הרשמי.', 'Verify dates with the official source.')}</p>
        {exams.map(item => <div key={item.id} className="flex items-center justify-between gap-2"><span>{courseName(item.courseId)} · {item.kind === 'a' ? t('מועד א׳', 'Sitting A') : item.kind === 'b' ? t('מועד ב׳', 'Sitting B') : t('אחר', 'Other')} · <bdi>{item.date} {item.start}–{item.end}</bdi></span><button type="button" className={button} aria-label={t(`מחיקת מועד ${courseName(item.courseId)} ${item.date}`, `Remove exam ${courseName(item.courseId)} ${item.date}`)} onClick={() => onChange({ ...state, exams: state.exams?.filter(value => value.id !== item.id) })}>{t('הסרה', 'Remove')}</button></div>)}
        <ExamOverview exams={exams} semesterId={semesterId} courseName={courseName} showList={false}
          minGapDays={state.examGapDays ?? DEFAULT_EXAM_GAP_DAYS} onGapChange={(examGapDays) => onChange({ ...state, examGapDays })} />
        <form className="grid grid-cols-2 gap-2 sm:grid-cols-3" onSubmit={event => {
          event.preventDefault(); const parsed = manualExamSchema.safeParse({ ...exam, id: `exam_${uuidv4()}`, semesterId })
          if (!parsed.success || !courses.some(c => c.courseId === exam.courseId)) { invalid(); return }
          if ((state.exams?.length ?? 0) >= 100) return
          onChange({ ...state, exams: [...(state.exams ?? []), parsed.data] }); setError('')
        }}>
          <label>{t('קורס למבחן', 'Exam course')}<select className={field} value={exam.courseId} onChange={e => setExam({ ...exam, courseId: e.target.value })}><option value="">{t('בחירת קורס', 'Choose course')}</option>{courses.map(c => <option key={c.courseId} value={c.courseId}>{c.name}</option>)}</select></label>
          <label>{t('תאריך המבחן', 'Exam date')}<input className={field} type="date" value={exam.date} onInput={e => setExam({ ...exam, date: e.currentTarget.value })} /></label>
          <label>{t('מועד', 'Sitting')}<select className={field} value={exam.kind} onChange={e => setExam({ ...exam, kind: e.target.value })}><option value="a">{t('מועד א׳', 'Sitting A')}</option><option value="b">{t('מועד ב׳', 'Sitting B')}</option><option value="other">{t('אחר', 'Other')}</option></select></label>
          <label>{t('תחילת המבחן', 'Exam starts')}<input className={field} type="time" value={exam.start} onChange={e => setExam({ ...exam, start: e.target.value })} /></label>
          <label>{t('סיום המבחן', 'Exam ends')}<input className={field} type="time" value={exam.end} onChange={e => setExam({ ...exam, end: e.target.value })} /></label>
          <button className={`${button} self-end`} disabled={!exam.courseId || !exam.date || (state.exams?.length ?? 0) >= 100}>{t('הוספת מבחן', 'Add exam')}</button>
        </form>
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">{t('ייצוא ליומן', 'Export to calendar')}</h3>
        <p className="text-[var(--text-muted)]">{t('בחרו את תקופת השיעורים (עד שנה). ייוצאו הקבוצות הנבחרות עם שעות ידועות, ובנוסף מבחני הסמסטר בתאריכים שהזנתם. חופשות אינן מוחרגות אוטומטית. אזור זמן: ירושלים.', 'Choose the teaching period (up to one year). Exports selected groups with known times, plus this semester’s entered exams. Holidays are not excluded automatically. Time zone: Jerusalem.')}</p>
        <div className="grid grid-cols-2 gap-2"><label>{t('תחילת תקופת השיעורים', 'Classes from')}<input className={field} type="date" value={range.startDate} onInput={e => setDates({ ...range, startDate: e.currentTarget.value })} /></label><label>{t('סיום תקופת השיעורים', 'Classes until')}<input className={field} type="date" value={range.endDate} onInput={e => setDates({ ...range, endDate: e.currentTarget.value })} /></label></div>
        <button type="button" className={button} onClick={() => {
          try {
            const result = buildScheduleCalendar({ programId, semesterId, range, meetings, exams })
            const url = URL.createObjectURL(new Blob([result.content], { type: 'text/calendar;charset=utf-8' }))
            const link = document.createElement('a'); link.href = url; link.download = `syllo-${semesterId}.ics`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
            setExported(result.eventCount); setError('')
          } catch { setError(t('לא ניתן לייצא: בדקו את טווח התאריכים ושיש שיעורים עם שעות ידועות או מבחנים שהזנתם.', 'Cannot export: check the date range and that selected meetings or entered exams have times.')); setExported(0) }
        }}>{t('הורדת קובץ יומן', 'Download calendar file')}</button>
        {exported > 0 && <p role="status">{t(`נוצרו ${exported} אירועים. אפשר לייבא את הקובץ ליומן שלכם.`, `${exported} events created. Import the file into your calendar.`)}</p>}
      </section>
      {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
    </div>
  </details>
}
