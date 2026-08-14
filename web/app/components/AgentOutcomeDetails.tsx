'use client'

/**
 * Slice 9 — compact, accessible progressive disclosure for the structured agent
 * outcomes (clarification_required / validation_failed / blocked / error).
 *
 * Presentational only: it renders the already-structured, already-safe data from
 * the response (no stack traces, no internal diagnostics, no secrets). The
 * concise status badge is rendered by the caller and preserved; this adds an
 * opt-in "פרטים" disclosure. Accessibility: a real <button> toggle with
 * aria-expanded/aria-controls, a labelled region, text labels for every state
 * (never color-only), full RTL via the page.
 */
import { useId, useState } from 'react'
import type { AgentClarificationItemVM, AgentValidationFindingVM } from '../../../shared/planner/model'

export type AgentOutcome =
  | 'proposal'
  | 'clarification_required'
  | 'validation_failed'
  // Slice 18A — no legal plan satisfying the user's HARD constraints exists.
  // Disclosed through the same blocking-errors list as 'blocked' (the reasons
  // are already surfaced there); the full candidate/reason UI is a later slice.
  | 'infeasible'
  | 'blocked'
  | 'error'

const ANSWER_TYPE_HE: Record<string, string> = {
  course_ids: 'רשימת קורסים',
  course_id_list: 'רשימת קורסים',
  number: 'מספר',
  text: 'טקסט חופשי',
  single_choice: 'בחירה אחת',
  multi_choice: 'בחירה מרובה',
  boolean: 'כן / לא',
}

export default function AgentOutcomeDetails({
  outcome,
  clarificationItems = [],
  validationFindings = [],
  errors = [],
}: {
  outcome?: AgentOutcome
  clarificationItems?: AgentClarificationItemVM[]
  validationFindings?: AgentValidationFindingVM[]
  errors?: string[]
}) {
  const [open, setOpen] = useState(false)
  const regionId = useId()

  const hasClarification = outcome === 'clarification_required' && clarificationItems.length > 0
  const hasValidation = outcome === 'validation_failed' && validationFindings.length > 0
  const hasBlocked = (outcome === 'blocked' || outcome === 'infeasible') && errors.length > 0
  const isError = outcome === 'error'
  if (!hasClarification && !hasValidation && !hasBlocked && !isError) return null

  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={regionId}
        className="rounded-md px-2 py-1 text-[var(--purple-strong)] underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]"
      >
        {open ? 'הסתר פרטים' : 'הצג פרטים'}
      </button>

      {open && (
        <div id={regionId} role="region" aria-label="פרטי מצב ההצעה" className="mt-2 flex flex-col gap-3">
          {hasClarification && clarificationItems.map((item) => (
            <div key={item.reasonCode} className="rounded-lg border border-[var(--border)] p-3">
              <p className="font-medium text-[var(--text)]">{item.messageHe}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {item.answerable
                  ? `ניתן לענות${item.answerType ? ` · סוג תשובה: ${ANSWER_TYPE_HE[item.answerType] ?? item.answerType}` : ''}`
                  : 'דרושה הכרעה סמכותית — לא ניתן לפתור זאת כהעדפת סטודנט'}
              </p>
              {item.courseIds && item.courseIds.length > 0 && (
                <p className="mt-1 text-xs text-[var(--text-muted)]">קורסים מושפעים: <span dir="ltr">{item.courseIds.join(', ')}</span></p>
              )}
              {item.detail && <p className="mt-1 text-xs text-[var(--text-muted)]">{item.detail}</p>}
            </div>
          ))}

          {hasValidation && validationFindings.map((f) => (
            <div key={f.code + f.courseId} className="rounded-lg border border-amber-400/60 p-3">
              <p className="font-medium text-[var(--text)]">{f.messageHe}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                עובדות סותרות: {f.detail}
              </p>
              {f.provenance?.source && (
                <p className="mt-1 text-xs text-[var(--text-muted)]">מקור: <span dir="ltr">{f.provenance.source}</span></p>
              )}
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                לא ניתן להחיל את התוכנית עד שתתקבל הכרעה סמכותית לגבי הנתון.
              </p>
            </div>
          ))}

          {hasBlocked && (
            <ul aria-label="סיבות חסימה" className="flex flex-col gap-1 text-xs text-red-700 dark:text-red-300">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}

          {isError && (
            <p className="text-xs text-[var(--text-muted)]">
              אירעה שגיאה פנימית בעת יצירת ההצעה. אפשר לנסות לבנות מחדש. לא בוצע שינוי בתוכנית הנוכחית.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
