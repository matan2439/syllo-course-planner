'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { COURSE_NOTE_KINDS, notesForCourse, type CommunityCourseNote, type CourseNote } from '../../../../shared/planner/course-notes'
import { fetchCommunityNotes, reportCommunityNote } from '../../planner/lib/student-workspace-client'
import { useAuth } from '../../auth/AuthProvider'
import { useLocale } from '../../locale/LocaleProvider'

export interface CourseNotesLibrary {
  notes: readonly CourseNote[]
  ready: boolean
  save: (note: Omit<CourseNote, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => void
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

type Draft = { id?: string; kind: CourseNote['kind']; lecturer: string; body: string; shared: boolean }

/** Notes on a course: what students shared anonymously, then this student's own notes (private unless shared). */
export default function CourseNotesSection({ courseId }: { courseId: string }) {
  const library = useContext(CourseNotesContext)
  const { user } = useAuth()
  const { t } = useLocale()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [community, setCommunity] = useState<CommunityCourseNote[] | null>(null)
  useEffect(() => {
    let live = true
    fetchCommunityNotes(courseId).then((notes) => { if (live) setCommunity(notes) }, () => { if (live) setCommunity([]) })
    return () => { live = false }
  }, [courseId, user?.id])
  const report = (id: string) => {
    setCommunity((notes) => notes?.map((note) => note.id === id ? { ...note, reported: true } : note) ?? null)
    reportCommunityNote(id).catch(() => setCommunity((notes) => notes?.map((note) => note.id === id ? { ...note, reported: false } : note) ?? null))
  }
  const others = (community ?? []).filter((note) => !note.mine)
  const notes = library ? notesForCourse(library.notes, courseId) : []
  const submit = () => {
    if (!library || !draft?.body.trim()) return
    library.save({ id: draft.id, courseId, kind: draft.kind, body: draft.body.trim(), visibility: draft.shared && user ? 'community' : 'private',
      ...(draft.lecturer.trim() ? { lecturer: draft.lecturer.trim() } : {}) })
    setDraft(null)
  }
  const meta = (kind: CourseNote['kind'], lecturer?: string) =>
    `${t(...KIND_LABELS[kind])}${lecturer ? ` · ${t('מרצה', 'Lecturer')}: ${lecturer}` : ''}`
  return (
    <section aria-label={t('הערות על הקורס', 'Course notes')} className="space-y-3 rounded-xl border border-[var(--border)] p-3 text-xs">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t('מה סטודנטים כתבו', 'What students wrote')}</h3>
        {community === null ? <p className="text-[var(--text-muted)]">{t('טוען…', 'Loading…')}</p>
          : others.length === 0 ? <p className="text-[var(--text-muted)]">{t('עדיין אין הערות משותפות לקורס הזה.', 'No shared notes for this course yet.')}</p>
          : others.map((note) => (
            <article key={note.id} className="space-y-1 border-t border-[var(--border)] pt-2">
              <p className="text-[var(--text-muted)]">{meta(note.kind, note.lecturer)}</p>
              <p className="whitespace-pre-wrap">{note.body}</p>
              {user && (note.reported
                ? <p className="text-[var(--text-muted)]">{t('דיווחת על ההערה', 'You reported this note')}</p>
                : <button type="button" className="underline text-[var(--text-muted)]" onClick={() => report(note.id)}>{t('דיווח על תוכן לא הולם', 'Report')}</button>)}
            </article>
          ))}
      </div>

      {library && (
        <div className="space-y-2 border-t border-[var(--border)] pt-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t('ההערות שלי', 'My notes')}</h3>
            {!draft && <button type="button" className={BUTTON} disabled={!library.ready} onClick={() => setDraft({ kind: 'experience', lecturer: '', body: '', shared: false })}>{t('הוספת הערה', 'Add note')}</button>}
          </div>
          {notes.map((note) => (
            <article key={note.id} className="space-y-1 border-t border-[var(--border)] pt-2">
              <p className="text-[var(--text-muted)]">{meta(note.kind, note.lecturer)} · {note.visibility === 'community' ? t('משותף באופן אנונימי', 'Shared anonymously') : t('פרטי', 'Private')}</p>
              <p className="whitespace-pre-wrap">{note.body}</p>
              <div className="flex gap-2">
                <button type="button" className="underline" disabled={!library.ready} onClick={() => setDraft({ id: note.id, kind: note.kind, lecturer: note.lecturer ?? '', body: note.body, shared: note.visibility === 'community' })}>{t('עריכה', 'Edit')}</button>
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
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-[var(--purple-strong)]" disabled={!user} checked={draft.shared && !!user}
                  onChange={(e) => setDraft({ ...draft, shared: e.target.checked })} />
                {user ? t('לשתף באופן אנונימי עם סטודנטים אחרים', 'Share anonymously with other students')
                  : t('התחברו כדי לשתף עם סטודנטים אחרים', 'Sign in to share with other students')}
              </label>
              <div className="flex gap-2">
                <button type="submit" className={BUTTON} disabled={!draft.body.trim()}>{t('שמירה', 'Save')}</button>
                <button type="button" className={BUTTON} onClick={() => setDraft(null)}>{t('ביטול', 'Cancel')}</button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  )
}
