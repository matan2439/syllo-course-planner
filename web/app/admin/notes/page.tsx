'use client'
import { useCallback, useEffect, useState } from 'react'
import type { HiddenCommunityNote } from '../../../../shared/planner/course-notes'
import { fetchHiddenNotes, moderateCommunityNote } from '../../../features/planner/lib/student-workspace-client'

/**
 * Review queue for shared course notes hidden by student reports. Access is enforced by the
 * server (developers only); this page renders what the moderation scope returns.
 */
const BTN = 'rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold hover:border-[var(--purple)] disabled:opacity-50'

export default function NotesModerationPage() {
  const [notes, setNotes] = useState<HiddenCommunityNote[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(() => {
    fetchHiddenNotes().then((rows) => { setNotes(rows); setError('') },
      (err) => setError(err?.code === 'FORBIDDEN' ? 'הדף זמין למפתחים בלבד.' : 'הטעינה נכשלה.'))
  }, [])
  useEffect(load, [load])
  const decide = async (id: string, decision: 'restore' | 'remove') => {
    setBusy(id)
    try { await moderateCommunityNote(id, decision); setNotes((rows) => rows?.filter((row) => row.id !== id) ?? null) }
    catch { setError('הפעולה נכשלה.') }
    finally { setBusy(null) }
  }
  return (
    <main dir="rtl" className="mx-auto max-w-3xl space-y-4 p-6 text-[var(--text)]">
      <h1 className="text-xl font-bold">הערות שהוסתרו בעקבות דיווחים</h1>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {notes?.length === 0 && <p className="text-sm text-[var(--text-muted)]">אין הערות לבדיקה.</p>}
      {notes?.map((note) => (
        <article key={note.id} className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
          <p className="text-xs text-[var(--text-muted)]">
            {note.courseId}{note.lecturer ? ` · ${note.lecturer}` : ''} · {note.reports} דיווחים · {new Date(note.hiddenAt).toLocaleString('he-IL')}
          </p>
          <p className="whitespace-pre-wrap">{note.body}</p>
          <div className="flex gap-2">
            <button type="button" className={BTN} disabled={busy === note.id} onClick={() => void decide(note.id, 'restore')}>החזרה לפרסום</button>
            <button type="button" className={BTN} disabled={busy === note.id} onClick={() => void decide(note.id, 'remove')}>מחיקה</button>
          </div>
        </article>
      ))}
    </main>
  )
}
