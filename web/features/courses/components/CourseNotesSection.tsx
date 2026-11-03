'use client'
import { createContext, useContext, useState } from 'react'
import { COURSE_NOTE_KINDS, notesForCourse, type CourseNote } from '../../../../shared/planner/course-notes'
import { useLocale } from '../../locale/LocaleProvider'

export interface CourseNotesLibrary {
  notes: readonly CourseNote[]
  ready: boolean
  save: (note: Omit<CourseNote, 'id' | 'createdAt' | 'updatedAt' | 'visibility'> & { id?: string }) => void
  remove: (id: string) => void
}
/** Provided by the planner workspace (backed by the student workspace document); absent elsewhere. */
export const CourseNotesContext = createContext<CourseNotesLibrary | null>(null)

const KIND_LABELS: Record<CourseNote['kind'], [string, string]> = {
  experience: ['חוויה אישית', 'Personal experience'],
  tip: ['טיפ', 'Tip'],
  update: ['עדכון', 'Update'],
}
const FIELD = 'w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]'
const BUTTON = 'rounded-md border border-[var(--border)] px-2.5 py-1 text-xs hover:border-[var(--purple)] disabled:opacity-50'

/** "My notes" on a course: private, only for this student. Renders nothing outside the planner. */
export default function CourseNotesSection({ courseId }: { courseId: string }) {
  const library = useContext(CourseNotesContext)
  const { t } = useLocale()
  const [draft, setDraft] = useState<{ id?: string; kind: CourseNote['kind']; lecturer: string; body: string } | null>(null)
  if (!library) return null
  const notes = notesForCourse(library.notes, courseId)
  const submit = () => {
    if (!draft?.body.trim()) return
    library.save({ id: draft.id, courseId, kind: draft.kind, body: draft.body.trim(), ...(draft.lecturer.trim() ? { lecturer: draft.lecturer.trim() } : {}) })
    setDraft(null)
  }
  return (
    <section aria-label={t('ההערות שלי', 'My notes')} className="space-y-2 rounded-xl border border-[var(--border)] p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('ההערות שלי', 'My notes')} <span className="font-normal text-[var(--text-muted)]">· {t('פרטי', 'private')}</span></h3>
        {!draft && <button type="button" className={BUTTON} disabled={!library.ready} onClick={() => setDraft({ kind: 'experience', lecturer: '', body: '' })}>{t('הוספת הערה', 'Add note')}</button>}
      </div>
      {notes.map((note) => (
        <article key={note.id} className="space-y-1 border-t border-[var(--border)] pt-2">
          <p className="text-[var(--text-muted)]">{t(...KIND_LABELS[note.kind])}{note.lecturer ? ` · ${t('מרצה', 'Lecturer')}: ${note.lecturer}` : ''}</p>
          <p className="whitespace-pre-wrap">{note.body}</p>
          <div className="flex gap-2">
            <button type="button" className="underline" disabled={!library.ready} onClick={() => setDraft({ id: note.id, kind: note.kind, lecturer: note.lecturer ?? '', body: note.body })}>{t('עריכה', 'Edit')}</button>
            <button type="button" className="underline" disabled={!library.ready} onClick={() => library.remove(note.id)}>{t('מחיקה', 'Delete')}</button>
          </div>
        </article>
      ))}
      {draft && (
        <form className="space-y-2 border-t border-[var(--border)] pt-2" onSubmit={(e) => { e.preventDefault(); submit() }}>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">{t('סוג', 'Kind')}
              <select className={FIELD} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as CourseNote['kind'] })}>
                {COURSE_NOTE_KINDS.map((kind) => <option key={kind} value={kind}>{t(...KIND_LABELS[kind])}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">{t('מרצה (לא חובה)', 'Lecturer (optional)')}
              <input className={FIELD} maxLength={80} value={draft.lecturer} onChange={(e) => setDraft({ ...draft, lecturer: e.target.value })} />
            </label>
          </div>
          <label className="flex flex-col gap-1">{t('ההערה', 'Note')}
            <textarea className={FIELD} rows={3} maxLength={1000} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </label>
          <div className="flex gap-2">
            <button type="submit" className={BUTTON} disabled={!draft.body.trim()}>{t('שמירה', 'Save')}</button>
            <button type="button" className={BUTTON} onClick={() => setDraft(null)}>{t('ביטול', 'Cancel')}</button>
          </div>
        </form>
      )}
    </section>
  )
}
