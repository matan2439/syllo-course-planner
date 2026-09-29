'use client'

import { useState } from 'react'
import type { CourseDetailsVM } from '../../../lib/course-details'
import { getAiSessionToken } from '../../../lib/ai-session-token'

const SEMESTER_LABELS: Record<string, string> = { A: 'א׳', B: 'ב׳' }
/** Earlier turns sent with each question; the server accepts at most 20. */
const HISTORY_TURNS = 12

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/** The student's planning context (the same one the planning co-pilot gets). */
export interface StudentContext {
  plan_context: Record<string, unknown>
  preferences?: Record<string, unknown>
}

export interface CourseAskRequest {
  question: string
  course: CourseDetailsVM
  programId: string
  history: ChatTurn[]
  studentContext?: StudentContext
}

function buildCourseContext(course: CourseDetailsVM): string {
  const lines = [
    `קוד קורס: ${course.id}`,
    `שם קורס: ${course.name}`,
    `שעות שבועיות: ${course.weeklyHours ?? 'לא ידוע'}`,
    `נקודות זכות: ${course.credits ?? 'לא ידוע'}`,
    `קטגוריה: ${course.category ?? 'לא ידוע'}`,
    `סמסטרי הצעה: ${course.offered.length ? course.offered.map((s) => SEMESTER_LABELS[s] ?? s).join(', ') : 'לא ידוע'}`,
    course.prerequisites.length
      ? `דרישות קדם: ${course.prerequisites.map((p) => p.name ?? p.id).join(', ')}`
      : 'דרישות קדם: אין',
    course.syllabusUrl ? `קישור סילבוס: ${course.syllabusUrl}` : 'קישור סילבוס: אין',
  ]
  return lines.join('\n')
}

/** Streams the co-pilot's plain-text answer into `onChunk`, called once per chunk. */
export async function streamAskCourse(request: CourseAskRequest, onChunk: (chunk: string) => void): Promise<void> {
  const response = await fetch('/api/ai/course-planner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: request.question,
      program_id: request.programId,
      plan_context: request.studentContext?.plan_context ?? { semesters: [] },
      ...(request.studentContext?.preferences ? { preferences: request.studentContext.preferences } : {}),
      course_id: request.course.id,
      course_context: buildCourseContext(request.course),
      history: request.history.slice(-HISTORY_TURNS),
      session_token: getAiSessionToken(),
    }),
  })
  if (!response.ok || !response.body) {
    let messageHe = `שגיאה ${response.status}`
    try {
      const body = await response.json()
      if (typeof body.message_he === 'string' && body.message_he.trim()) messageHe = body.message_he
      else if (typeof body.error === 'string') messageHe = body.error
    } catch {
      // keep the generic status message
    }
    throw new Error(messageHe)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    onChunk(decoder.decode(value, { stream: true }))
  }
}

export default function CourseAiChat({
  programId,
  course,
  suggestions,
  getStudentContext,
  askFn = streamAskCourse,
}: {
  programId: string
  course: CourseDetailsVM
  /** Chips derived from this course's data; null while they load. */
  suggestions: string[] | null
  /** The student's current planning context, read at ask time. */
  getStudentContext?: () => StudentContext | undefined
  askFn?: typeof streamAskCourse
}) {
  const [draft, setDraft] = useState('')
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [answer, setAnswer] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ask = async (text: string) => {
    const question = text.trim()
    if (!question || pending) return
    const history = turns
    setTurns([...history, { role: 'user', content: question }])
    setDraft('')
    setAnswer('')
    setError(null)
    setPending(true)
    let streamed = ''
    try {
      await askFn(
        { question, course, programId, history, studentContext: getStudentContext?.() },
        (chunk) => { streamed += chunk; setAnswer(streamed) },
      )
      if (streamed.trim()) setTurns((current) => [...current, { role: 'assistant', content: streamed }])
      else setTurns(history)
    } catch (caught) {
      // A failed question leaves no half-turn behind, so a retry sends clean history.
      setTurns(history)
      setError(caught instanceof Error ? caught.message : 'שליחת השאלה נכשלה. נסה שוב.')
    } finally {
      setAnswer('')
      setPending(false)
    }
  }

  const askedAlready = new Set(turns.filter((turn) => turn.role === 'user').map((turn) => turn.content))
  const chips = (suggestions ?? []).filter((chip) => !askedAlready.has(chip))

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-4">
      <h3 className="text-xs font-semibold">שאלו את העוזר האקדמי על {course.name}</h3>

      {(pending || turns.length > 0) && (
        <div role="log" aria-live="polite" className="flex flex-col gap-2">
          {turns.map((turn, i) => (
            <p
              key={i}
              className={turn.role === 'user'
                ? 'self-start rounded-lg bg-black/[.04] px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)] dark:bg-white/[.06]'
                : 'whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm'}
            >
              {turn.content}
            </p>
          ))}
          {pending && (
            <p className="whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
              {answer || <span className="text-[var(--text-muted)]">בודק בסילבוס, בציונים ובתוכנית שלך…</span>}
            </p>
          )}
        </div>
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={pending}
              onClick={() => void ask(prompt)}
              className="rounded-full border border-[var(--border)] px-2.5 py-1 text-start text-[11px] text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--purple)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              💬 {prompt}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(event) => { event.preventDefault(); void ask(draft) }}
        className="flex flex-col gap-2"
      >
        <label htmlFor="course-ai-chat-input" className="sr-only">שאלה על הקורס</label>
        <textarea
          id="course-ai-chat-input"
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(draft) }
          }}
          placeholder={turns.length ? 'שאלת המשך…' : 'שאל שאלה על הקורס…'}
          disabled={pending}
          className="w-full resize-y rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]"
        />
        <button
          type="submit"
          disabled={pending || !draft.trim()}
          className="self-end rounded-full bg-[var(--purple-strong)] px-4 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          שלח ›
        </button>
      </form>

      {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
    </div>
  )
}
