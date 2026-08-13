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
import { useMemo, useState, useEffect } from 'react'
import {
  DeterministicPreferenceElicitation,
  DEFAULT_QUESTION_CATALOG,
  type ElicitationContext,
} from '../../../api/ai/preference_elicitation'
import {
  initConversation,
  answerQuestion,
  confirmPending,
  rejectPending,
  removeCapturedPreference,
  type ConversationState,
} from '../../../api/ai/conversation_state'
import type { Preference, PreferenceProfile } from '../../../api/ai/preference_model'

function labelForPreference(p: Preference): string {
  if (p.originalWording) return p.originalWording
  const q = DEFAULT_QUESTION_CATALOG.find((c) => c.id === p.id)
  const opt = q?.options?.find((o) => o.value === p.value)
  return opt?.label_he ?? String(p.normalized)
}

export default function PreferenceConversation({
  onBuild,
  onProfileChange,
  elicitationContext,
}: {
  onBuild: (profile: PreferenceProfile) => void
  onProfileChange?: (profile: PreferenceProfile) => void
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

      {state.status === 'question_pending' && q && (
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
              <input aria-label="תשובה חופשית" value={draft} onChange={(e) => setDraft(e.target.value)}
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
                  {labelForPreference(p)}
                  {p.classification === 'uncertain' && <span className="mr-1 text-xs text-amber-600"> (טעון אישור)</span>}
                  {p.classification === 'indifferent' && <span className="mr-1 text-xs text-[var(--text-muted)]"> (לא משנה)</span>}
                  {p.source === 'confirmed_interpretation' && <span className="mr-1 text-xs text-[var(--text-muted)]"> (פירוש שאושר)</span>}
                </span>
                <button type="button" aria-label={`הסר ${labelForPreference(p)}`}
                  onClick={() => setState((s) => removeCapturedPreference(s, p.id, elicit, ctx))}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">הסר</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div>
        <button type="button" onClick={build}
          className="rounded-full bg-[var(--purple-strong)] px-6 py-2 text-sm font-semibold text-white">
          בנה תוכנית
        </button>
      </div>
    </div>
  )
}
