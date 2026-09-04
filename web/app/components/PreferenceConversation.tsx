'use client'

/**
 * Slice 13 — the native preference conversation. A thin driver over the REAL
 * typed conversation state machine (api/ai/conversation_state) +
 * DeterministicPreferenceElicitation. There is NO parallel UI-only preference
 * model: this component only reads/advances the typed ConversationState.
 *
 * Boundaries: answering / confirming / rejecting / removing update DRAFT
 * preference state only and NEVER call Generate — only the explicit Build action
 * invokes onBuild(profile). Restrained interaction (productivity tool): instant
 * question transitions, no decorative motion; accessible (labelled groups,
 * aria-live status, real buttons, RTL, text-not-color).
 */
import { useMemo, useState, useEffect, useRef } from 'react'
import {
  DeterministicPreferenceElicitation,
  DEFAULT_QUESTION_CATALOG,
  TOPIC_INTEREST_LABELS_HE,
  type ElicitationContext,
} from '../../../api/ai/preference_elicitation'
import {
  initConversation,
  answerQuestion,
  confirmPending,
  rejectPending,
  removeCapturedPreference,
  refreshQuestion,
  type ConversationState,
} from '../../../api/ai/conversation_state'
import type { Preference, PreferenceProfile } from '../../../api/ai/preference_model'

function labelForPreference(p: Preference, dynamicLabels: Record<string, string> = {}): string {
  if (p.originalWording) return p.originalWording
  const q = DEFAULT_QUESTION_CATALOG.find((c) => c.id === p.id)
  const opt = q?.options?.find((o) => o.value === p.value)
  if (opt?.label_he) return opt.label_he
  // C5 — the priority question's options are built per request from the server's
  // impact contract, so the catalog holds no static list to look the captured
  // answer up in. Without this the summary would render the INTERNAL objective
  // id, which must never be a label.
  const dynamic = dynamicLabels[String(p.normalized)]
  if (dynamic) return dynamic
  // W2 — the topic question's options are built per request, so the catalog
  // carries no static list to look a captured answer up in. Without this the
  // summary would render the INTERNAL topic id, which must never be a label.
  const topic = TOPIC_INTEREST_LABELS_HE[String(p.normalized)]
  if (topic) return topic
  // An INDIFFERENT answer stores no option value at all, so nothing above can
  // match and the raw token ('indifferent') would surface. Name the SUBJECT
  // instead — the row already carries its own "(לא משנה)" marker.
  if (q?.subject_he) return q.subject_he
  return String(p.normalized)
}

export default function PreferenceConversation({
  onBuild,
  onProfileChange,
  elicitationContext,
  buildLabel = 'בנה תוכנית',
  buildDisabled = false,
  showBuild = true,
  showInitialQuestion = true,
}: {
  onBuild: (profile: PreferenceProfile) => void
  onProfileChange?: (profile: PreferenceProfile) => void
  buildLabel?: string
  buildDisabled?: boolean
  /** The unified Academic Agent owns the build action on the flagged path. */
  showBuild?: boolean
  /**
   * The unified agent starts with its own conversation. When false, the
   * deterministic preference helper keeps its typed state available for
   * callers but does not put a standalone question above the agent composer.
   */
  showInitialQuestion?: boolean
  /**
   * Impact-driven gating context. e.g. after a Generate whose candidates
   * converge, pass { irrelevantTopicIds: ['semester_balance'] } so the balance
   * question is not asked when it cannot change the selected plan.
   */
  elicitationContext?: ElicitationContext
}) {
  const elicit = useMemo(() => new DeterministicPreferenceElicitation(), [])
  const ctx: ElicitationContext = elicitationContext ?? {}
  const [state, setState] = useState<ConversationState>(() => initConversation(elicit, ctx))
  const [draft, setDraft] = useState('')

  useEffect(() => { onProfileChange?.(state.profile) }, [state.profile, onProfileChange])

  // Impact-driven relevance can change AFTER a question is already on screen —
  // e.g. the first Build reveals the balance alternatives converge, so
  // `semester_balance` becomes irrelevant. Re-select the current question when
  // the irrelevant-topics set changes so a now-pointless question is retracted
  // (and a newly-relevant one can surface) without waiting for the next answer.
  const irrelevantKey = (ctx.irrelevantTopicIds ?? []).join('|')
  // The grounded course-feature impact is the SAME class of signal: it only
  // becomes available after the first Build (it is computed from the retained
  // candidates), so without it in the key a now-relevant grounded question would
  // never surface — exactly the defect Preview acceptance caught.
  const g = ctx.groundedFeatureImpact
  const groundedKey = g
    ? `${g.feature}|${g.distinguishesCandidates}|${g.coverageSufficient}|${g.hasConflicts}`
    : ''
  // W2 — the topic impact is the SAME class of post-Build signal, and it also
  // changes WHICH options are offered, so the distinguishing set is part of the
  // key. Without it the topic question could never surface after the first
  // Build, and a later Build reporting convergence could never retract it.
  const t = ctx.topicInterestImpact
  const topicKey = t
    ? `${t.distinguishesCandidates}|${t.coverageSufficient}|${t.hasConflicts}|${t.distinguishingTopics.join(',')}`
    : ''
  // C5 — the priority impact is the same class of post-Build signal: it only
  // exists once candidates have been ranked, and both its eligibility and its
  // option list change between Builds.
  const pr = ctx.objectivePriorityImpact
  const priorityKey = pr ? `${pr.eligible}|${pr.options.map((o) => o.value).join(',')}` : ''
  useEffect(() => {
    setState((s) => refreshQuestion(s, elicit, ctx))
    // ctx is recreated each render; irrelevantKey/groundedKey/topicKey/priorityKey
    // are its stable serializations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [irrelevantKey, groundedKey, topicKey, priorityKey, elicit])

  /**
   * Labels for options the SERVER built for this request. Remembered across
   * responses so a captured answer never degrades into its internal id once the
   * proposal that produced the option list is gone.
   */
  const dynamicLabels = useRef<Record<string, string>>({})
  for (const o of pr?.options ?? []) dynamicLabels.current[o.value] = o.labelHe
  const labelOf = (p: Preference) => labelForPreference(p, dynamicLabels.current)

  const q = state.currentQuestion
  const captured = state.profile.preferences

  // Build only hands the typed profile to the owner (the journey). It does NOT
  // transition to 'planning' — generation ownership + markPlanning belong to the
  // real Generate action, and the conversation stays editable meanwhile.
  const build = () => { onBuild(state.profile) }

  return (
    <div className="flex flex-col gap-4 text-sm" dir="rtl">
      {/* live status for screen readers */}
      <p role="status" aria-live="polite" className="sr-only">
        {state.status === 'ready_to_plan' ? 'יש מספיק מידע כדי לבנות תוכנית' : ''}
      </p>

      {showInitialQuestion && state.status === 'question_pending' && q && (
        <fieldset role="group" aria-label={`שאלה: ${q.question_he}`} className="rounded-xl border border-[var(--border)] p-4">
          <legend className="px-1 font-medium text-[var(--text)]">{q.question_he}</legend>
          {q.rationale_he && <p className="mb-2 text-xs text-[var(--text-muted)]">{q.rationale_he}</p>}
          <div className="flex flex-wrap gap-2">
            {q.options?.map((o) => (
              <button key={o.value} type="button"
                onClick={() => setState((s) => answerQuestion(s, { kind: 'choice', value: o.value }, elicit, ctx))}
                className="rounded-full border border-[var(--border)] px-4 py-1.5 hover:bg-[var(--surface-hover,rgba(0,0,0,0.05))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]">
                {o.label_he}
              </button>
            ))}
            {q.allowIndifferent && (
              <button type="button"
                onClick={() => setState((s) => answerQuestion(s, { kind: 'indifferent' }, elicit, ctx))}
                className="rounded-full border border-dashed border-[var(--border)] px-4 py-1.5 text-[var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]">
                לא משנה לי
              </button>
            )}
          </div>
          {q.allowFreeText && (
            <div className="mt-3 flex gap-2">
              <input name="preference-free-answer" aria-label="תשובה חופשית" value={draft} onChange={(e) => setDraft(e.target.value)}
                placeholder="אפשר גם לכתוב בחופשיות…"
                className="flex-1 rounded-lg border border-[var(--border)] bg-transparent px-3 py-1.5 text-[var(--text)]" />
              <button type="button" disabled={!draft.trim()}
                onClick={() => { setState((s) => answerQuestion(s, { kind: 'free_text', text: draft.trim() }, elicit, ctx)); setDraft('') }}
                className="rounded-lg bg-[var(--purple-strong)] px-3 py-1.5 text-white disabled:opacity-50">
                שליחת תשובה
              </button>
            </div>
          )}
        </fieldset>
      )}

      {state.status === 'confirmation_required' && state.pendingInterpretation && (
        <div role="group" aria-label="אישור פירוש" className="rounded-xl border border-amber-400/60 p-4">
          <p className="text-[var(--text)]">
            כתבת: “{state.pendingInterpretation.originalWording}”. האם הבנתי נכון שזו העדפה שכדאי להתחשב בה?
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">זהו פירוש שלי — הוא ישפיע על התכנון רק אחרי שתאשר/י.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setState((s) => confirmPending(s, elicit, ctx))}
              className="rounded-full bg-emerald-600 px-4 py-1.5 text-white">כן, זו הכוונה</button>
            <button type="button" onClick={() => setState((s) => rejectPending(s, elicit, ctx))}
              className="rounded-full border border-[var(--border)] px-4 py-1.5">לא, נסח מחדש</button>
          </div>
        </div>
      )}

      {state.status === 'preference_conflict' && (
        <div role="alert" className="rounded-xl border border-red-400/60 p-4 text-[var(--text)]">
          <p className="font-medium">יש העדפות שנראות סותרות — אפשר להסיר אחת מהן כדי להמשיך:</p>
          <ul className="mt-1 text-xs text-[var(--text-muted)]">
            {state.conflicts.map((c) => <li key={c.affects}>{c.detail_he}</li>)}
          </ul>
        </div>
      )}

      {state.status === 'ready_to_plan' && (
        <p className="text-[var(--text-muted)]">יש מספיק מידע כדי לבנות תוכנית טובה. אפשר לבנות עכשיו או להוסיף העדפות.</p>
      )}

      {/* "מה הבנתי ממך" summary — captured preferences, editable */}
      {captured.length > 0 && (
        <section role="region" aria-label="מה הבנתי ממך" className="rounded-xl border border-[var(--border)] p-4">
          <h3 className="mb-2 font-medium text-[var(--text)]">מה הבנתי ממך</h3>
          <ul className="flex flex-col gap-1.5">
            {captured.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span className="text-[var(--text)]">
                  {labelOf(p)}
                  {p.classification === 'uncertain' && <span className="mr-1 text-xs text-amber-600"> (טעון אישור)</span>}
                  {p.classification === 'indifferent' && <span className="mr-1 text-xs text-[var(--text-muted)]"> (לא משנה)</span>}
                  {p.source === 'confirmed_interpretation' && <span className="mr-1 text-xs text-[var(--text-muted)]"> (פירוש שאושר)</span>}
                </span>
                <button type="button" aria-label={`הסר ${labelOf(p)}`}
                  onClick={() => setState((s) => removeCapturedPreference(s, p.id, elicit, ctx))}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">הסר</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {showBuild && (
        <div>
          <button type="button" onClick={build} disabled={buildDisabled}
            className="rounded-full bg-[#7c3aed] px-6 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {buildLabel}
          </button>
        </div>
      )}
    </div>
  )
}
