'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ConversationContextConflictError,
  sendConversation,
  type ClientDeps,
  type ConversationProgress,
} from '../../../../shared/planner/api-client'
import type {
  ConversationProposal,
  ConversationRequest,
  ConversationResponse,
  ConversationTurn,
} from '../../../../shared/planner/conversation-wire'
import type { PreferenceProfile } from '../../../../api/ai/preference_model'
import { Card } from '../../../components/ui'
import CourseClarificationAnswer, { isCourseQuestion } from './CourseClarificationAnswer'
import CourseAnswerReview, { reviewCourseText, type CourseScope, type CourseTextReview } from './CourseAnswerReview'

type SendConversation = (
  request: ConversationRequest,
  onProgress?: (progress: ConversationProgress) => void,
) => Promise<ConversationResponse>
type LiveTurn = { steps: Array<{ tool: string; status: string }>; text: string }
type ClarificationAnswer = NonNullable<ConversationRequest['clarification_answers']>[number]
type ActiveClarification = {
  question_id: NonNullable<ClarificationAnswer['question_id']>
  answer_type: 'course_id_list' | 'number' | 'text'
}

/**
 * The model is allowed to cite canonical course ids, but ids alone are not a
 * usable Hebrew answer. Replace only ids that the authoritative board/catalog
 * supplied to this component, and retain the id in parentheses for auditability.
 * Unknown tokens stay untouched rather than being guessed.
 */
export function formatAssistantMessage(
  message: string,
  courseNameById: Readonly<Record<string, string | null | undefined>> = {},
): string {
  const entries = Object.entries(courseNameById)
    .filter(([, name]) => typeof name === 'string' && name.trim().length > 0)
    .sort(([a], [b]) => b.length - a.length)
  return entries.reduce((formatted, [courseId, name]) => {
    const escaped = courseId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`(^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`, 'g')
    return formatted.replace(pattern, (_match, prefix: string) => `${prefix}${name} (${courseId})`)
  }, message)
}

const browserFetch = ((url: string, init?: unknown) => fetch(url, init as RequestInit)) as ClientDeps['fetchImpl']
const defaultSendConversation: SendConversation = (request, onProgress) => sendConversation(
  { fetchImpl: browserFetch, baseUrl: '' },
  request,
  onProgress,
)

const TOOL_LABELS: Record<string, string> = {
  get_state: 'בדיקת מצב הלוח',
  rank_candidates: 'דירוג חלופות',
  get_academic_status: 'בדיקת סטטוס אקדמי',
  get_requirements_gap: 'בדיקת פערי דרישות',
  get_course_details: 'בדיקת פרטי קורס',
  get_offerings: 'בדיקת היצע וסמסטרים',
  check_prerequisites: 'בדיקת תנאי קדם',
  validate_plan: 'אימות הטיוטה הנוכחית',
  simulate_move: 'סימולציית העברת קורס',
  simulate_changes: 'בדיקת שינויים בתוכנית',
  compare_candidates: 'השוואת מועמדים',
  explain_constraint: 'הסבר אילוץ אקדמי',
  ask_clarification: 'שאלת המשך',
  add_course: 'בדיקת הוספת קורס',
  remove_course: 'בדיקת הסרת קורס',
  move_course: 'בדיקת העברת קורס',
  replace_course: 'בדיקת החלפת קורס',
  finalize_plan: 'אימות התוכנית',
  get_student_context: 'קריאת הסטטוס וההעדפות שלך',
  search_courses: 'חיפוש קורסים בקטלוג',
  update_preferences: 'עדכון העדפות התכנון',
  build_plan: 'בניית טיוטה לפי כללי התואר',
  ask_student: 'שאלת המשך',
  submit_proposal: 'אימות והגשת ההצעה',
  check_timetable: 'בדיקת מערכת שעות וימים פנויים',
  record_completed_courses: 'רישום הקורסים שהשלמת',
}

export default function AcademicAgentConversation({
  programId,
  sessionToken,
  boardVersion,
  academicStatusDigest,
  preferenceDigest,
  preferenceProfile,
  conversationReady = true,
  sendConversationFn = defaultSendConversation,
  onProposalReady,
  onAcademicContextUpdated,
  preferenceContent,
  courseNameById,
  localContextVersion = 0,
  courseScopes = [],
  onShowProposal,
}: {
  programId: string
  sessionToken: string
  boardVersion: string | null
  academicStatusDigest: string
  preferenceDigest: string
  preferenceProfile?: PreferenceProfile
  /** The durable academic context must be loaded before sending to the agent. */
  conversationReady?: boolean
  sendConversationFn?: SendConversation
  /** The server-owned, read-only materialization used to show the draft. */
  onProposalReady?: (proposal: ConversationProposal) => void
  /** Refreshes the parent's academic-context digests after a stored answer. */
  onAcademicContextUpdated?: (update: { academic_status_digest: string; preference_digest: string }) => void
  /** Optional preference questions rendered inside this same conversation card. */
  preferenceContent?: ReactNode
  /** Names come only from the authoritative board/catalog view model. */
  courseNameById?: Readonly<Record<string, string | null | undefined>>
  localContextVersion?: number
  courseScopes?: readonly CourseScope[]
  /** Brings the previewed proposal on the board into view. */
  onShowProposal?: () => void
}) {
  const [transcript, setTranscript] = useState<ConversationTurn[]>([])
  const [draft, setDraft] = useState('')
  const [lastResponse, setLastResponse] = useState<ConversationResponse | null>(null)
  const [pending, setPending] = useState(false)
  // What the co-pilot is doing right now (streamed), cleared when the turn ends.
  const [live, setLive] = useState<LiveTurn | null>(null)
  // Keyed by the assistant turn's index in the transcript.
  const [turnMeta, setTurnMeta] = useState<Record<number, { steps: string[]; proposal?: ConversationProposal }>>({})
  const logEndRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    logEndRef.current?.scrollIntoView?.({ block: 'end' })
  }, [transcript.length, live?.text, live?.steps.length])
  useEffect(() => {
    // Auto-grow the composer up to ~6 lines, like a chat app.
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [draft])
  const [error, setError] = useState<string | null>(null)
  const [contextConflict, setContextConflict] = useState(false)
  const [activeClarification, setActiveClarification] = useState<ActiveClarification | null>(null)
  const [responseContextVersion, setResponseContextVersion] = useState<number | null>(null)
  const contextVersionRef = useRef(localContextVersion)
  contextVersionRef.current = localContextVersion
  const [courseReview, setCourseReview] = useState<CourseTextReview | null>(null)

  const clarificationAnswerFromText = (text: string): ClarificationAnswer | undefined => {
    if (!activeClarification || responseContextVersion !== localContextVersion) return undefined
    if (activeClarification.answer_type === 'number') {
      const value = Number(text.replace(',', '.'))
      return Number.isFinite(value) ? { question_id: activeClarification.question_id, value } : undefined
    }
    if (activeClarification.answer_type === 'text') {
      return { question_id: activeClarification.question_id, value: text }
    }
    // Only an explicit complete statement means "none". Phrases such as
    // "לא יודע" or "לא השלמתי <course>" must remain conversational context.
    if (/^(?:אין קורסים(?: להחרגה)?|לא השלמתי (?:אף )?קורסים|אף קורס)[.!]?$/u.test(text)) {
      return { question_id: activeClarification.question_id, value: [] }
    }
    if (!/^\d{4}-\d{4}(?:[\s,;]+\d{4}-\d{4})*$/.test(text)) return undefined
    const ids = [...new Set(text.match(/\b\d{4}-\d{4}\b/g) ?? [])]
    return ids.length > 0
      ? { question_id: activeClarification.question_id, value: ids }
      : undefined
  }

  const submit = async (text: string, explicitAnswer?: ClarificationAnswer, opts?: { skipReview?: boolean }) => {
    const trimmed = text.trim()
    if (!trimmed || pending || contextConflict || !conversationReady) return
    const answer = explicitAnswer ?? clarificationAnswerFromText(trimmed)
    if (!opts?.skipReview && !answer && responseContextVersion === localContextVersion && activeClarification?.question_id === 'completed_courses') {
      const review = reviewCourseText(trimmed, courseNameById ?? {})
      if (review) { setCourseReview(review); setDraft(''); return }
    }
    const nextTranscript: ConversationTurn[] = [...transcript, { role: 'user', text: trimmed }]
    setTranscript(nextTranscript)
    setDraft('')
    setPending(true)
    setLive({ steps: [], text: '' })
    setError(null)
    setContextConflict(false)

    try {
      const response = await sendConversationFn({
        program_id: programId,
        session_token: sessionToken,
        board_version: boardVersion,
        academic_status_digest: academicStatusDigest,
        preference_digest: preferenceDigest,
        ...(preferenceProfile ? { preference_profile: preferenceProfile } : {}),
        ...(answer
          ? { clarification_answers: [answer] }
          : {}),
        transcript: nextTranscript,
      }, (progress) => setLive((current) => {
        const turn = current ?? { steps: [], text: '' }
        if (progress.type === 'text_delta') return { ...turn, text: turn.text + progress.text }
        if (progress.event.type !== 'tool_status') return turn
        const { tool, status } = progress.event
        // A finished step replaces its own "started" line.
        const steps = status === 'started' ? [...turn.steps, { tool, status }]
          : [...turn.steps.filter((step) => !(step.tool === tool && step.status === 'started')), { tool, status }]
        return { ...turn, steps }
      }))
      setLastResponse(response)
      setCourseReview(null)
      setResponseContextVersion(localContextVersion)
      const nextClarification = [...response.events]
        .reverse()
        .find((event): event is Extract<typeof event, { type: 'clarification' }> =>
          event.type === 'clarification' && Boolean(event.question_id && event.answer_type))
      setActiveClarification(nextClarification
        ? { question_id: nextClarification.question_id!, answer_type: nextClarification.answer_type! }
        : null)
      if (response.outcome !== 'assistant_unavailable' && response.context_update) {
        onAcademicContextUpdated?.(response.context_update)
      }
      if (response.outcome !== 'assistant_unavailable') {
        const steps = [...new Set(response.events.flatMap((event) =>
          event.type === 'tool_status' && event.status !== 'started' ? [TOOL_LABELS[event.tool] ?? 'בדיקה אקדמית'] : []))]
        setTurnMeta((current) => ({
          ...current,
          [nextTranscript.length]: { steps, ...(response.proposal ? { proposal: response.proposal } : {}) },
        }))
        setTranscript((current) => [...current, {
          role: 'assistant',
          text: formatAssistantMessage(response.message_he, courseNameById),
        }])
        if (response.proposal && contextVersionRef.current === localContextVersion) onProposalReady?.(response.proposal)
      }
    } catch (caught) {
      if (caught instanceof ConversationContextConflictError) {
        setError(caught.messageHe)
        setContextConflict(true)
      } else {
        setError('שליחת ההודעה נכשלה. הלוח הנוכחי לא השתנה.')
      }
    } finally {
      setPending(false)
      setLive(null)
    }
  }

  const restartConversation = () => {
    setTranscript([])
    setTurnMeta({})
    setDraft('')
    setLastResponse(null)
    setError(null)
    setContextConflict(false)
    setActiveClarification(null)
    setCourseReview(null)
  }

  const unavailable = lastResponse?.outcome === 'assistant_unavailable'
  const responseCurrent = responseContextVersion === localContextVersion
  const clarificationEvents = responseCurrent ? lastResponse?.events.filter((event) => event.type === 'clarification') ?? [] : []
  const canOfferBuild = responseCurrent && lastResponse?.outcome === 'conversation' && lastResponse.next_action === 'offer_build'
  const readiness = responseCurrent && lastResponse && lastResponse.outcome !== 'assistant_unavailable'
    ? lastResponse.academic_decision
    : undefined
  const blocked = !conversationReady || pending || contextConflict
  const currentStep = live ? [...live.steps].reverse().find((step) => step.status === 'started') : undefined
  const doneSteps = live ? live.steps.filter((step) => step.status !== 'started').length : 0

  return (
    <div dir="rtl" data-testid="academic-agent-conversation" className="flex h-full flex-col">
      <Card className="flex min-h-[32rem] flex-1 flex-col overflow-hidden p-0">
      <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full bg-[var(--purple-strong)] text-sm text-white">✦</span>
          <div>
            <h2 className="text-sm font-bold tracking-tight">עוזר התכנון</h2>
            <p className="text-[11px] text-[var(--text-muted)]">בודק כל שינוי מול כללי התואר · רק אתם מחילים</p>
          </div>
        </div>
        {transcript.length > 0 && (
          <button type="button" onClick={restartConversation} disabled={pending}
            className="rounded-full px-3 py-1 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--purple)]/10 hover:text-[var(--purple)] disabled:opacity-50">
            ＋ שיחה חדשה
          </button>
        )}
      </header>
      <div
        data-testid="academic-agent-board-context"
        aria-label="הקשר הלוח של העוזר"
        className="sr-only"
      >
        <span>לוח התוכנית הנוכחי</span>
        <span>• {boardVersion ? 'גרסה שמורה' : 'לפני שמירה אישית'}</span>
        <span>• הצעה לא משנה את הלוח</span>
      </div>

      {preferenceContent && (
        <section
          aria-label="מידע שהעוזר צריך לדעת"
          data-testid="academic-agent-context"
          className="border-b border-[var(--border)] px-4 py-2"
        >
          {preferenceContent}
        </section>
      )}

      <div
        role="log"
        aria-label="תמליל שיחה עם עוזר התכנון"
        aria-live="polite"
        className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
      >
        {transcript.length === 0 && !pending ? (
          <div className="m-auto flex max-w-sm flex-col items-center gap-3 text-center">
            <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-full bg-[var(--purple-strong)] text-lg text-white">✦</span>
            <p className="text-sm font-semibold">איך אפשר לעזור בתכנון התואר?</p>
            <p className="text-xs text-[var(--text-muted)]">ספרו מה כבר השלמתם ומה חשוב לכם — העוזר יבנה תוכנית שעומדת בכללי התואר.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {[
                'סיימתי את שנים א׳–ב׳. תבנה לי תוכנית',
                'מה עוד חסר לי כדי לסיים את התואר?',
                'אני רוצה עד 20 שעות שבועיות בכל סמסטר',
                'אילו קורסי בחירה בבקרה ורובוטיקה יש?',
              ].map((prompt) => (
                <button key={prompt} type="button" disabled={blocked} onClick={() => void submit(prompt)}
                  className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:border-[var(--purple)]/50 hover:text-[var(--purple)] disabled:opacity-50">
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : transcript.map((turn, index) => turn.role === 'user' ? (
          <div key={`user-${index}`} className="flex justify-end">
            <p className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-bl-md bg-[var(--purple)]/15 px-3.5 py-2 text-sm">
              <span className="sr-only">אתם: </span>{turn.text}
            </p>
          </div>
        ) : (
          <div key={`assistant-${index}`} className="flex gap-2.5">
            <span aria-hidden="true" className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--purple-strong)] text-xs text-white">✦</span>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {(turnMeta[index]?.steps.length ?? 0) > 0 && (
                <details className="group text-xs text-[var(--text-muted)]">
                  <summary className="cursor-pointer select-none list-none hover:text-[var(--text)]">
                    ✓ {turnMeta[index].steps.length} בדיקות מול כללי התואר <span className="group-open:hidden">▾</span><span className="hidden group-open:inline">▴</span>
                  </summary>
                  <ul aria-label="שלבי כלי הסוכן" className="mt-1.5 flex flex-col gap-0.5 border-r-2 border-[var(--border)] pr-3">
                    {turnMeta[index].steps.map((step) => <li key={step}>{step}</li>)}
                  </ul>
                </details>
              )}
              <p className="whitespace-pre-line text-sm leading-relaxed"><span className="sr-only">העוזר: </span>{turn.text}</p>
              {turnMeta[index]?.proposal && (
                <section aria-label="הצעה מוכנה" className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
                  <p className="font-semibold text-emerald-800 dark:text-emerald-200">✓ ההצעה מוכנה ומוצגת בלוח</p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {turnMeta[index].proposal!.alternatives.length > 1 ? `${turnMeta[index].proposal!.alternatives.length} חלופות לבחירה · ` : ''}
                    עברו עליה ואשרו כדי להחיל — הלוח לא משתנה בלי אישורכם.
                  </p>
                  {onShowProposal && (
                    <button type="button" onClick={onShowProposal}
                      className="mt-2 rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
                      הצג את ההצעה בלוח
                    </button>
                  )}
                </section>
              )}
            </div>
          </div>
        ))}

        {pending && (
          <div role="status" aria-live="polite" data-testid="academic-agent-live" className="flex gap-2.5">
            <span aria-hidden="true" className="mt-0.5 grid h-6 w-6 shrink-0 animate-pulse place-items-center rounded-full bg-[var(--purple-strong)] text-xs text-white">✦</span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <p className="text-xs text-[var(--text-muted)]">
                {currentStep ? `${TOOL_LABELS[currentStep.tool] ?? 'בדיקה אקדמית'}…` : 'בודק את התוכנית…'}
                {doneSteps > 0 && <span className="mr-1 opacity-70">({doneSteps} בדיקות הושלמו)</span>}
              </p>
              {live?.text && (
                <p className="whitespace-pre-line text-sm leading-relaxed">
                  {formatAssistantMessage(live.text, courseNameById)}
                  <span aria-hidden="true" className="mr-0.5 inline-block h-4 w-1.5 animate-pulse bg-[var(--text-muted)] align-middle" />
                </p>
              )}
            </div>
          </div>
        )}

        {readiness && (readiness.clarification_required || readiness.ready_to_plan) && readiness.clarification_required && (
          <p data-testid="academic-agent-readiness" role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
            <strong>עדיין לא ניתן לבנות חלופות</strong> — נדרש מידע אקדמי נוסף לפני בניית מערכת.
          </p>
        )}

        {clarificationEvents.map((event, index) => event.type === 'clarification' ? (
          <section key={`${event.question_he}-${index}`} role="group" aria-label="שאלת המשך מהעוזר האקדמי" className="mr-8 flex flex-col gap-2">
            {!transcript.some((turn) => turn.role === 'assistant' && turn.text.includes(event.question_he)) && (
              <p className="text-sm">{event.question_he}</p>
            )}
            {courseReview && event.question_id === 'completed_courses' ? (
              <CourseAnswerReview key={courseReview.text} review={courseReview} names={courseNameById ?? {}} scopes={courseScopes}
                disabled={blocked}
                onConfirm={(ids, text) => void submit(text, { question_id: 'completed_courses', value: ids })}
                onCancel={() => { setDraft(courseReview.text); setCourseReview(null) }}
                onSendRaw={() => { const text = courseReview.text; setCourseReview(null); void submit(text, undefined, { skipReview: true }) }} />
            ) : event.answer_type === 'course_id_list' && isCourseQuestion(event.question_id) && (
              <CourseClarificationAnswer
                questionId={event.question_id}
                courseNameById={courseNameById}
                disabled={blocked}
                onConfirm={(ids, text) => void submit(text, { question_id: event.question_id!, value: ids })}
              />
            )}
            {event.options_he && !(event.answer_type === 'course_id_list' && isCourseQuestion(event.question_id)) && (
              <div className="flex flex-wrap gap-2">
                {event.options_he.map((option) => (
                  <button
                    key={option}
                    type="button"
                    disabled={blocked}
                    onClick={() => void submit(option, event.question_id && event.answer_type
                      ? {
                          question_id: event.question_id,
                          value: event.answer_type === 'course_id_list' ? [option]
                            : event.answer_type === 'number' ? Number(option) : option,
                        }
                      : undefined)}
                    className="rounded-full border border-[var(--purple)]/50 px-3.5 py-1.5 text-sm transition-colors hover:bg-[var(--purple)]/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : null)}

        {canOfferBuild && (
          <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
            יש לסוכן מספיק מידע כדי להכין חלופות חוקיות. אפשר לבקש ממנו לבנות עכשיו.
          </p>
        )}
        {!conversationReady && (
          <p role="status" aria-live="polite" className="text-xs text-[var(--text-muted)]">
            טוען את ההקשר האקדמי המאובטח לפני פתיחת השיחה…
          </p>
        )}
        {unavailable && <p role="alert" className="rounded-lg border border-amber-500/40 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">{lastResponse.message_he}</p>}
        {error && <p role="alert" className="rounded-lg border border-red-500/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
        <div ref={logEndRef} />
      </div>

      <form onSubmit={(event) => { event.preventDefault(); void submit(draft) }} className="border-t border-[var(--border)] p-3">
        <label htmlFor="academic-agent-message" className="sr-only">הודעה לעוזר האקדמי</label>
        <div className="flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 focus-within:border-[var(--purple)]/60">
          <textarea
            ref={composerRef}
            id="academic-agent-message"
            name="academic-agent-message"
            aria-label="הודעה לעוזר האקדמי"
            rows={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submit(draft)
              }
            }}
            disabled={blocked}
            placeholder={pending ? 'העוזר עובד…' : 'כתבו הודעה… (Shift+Enter לשורה חדשה)'}
            className="max-h-40 min-h-[1.5rem] flex-1 resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-[var(--text-muted)]"
          />
          <button type="submit" aria-label="שלח לעוזר" disabled={blocked || !draft.trim()}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--purple-strong)] text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40">
            <span aria-hidden="true" className="text-base leading-none">↑</span>
          </button>
        </div>
        {(canOfferBuild || contextConflict) && (
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            {canOfferBuild && (
              <button type="button" disabled={blocked} onClick={() => void submit('בנה לי חלופות חוקיות')}
                className="rounded-full border border-[var(--purple)]/60 px-4 py-1.5 text-xs font-semibold text-[var(--purple)] hover:bg-[var(--purple)]/10 disabled:opacity-50">
                בנה חלופות
              </button>
            )}
            {contextConflict && (
              <button type="button" onClick={restartConversation}
                className="rounded-full border border-red-500/40 px-4 py-1.5 text-xs font-semibold text-red-700 dark:text-red-300">
                התחל שיחה חדשה
              </button>
            )}
          </div>
        )}
      </form>
      </Card>
    </div>
  )
}
