'use client'

import { useRef, useState, type ReactNode } from 'react'
import {
  ConversationContextConflictError,
  sendConversation,
  type ClientDeps,
} from '../../../shared/planner/api-client'
import type {
  ConversationProposal,
  ConversationRequest,
  ConversationResponse,
  ConversationTurn,
} from '../../../shared/planner/conversation-wire'
import type { PreferenceProfile } from '../../../api/ai/preference_model'
import { Card } from './ui'
import CourseClarificationAnswer, { isCourseQuestion } from './CourseClarificationAnswer'
import CourseAnswerReview, { reviewCourseText, type CourseScope, type CourseTextReview } from './CourseAnswerReview'

type SendConversation = (request: ConversationRequest) => Promise<ConversationResponse>
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
const defaultSendConversation: SendConversation = (request) => sendConversation(
  { fetchImpl: browserFetch, baseUrl: '' },
  request,
)

const TOOL_LABELS: Record<string, string> = {
  get_state: 'בדיקת מצב הלוח',
  rank_candidates: 'דירוג חלופות',
  get_academic_status: 'בדיקת סטטוס אקדמי',
  get_requirements_gap: 'בדיקת פערי דרישות',
  get_course_details: 'בדיקת פרטי קורס',
  get_offerings: 'בדיקת היצע וסמסטרים',
  check_prerequisites: 'בדיקת תנאי קדם',
  simulate_move: 'סימולציית העברת קורס',
  compare_candidates: 'השוואת מועמדים',
  explain_constraint: 'הסבר אילוץ אקדמי',
  ask_clarification: 'שאלת המשך',
  add_course: 'בדיקת הוספת קורס',
  remove_course: 'בדיקת הסרת קורס',
  move_course: 'בדיקת העברת קורס',
  replace_course: 'בדיקת החלפת קורס',
  finalize_plan: 'אימות התוכנית',
}

const TOOL_STATUS_LABELS: Record<string, string> = {
  started: 'בתהליך',
  completed: 'הושלם',
  rejected: 'נדחה לפי הכללים',
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
}) {
  const [transcript, setTranscript] = useState<ConversationTurn[]>([])
  const [draft, setDraft] = useState('')
  const [lastResponse, setLastResponse] = useState<ConversationResponse | null>(null)
  const [pending, setPending] = useState(false)
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

  const submit = async (text: string, explicitAnswer?: ClarificationAnswer) => {
    const trimmed = text.trim()
    if (!trimmed || pending || contextConflict || !conversationReady) return
    const answer = explicitAnswer ?? clarificationAnswerFromText(trimmed)
    if (!answer && responseContextVersion === localContextVersion && activeClarification?.question_id === 'completed_courses') {
      const review = reviewCourseText(trimmed, courseNameById ?? {})
      if (review) { setCourseReview(review); setDraft(''); return }
    }
    const nextTranscript: ConversationTurn[] = [...transcript, { role: 'user', text: trimmed }]
    setTranscript(nextTranscript)
    setDraft('')
    setPending(true)
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
      })
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
    }
  }

  const restartConversation = () => {
    setTranscript([])
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

  return (
    <div dir="rtl" data-testid="academic-agent-conversation">
      <Card className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="text-sm font-bold tracking-tight">שיחה עם עוזר התכנון</h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          אפשר לשאול בעברית. העוזר בודק את הלוח והכללים, אבל רק אישור מפורש שלך מחיל שינוי.
        </p>
        <div
          data-testid="academic-agent-board-context"
          aria-label="הקשר הלוח של העוזר"
          className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs"
        >
          <span className="font-semibold">לוח התוכנית הנוכחי</span>
          <span className="text-[var(--text-muted)]">• {boardVersion ? 'גרסה שמורה' : 'לפני שמירה אישית'}</span>
          <span className="text-[var(--text-muted)]">• הצעה לא משנה את הלוח</span>
        </div>
      </div>

      {preferenceContent && (
        <section
          aria-label="מידע שהעוזר צריך לדעת"
          data-testid="academic-agent-context"
          className="border-b border-[var(--border)] pb-3"
        >
          {preferenceContent}
        </section>
      )}

      <div
        role="log"
        aria-label="תמליל שיחה עם עוזר התכנון"
        aria-live="polite"
        className="flex max-h-72 min-h-24 flex-col gap-2 overflow-y-auto rounded-lg border border-[var(--border)] p-3"
      >
        {transcript.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">כתבו בקשה, למשל: „בנה לי שתי חלופות מאוזנות”.</p>
        ) : transcript.map((turn, index) => (
          <p key={`${turn.role}-${index}`} className={turn.role === 'user' ? 'text-sm' : 'text-sm text-[var(--text-muted)]'}>
            <span className="font-semibold">{turn.role === 'user' ? 'אתם: ' : 'העוזר: '}</span>
            {turn.text}
          </p>
        ))}
      </div>

      {lastResponse && !unavailable && (
        <div aria-label="פעילות העוזר" className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          {lastResponse.events.filter((event) => event.type === 'tool_status').map((event, index) => (
            <p key={`${event.tool}-${index}`}>
              {TOOL_LABELS[event.tool] ?? 'בדיקה אקדמית'} — {TOOL_STATUS_LABELS[event.status] ?? 'עודכן'}
            </p>
          ))}
          {lastResponse.events.some((event) => event.type === 'alternatives_ready') && (
            <p className="font-semibold text-[var(--purple)]">החלופה מוכנה לבדיקה בלוח.</p>
          )}
        </div>
      )}

      {readiness && (readiness.clarification_required || readiness.ready_to_plan) && (
        <div
          data-testid="academic-agent-readiness"
          role="status"
          aria-live="polite"
          className={readiness.clarification_required
            ? 'rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm'
            : 'rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm'}
        >
          {readiness.clarification_required ? (
            <>
              <strong className="block">עדיין לא ניתן לבנות חלופות</strong>
              <span className="text-[var(--text-muted)]">נדרש מידע אקדמי נוסף לפני בניית מערכת.</span>
            </>
          ) : (
            <>
              <strong className="block">הסוכן מוכן לבניית חלופות</strong>
              <span className="text-[var(--text-muted)]">אפשר לבקש עכשיו בנייה של חלופות חוקיות.</span>
            </>
          )}
        </div>
      )}

      {!conversationReady && (
        <p role="status" aria-live="polite" className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-muted)]">
          טוען את ההקשר האקדמי המאובטח לפני פתיחת השיחה…
        </p>
      )}

      {clarificationEvents.map((event, index) => event.type === 'clarification' ? (
        <section key={`${event.question_he}-${index}`} role="group" aria-label="שאלת המשך מהעוזר האקדמי" className="rounded-xl border border-[var(--purple)]/40 bg-[var(--purple)]/5 p-4">
          <h3 className="font-semibold">שאלת המשך</h3>
          <p className="mt-1 text-sm">{event.question_he}</p>
          {courseReview && event.question_id === 'completed_courses' ? (
            <CourseAnswerReview key={courseReview.text} review={courseReview} names={courseNameById ?? {}} scopes={courseScopes}
              disabled={pending || contextConflict || !conversationReady}
              onConfirm={(ids, text) => void submit(text, { question_id: 'completed_courses', value: ids })}
              onCancel={() => { setDraft(courseReview.text); setCourseReview(null) }} />
          ) : event.answer_type === 'course_id_list' && isCourseQuestion(event.question_id) && (
            <CourseClarificationAnswer
              questionId={event.question_id}
              courseNameById={courseNameById}
              disabled={pending || contextConflict || !conversationReady}
              onConfirm={(ids, text) => void submit(text, { question_id: event.question_id!, value: ids })}
            />
          )}
          {event.options_he && !(event.answer_type === 'course_id_list' && isCourseQuestion(event.question_id)) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {event.options_he.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={pending || contextConflict || !conversationReady}
                  onClick={() => void submit(option, event.question_id && event.answer_type
                    ? {
                        question_id: event.question_id,
                        value: event.answer_type === 'course_id_list' ? [option]
                          : event.answer_type === 'number' ? Number(option) : option,
                      }
                    : undefined)}
                  className="rounded-full border border-[var(--purple)]/50 px-4 py-2 text-sm font-semibold transition-colors hover:bg-[var(--purple)]/10 disabled:cursor-not-allowed disabled:opacity-50"
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

      {pending && <p role="status" aria-live="polite" className="text-sm text-[var(--text-muted)]">בודק את התוכנית…</p>}
      {unavailable && <p role="alert" className="rounded-lg border border-amber-500/40 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">{lastResponse.message_he}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-500/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</p>}

      <form onSubmit={(event) => { event.preventDefault(); void submit(draft) }} className="flex flex-col gap-2">
        <label htmlFor="academic-agent-message" className="text-xs font-semibold text-[var(--text-muted)]">הודעה לעוזר האקדמי</label>
        <textarea
          id="academic-agent-message"
          name="academic-agent-message"
          aria-label="הודעה לעוזר האקדמי"
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void submit(draft)
            }
          }}
          disabled={!conversationReady || pending || contextConflict}
          placeholder="כתבו בקשה או שאלה…"
          className="w-full resize-y rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]"
        />
        <div className="flex flex-wrap justify-end gap-2">
          <button type="submit" disabled={!conversationReady || pending || contextConflict || !draft.trim()} className="rounded-full bg-[var(--purple-strong)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            שלח לעוזר
          </button>
          {canOfferBuild && (
            <button
              type="button"
              disabled={!conversationReady || pending || contextConflict}
              onClick={() => void submit('בנה לי חלופות חוקיות')}
              className="rounded-full border border-[var(--purple)]/60 px-4 py-2 text-sm font-semibold text-[var(--purple)] transition-colors hover:bg-[var(--purple)]/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              בנה חלופות
            </button>
          )}
          {contextConflict && (
            <button
              type="button"
              onClick={restartConversation}
              className="rounded-full border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-700 dark:text-red-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]"
            >
              התחל שיחה חדשה
            </button>
          )}
        </div>
      </form>
      </Card>
    </div>
  )
}
