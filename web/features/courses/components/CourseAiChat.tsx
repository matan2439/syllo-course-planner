'use client'

import { useState } from 'react'
import type { CourseDetailsVM } from '../../../lib/course-details'
import { getAiSessionToken } from '../../../lib/ai-session-token'

const SUGGESTED_PROMPTS = [
  'הסבר לי מה לומדים בקורס לפי הסילבוס',
  'האם הקורס מתאים למי שמעדיף עומס קל?',
  'אילו קורסים כדאי לקחת לפניו?',
  'מה חסר במידע על הקורס?',
]

const SEMESTER_LABELS: Record<string, string> = { A: 'א׳', B: 'ב׳' }

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

/** Streams a plain-text response body into `onChunk`, called once per chunk. */
async function streamAskCourse(
  question: string,
  course: CourseDetailsVM,
  programId: string,
  onChunk: (chunk: string) => void,
): Promise<void> {
  const response = await fetch('/api/ai/course-planner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: question,
      program_id: programId,
      plan_context: { semesters: [] },
      course_context: buildCourseContext(course),
      session_token: getAiSessionToken(),
    }),
  })
  if (!response.ok || !response.body) {
    let messageHe = `שגיאה ${response.status}`
    try {
      const body = await response.json()
      if (body.code === 'QUOTA_EXCEEDED') messageHe = 'ניצלת את מכסת שאלות ה-AI החינמית.'
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
  askFn = streamAskCourse,
}: {
  programId: string
  course: CourseDetailsVM
  askFn?: typeof streamAskCourse
}) {
  const [draft, setDraft] = useState('')
  const [question, setQuestion] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ask = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || pending) return
    setQuestion(trimmed)
    setDraft('')
    setAnswer('')
    setError(null)
    setPending(true)
    try {
      await askFn(trimmed, course, programId, (chunk) => setAnswer((current) => current + chunk))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'שליחת השאלה נכשלה. נסה שוב.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-4">
      <h3 className="text-xs font-semibold">שאלו את עוזר הקורסים על {course.name}</h3>

      <div className="flex flex-wrap gap-1.5">
        {SUGGESTED_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={pending}
            onClick={() => void ask(prompt)}
            className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--purple)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            💬 {prompt}
          </button>
        ))}
      </div>

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
          placeholder="שאל שאלה על הקורס…"
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

      {(pending || question) && (
        <div
          role="log"
          aria-live="polite"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        >
          {question && <p className="mb-1 text-xs font-semibold text-[var(--text-muted)]">{question}</p>}
          {pending && !answer && <p className="text-[var(--text-muted)]">מחשב תשובה…</p>}
          {answer && <p className="whitespace-pre-wrap">{answer}</p>}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
    </div>
  )
}
