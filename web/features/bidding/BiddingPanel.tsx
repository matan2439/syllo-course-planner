'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  applyBiddingAllocation, exportBiddingDraft, getBiddingContextHistory, proposeBiddingAllocation,
  simulateBiddingTransfers, validateBiddingDraft,
  type BiddingAllocationProposal, type BiddingDraft, type BiddingEntry,
  type BiddingHistory, type BiddingOutcome, type BiddingSimulation,
} from '../../../shared/planner/bidding'
import { useLocale } from '../locale/LocaleProvider'
import type { BiddingRoundSnapshot, BiddingRoundTransition } from '../../../shared/planner/bidding-rounds'
import BiddingRoundTools from './BiddingRoundTools'

export interface BiddingPanelProps {
  programId: string
  courseOptions: Array<{ id: string; name: string }>
  draft: BiddingDraft
  onChange: (draft: BiddingDraft) => void
  loadHistory: (draft: BiddingDraft) => Promise<BiddingHistory>
  onShare: (draft: BiddingDraft, share: boolean) => Promise<void>
  roundSnapshots?: readonly BiddingRoundSnapshot[]
  onRoundSnapshot?: (snapshot: BiddingRoundSnapshot) => void
  onRoundTransition?: (transition: BiddingRoundTransition) => void
}

const CONTROL = 'min-w-0 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-sm text-[var(--text)]'
const BUTTON = 'rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY = `${BUTTON} bg-[var(--purple-strong)] text-white hover:bg-[var(--purple)]`
const BOX = 'rounded-xl border border-[var(--border)] p-3'
const EMPTY_HISTORY: BiddingHistory = { summaries: [], generatedAt: '', minimumContributors: 5 }

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-1 text-xs font-medium">{label}{children}</label>
}

function newId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID() : `bid-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Controlled draft editor. The owner must remount this panel when the authenticated owner changes. */
export function BiddingPanel({ programId, courseOptions, draft, onChange, loadHistory, onShare, roundSnapshots = [], onRoundSnapshot, onRoundTransition }: BiddingPanelProps) {
  const { t, locale, dir } = useLocale()
  const context = `${programId}:${draft.academicYear}:${draft.semester}:${draft.round}`
  const contextRef = useRef(context)
  contextRef.current = context
  const requestGeneration = useRef(0)
  const [historySnapshot, setHistorySnapshot] = useState<{ context: string; data: BiddingHistory } | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [proposal, setProposal] = useState<BiddingAllocationProposal | null>(null)
  const [simulation, setSimulation] = useState<{ basedOn: string; result: BiddingSimulation } | null>(null)
  const [assumptions, setAssumptions] = useState<Record<string, BiddingOutcome>>({})
  const [consent, setConsent] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [addCourseId, setAddCourseId] = useState('')
  const [addGroup, setAddGroup] = useState('')
  const [copyText, setCopyText] = useState<string | null>(null)
  const fingerprint = JSON.stringify(draft)
  const validation = validateBiddingDraft(draft)
  const history = historySnapshot?.context === context ? historySnapshot.data : EMPTY_HISTORY
  const contextHistory = getBiddingContextHistory(draft, history)
  const visibleProposal = proposal?.basedOn === fingerprint ? proposal : null
  const visibleSimulation = simulation?.basedOn === fingerprint ? simulation.result : null
  const hasResults = draft.entries.some((e) => e.outcome !== 'pending')

  useEffect(() => {
    requestGeneration.current++
    setConsent(false)
    setShareBusy(false)
    setHistoryBusy(false)
    setHistorySnapshot(null)
    setProposal(null)
    setSimulation(null)
    setAssumptions({})
    setMessage('')
    setError('')
    setCopyText(null)
    return () => { requestGeneration.current++ }
  }, [context])

  const update = (patch: Partial<BiddingDraft>) => {
    setError('')
    setMessage('')
    setCopyText(null)
    onChange({ ...draft, ...patch })
  }
  const rule = (patch: Partial<BiddingDraft>) => update({ ...patch, rulesConfirmed: false })
  const changeEntry = (id: string, patch: Partial<BiddingEntry>) => update({ entries: draft.entries.map((e) => e.id === id ? { ...e, ...patch } : e) })
  const normalize = (entries: BiddingEntry[]) => entries.map((e, index) => ({ ...e, priority: index + 1 }))
  const sorted = [...draft.entries].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
  const move = (id: string, offset: number) => {
    const entries = [...sorted]
    const from = entries.findIndex((e) => e.id === id)
    const to = from + offset
    if (from < 0 || to < 0 || to >= entries.length) return
    ;[entries[from], entries[to]] = [entries[to], entries[from]]
    update({ entries: normalize(entries) })
  }
  const remove = (id: string) => update({ entries: normalize(sorted.filter((e) => e.id !== id)
    .map((e) => e.transferTo === id ? { ...e, transferTo: null } : e)) })

  const addCourse = () => {
    const course = courseOptions.find((c) => c.id === addCourseId)
    if (!course || !addGroup.trim() || draft.entries.length >= 200) return
    update({ entries: [...sorted, { id: newId(), kind: 'course', courseId: course.id, label: course.name,
      group: addGroup.trim(), points: Math.max(1, draft.minimumBid), priority: sorted.length + 1, outcome: 'pending', members: [] }] })
    setAddGroup('')
  }
  const addPacket = () => {
    if (draft.entries.length >= 200) return
    update({ entries: [...sorted, { id: newId(), kind: 'bundle', label: `${t('מנה', 'Packet')} ${sorted.length + 1}`,
      group: '', points: Math.max(1, draft.minimumBid), priority: sorted.length + 1, outcome: 'pending', members: [] }] })
  }
  const load = async () => {
    if (historyBusy) return
    const generation = requestGeneration.current
    const requestedContext = context
    setHistoryBusy(true)
    setError('')
    try {
      const data = await loadHistory(draft)
      if (requestGeneration.current === generation && contextRef.current === requestedContext) setHistorySnapshot({ context: requestedContext, data })
    } catch (err) {
      if (requestGeneration.current === generation && contextRef.current === requestedContext) setError(err instanceof Error ? err.message : t('לא ניתן לטעון היסטוריה.', 'Could not load history.'))
    } finally {
      if (requestGeneration.current === generation && contextRef.current === requestedContext) setHistoryBusy(false)
    }
  }
  const share = async (enabled: boolean) => {
    if (shareBusy || (enabled && (!consent || !validation.valid || !hasResults))) return
    const generation = requestGeneration.current
    const requestedContext = context
    setShareBusy(true)
    setError('')
    setMessage('')
    try {
      await onShare(draft, enabled)
      if (requestGeneration.current !== generation || contextRef.current !== requestedContext) return
      setMessage(enabled ? t('התוצאות נמסרו לעיבוד מצטבר בהסכמתך.', 'Your consented results were sent for aggregation.')
        : t('כל הדיווחים המשותפים שלך לתוכנית הלימודים הזו הוסרו.', 'All your shared reports for this degree program were withdrawn.'))
      if (!enabled) setConsent(false)
      // Reload is explicit after withdrawal; cached summaries may contain the withdrawn reports.
      setHistorySnapshot(null)
      setProposal(null)
    } catch (err) {
      if (requestGeneration.current === generation && contextRef.current === requestedContext) setError(err instanceof Error ? err.message : t('לא ניתן לעדכן שיתוף.', 'Could not update sharing.'))
    } finally {
      if (requestGeneration.current === generation && contextRef.current === requestedContext) setShareBusy(false)
    }
  }
  const copy = async () => {
    if (!validation.valid) return
    const text = exportBiddingDraft(draft, locale)
    setCopyText(text)
    setError('')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setMessage(t('הטיוטה הועתקה. יש להזין ולבדוק באתר הרשמי.', 'Draft copied. Enter and review it on the official site.'))
    } catch {
      setMessage(t('אפשר לבחור ולהעתיק את הטקסט למטה.', 'Select and copy the text below.'))
    }
  }

  const outcomeOptions: Array<[BiddingOutcome, string]> = [
    ['pending', t('ממתין', 'Pending')], ['accepted', t('התקבלתי', 'Accepted')], ['rejected', t('נדחיתי', 'Rejected')],
    ['other_group', t('קיבלתי קבוצה אחרת', 'Other group')], ['canceled', t('ביטלתי', 'Canceled')],
  ]

  return <section dir={dir} aria-label={t('תכנון בידינג', 'Bidding preparation')} className="space-y-4 text-start text-[var(--text)]">

    {(onRoundSnapshot || onRoundTransition || roundSnapshots.length > 0) && <BiddingRoundTools draft={draft} snapshots={roundSnapshots} onChange={onChange} onSnapshot={onRoundSnapshot} onTransition={onRoundTransition} />}

    <fieldset className={`${BOX} space-y-3`}>
      <legend className="px-1 text-sm font-semibold">{t('תקציב וכללי המקצה', 'Budget and round rules')}</legend>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Field label={t('שנת רישום (שנת התחלה)', 'Academic year (start year)')}><input className={CONTROL} type="number" min={2000} max={2200} step={1} value={draft.academicYear} onChange={(e) => rule({ academicYear: Number(e.target.value) })} /></Field>
        <Field label={t('סמסטר', 'Semester')}><select className={CONTROL} value={draft.semester} onChange={(e) => rule({ semester: Number(e.target.value) as 1 | 2 })}><option value={1}>{t('א׳', '1')}</option><option value={2}>{t('ב׳', '2')}</option></select></Field>
        <Field label={t('מקצה', 'Round')}><input className={CONTROL} type="number" min={1} max={20} step={1} value={draft.round} onChange={(e) => rule({ round: Number(e.target.value) })} /></Field>
        <Field label={t('תקציב נקודות אישי', 'Personal points budget')}><input className={CONTROL} type="number" min={0} max={1_000_000_000} step={1} value={draft.budget} onChange={(e) => rule({ budget: Number(e.target.value) })} /></Field>
        <Field label={t('מינימום לבחירה (מלבד חלופה באפס)', 'Minimum bid (except zero fallback)')}><input className={CONTROL} type="number" min={0} max={1_000_000_000} step={1} value={draft.minimumBid} onChange={(e) => rule({ minimumBid: Number(e.target.value) })} /></Field>
        <Field label={t('העברת נקודות', 'Point transfers')}><select className={CONTROL} value={draft.transferMode} onChange={(e) => rule({ transferMode: e.target.value as BiddingDraft['transferMode'] })}><option value="automatic">{t('לפי העדיפות הבאה', 'Next priority')}</option><option value="manual">{t('ליעד שאני בוחר', 'Designated target')}</option></select></Field>
      </div>
      <Field label={t('מקור ותאריך אימות הכללים (אופציונלי)', 'Rules source and verification date (optional)')}><input className={CONTROL} type="text" maxLength={1000} value={draft.rulesSource} onChange={(e) => rule({ rulesSource: e.target.value })} placeholder={t('מכתב הפקולטה, שנתון או כתובת מקור', 'Faculty letter, handbook or source URL')} /></Field>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={draft.rulesConfirmed} onChange={(e) => update({ rulesConfirmed: e.target.checked })} />{t('בדקתי את התקציב, המינימום וכללי ההעברה למקצה הזה מול המקור הרשמי.', 'I checked this round’s budget, minimum bid and transfer rules against the official source.')}</label>
    </fieldset>

    <p className={`rounded-lg p-3 text-sm font-semibold ${validation.remaining < 0 ? 'bg-red-500/10 text-red-600' : 'bg-[var(--surface)]'}`} aria-live="polite">{t(`הקצאה התחלתית: ${validation.allocated} / ${draft.budget} · יתרה: ${validation.remaining}`, `Initial allocation: ${validation.allocated} / ${draft.budget} · Remaining: ${validation.remaining}`)}</p>
    {validation.issues.length > 0 && <div role="alert" className="text-sm text-amber-700 dark:text-amber-300"><ul className="list-inside list-disc space-y-1">{validation.issues.map((issue, index) => <li key={`${issue.code}-${issue.entryId}-${index}`}>{issue.entryId && <span>{draft.entries.find((e) => e.id === issue.entryId)?.label}: </span>}{t(issue.messageHe, issue.messageEn)}</li>)}</ul></div>}

    <div className={`${BOX} space-y-3`}>
      <h3 className="font-semibold">{t('בחירות וקבוצות לפי סדר עדיפות', 'Choices and groups in priority order')}</h3>
      <p className="text-xs text-[var(--text-muted)]">{t('ניקוד 0 מסמן חלופה. מנות חלופיות מדורגות באותה רשימה; שמות הקורסים נשמרים כפי שפורסמו.', 'Zero points marks a fallback. Alternative packets share this priority list; course names retain their published language.')}</p>
      <div className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
        <Field label={t('קורס להוספה', 'Course to add')}><select className={CONTROL} value={addCourseId} onChange={(e) => setAddCourseId(e.target.value)}><option value="">{t('בחירת קורס', 'Select a course')}</option>{courseOptions.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.id}</option>)}</select></Field>
        <Field label={t('קבוצה להוספה', 'Group to add')}><input className={CONTROL} maxLength={100} value={addGroup} onChange={(e) => setAddGroup(e.target.value)} /></Field>
        <button type="button" className={BUTTON} disabled={!addCourseId || !addGroup.trim() || draft.entries.length >= 200} onClick={addCourse}>{t('הוספת קורס', 'Add course')}</button>
      </div>
      <button type="button" className={BUTTON} disabled={draft.entries.length >= 200} onClick={addPacket}>{t('הוספת מנה', 'Add packet')}</button>
      {sorted.length === 0 && <p className="text-sm text-[var(--text-muted)]">{t('הוסיפו קורס או מנה כדי להתחיל.', 'Add a course or packet to begin.')}</p>}
      {sorted.map((entry, index) => <EntryEditor key={entry.id} entry={entry} courseOptions={courseOptions} allEntries={sorted} transferMode={draft.transferMode}
        canMoveUp={index > 0} canMoveDown={index < sorted.length - 1} onChange={(patch) => changeEntry(entry.id, patch)}
        onMove={(offset) => move(entry.id, offset)} onDelete={() => remove(entry.id)} outcomeOptions={outcomeOptions} />)}
    </div>

    <div className={`${BOX} space-y-3`}>
      <h3 className="font-semibold">{t('היסטוריה והצעת הקצאה', 'History and allocation proposal')}</h3>
      <p className="text-xs text-[var(--text-muted)]">{t('רק תוצאות משנים קודמות ובהסכמה, באותו קורס/קבוצה, סמסטר ומקצה, עם לפחות 5 משתתפים שונים. קבלה בעבר אינה מבטיחה קבלה כעת.', 'Only consented earlier-year results for the same course/group, semester and round, with at least 5 distinct contributors. Earlier acceptance does not guarantee acceptance now.')}</p>
      <p className="text-xs text-[var(--text-muted)]">{t('ניקודי קבלה מוצגים רק עם לפחות 5 משתתפים שהתקבלו. ניקוד חסר אינו אפס.', 'Accepted scores appear only with at least 5 accepted contributors. A missing score is not zero.')}</p>
      <button type="button" className={BUTTON} disabled={historyBusy} onClick={() => void load()}>{historyBusy ? t('טוען…', 'Loading…') : t('טעינת סיכומים היסטוריים', 'Load historical summaries')}</button>
      {historySnapshot?.context === context && <div aria-live="polite" className="space-y-2 text-sm">
        {contextHistory.length === 0 ? <p>{t('אין תוצאות קודמות במצטבר מספיק לבחירות האלה. אפשר להיעזר בסדר העדיפויות ולהריץ תרחישים ידניים.', 'No sufficiently aggregated earlier results for these choices. Use the priority heuristic and manual scenarios.')}</p>
          : contextHistory.map(({ entryId, summary }) => <p key={`${entryId}-${summary.academicYear}`}>
            <strong>{draft.entries.find((e) => e.id === entryId)?.label}</strong> · {t('קבוצה/מנה', 'Group/packet')} {summary.group} · {summary.academicYear}–{summary.academicYear + 1} · {t('סמסטר', 'Semester')} {summary.semester} · {t('מקצה', 'Round')} {summary.round}<br />
            {t('משתתפים', 'Contributors')}: {summary.contributors} · {t('קבלות', 'Accepted')}: {summary.acceptedCount} · {t('דחיות עקב ניקוד', 'Point rejections')}: {summary.rejectedCount} · {t('חציון ניקוד בקבלות', 'Median accepted score')}: {summary.acceptedBidMedian ?? '—'} · {t('אחוזון 75 בקבלות', '75th percentile accepted score')}: {summary.acceptedBidP75 ?? '—'}<br />
            <span className="text-xs text-[var(--text-muted)]">{t('מקור', 'Source')}: {summary.source}</span>
          </p>)}
        {history.generatedAt && <p className="text-xs text-[var(--text-muted)]">{t('הסיכום הופק', 'Summary generated')}: <bdi>{history.generatedAt}</bdi></p>}
      </div>}
      <div><button type="button" className={PRIMARY} disabled={draft.entries.length === 0} onClick={() => { setProposal(proposeBiddingAllocation(draft, history)); setError('') }}>{t('הצעת הקצאה', 'Suggest allocation')}</button></div>
      {visibleProposal && <div className="space-y-2 text-sm" aria-live="polite">
        <p>{visibleProposal.method === 'priority' ? t('כלל אצבע לפי עדיפות — אין מספיק היסטוריה תואמת.', 'Priority heuristic — insufficient matching history.') : t('כלל אצבע לפי עדיפות וניקודי קבלה היסטוריים מצטברים.', 'Heuristic using priority and aggregated historical accepted scores.')}</p>
        <p className="text-xs text-[var(--text-muted)]">{t('זו אינה הסתברות לקבלה.', 'This is not an acceptance probability.')}</p>
        {visibleProposal.feasible ? <><ul className="space-y-1">{visibleProposal.allocations.map((a) => <li key={a.entryId}>{draft.entries.find((e) => e.id === a.entryId)?.label}: {a.points} {t('נקודות', 'points')}</li>)}</ul><button type="button" className={PRIMARY} onClick={() => {
          try { update(applyBiddingAllocation(draft, visibleProposal)); setProposal(null) }
          catch { setError(t('הטיוטה השתנתה או שההצעה אינה תקינה. יש ליצור הצעה חדשה.', 'The draft changed or the proposal is invalid. Generate a new proposal.')) }
        }}>{t('החלת ההקצאה', 'Apply allocation')}</button></> : <p role="alert">{visibleProposal.reason === 'insufficient_budget' ? t('התקציב אינו מספיק למינימום של הבחירות הפעילות. עדכנו את התקציב או סמנו חלופה באפס.', 'The budget cannot cover the active minimum bids. Change the budget or mark a zero fallback.')
          : visibleProposal.reason === 'no_active_entries' ? t('אין בחירות ממתינות עם ניקוד חיובי להקצאה.', 'No pending choices with positive bids to allocate.')
            : t('תקנו את הבחירות ואשרו את כללי המקצה לפני יצירת הצעה.', 'Fix the entries and confirm the round rules before generating a proposal.')}</p>}
      </div>}
    </div>

    <div className={`${BOX} space-y-3`}>
      <h3 className="font-semibold">{t('תרחיש העברות: מה יקרה אם אדחה?', 'What-if transfers: what if I am rejected?')}</h3>
      <p className="text-xs text-[var(--text-muted)]">{t('תרחיש בלבד: אינו משנה תוצאות ואינו מנבא ביקוש.', 'Scenario only: it does not change results or predict demand.')}</p>
      <div className="flex flex-wrap gap-3">{sorted.map((e) => <label key={e.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={assumptions[e.id] === 'rejected'} onChange={(event) => {
        setAssumptions((current) => { const next = { ...current }; if (event.target.checked) next[e.id] = 'rejected'; else delete next[e.id]; return next }); setSimulation(null)
      }} />{t(`להניח דחייה: ${e.label}`, `Assume rejection: ${e.label}`)}</label>)}</div>
      <button type="button" className={BUTTON} disabled={!validation.valid || !draft.entries.length} onClick={() => setSimulation({ basedOn: fingerprint, result: simulateBiddingTransfers(draft, assumptions) })}>{t('הרצת תרחיש העברות', 'Run what-if transfers')}</button>
      {visibleSimulation && <div data-testid="bidding-simulation" className="space-y-1 text-sm" aria-live="polite">
        <p className="font-semibold">{t('ניקוד אפשרי בתרחיש בלבד', 'Possible points in this scenario only')}</p>
        {visibleSimulation.entries.map((e) => <p key={e.id}>{draft.entries.find((entry) => entry.id === e.id)?.label}: {e.effectivePoints} · {t('התחלתי', 'Initial')} {e.initialPoints} · {t('התקבל בהעברה', 'Received')} {e.receivedPoints}</p>)}
        {visibleSimulation.transfers.map((transfer, index) => <p key={index} className="text-xs">{draft.entries.find((e) => e.id === transfer.from)?.label} → {draft.entries.find((e) => e.id === transfer.to)?.label}: {transfer.points}</p>)}
        <p>{t('נקודות ללא יעד', 'Unallocated points')}: {visibleSimulation.unallocated} · {t('תקציב שלא הוקצה', 'Unused budget')}: {visibleSimulation.remainingBudget}</p>
      </div>}
    </div>

    <div className={`${BOX} space-y-3`}>
      <h3 className="font-semibold">{t('ייצוא ושיתוף בהסכמה', 'Export and consented sharing')}</h3>
      <button type="button" className={BUTTON} disabled={!validation.valid || !draft.entries.length} onClick={() => void copy()}>{t('העתקת טיוטה להזנה ידנית', 'Copy manual-entry draft')}</button>
      {copyText !== null && <Field label={t('טקסט להזנה ידנית', 'Manual-entry text')}><textarea className={`${CONTROL} min-h-40`} readOnly value={copyText} onFocus={(e) => e.currentTarget.select()} /></Field>}
      <p className="text-xs text-[var(--text-muted)]">{t('נדרשת התחברות לשיתוף. רק תוצאות שהושלמו משמשות לסיכומים מצטברים; דחייה מקבוצה סגורה או ביטול אינם ראיה לסף ניקוד. אין חשיפה של דיווח אישי או זהות. ניתן לבטל שיתוף בכל עת.', 'Sharing requires sign-in. Completed results supply aggregate summaries; closed groups and cancellations do not indicate score thresholds. Individual reports and identities are not exposed. You can withdraw at any time.')}</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />{t('אני מסכים/ה לתרום את הניקוד והתוצאות שהושלמו לסיכומים מצטברים לצורך שיפור ההמלצות.', 'I consent to contribute my points and completed results to aggregate summaries that improve recommendations.')}</label>
      <div className="flex flex-wrap gap-2"><button type="button" className={PRIMARY} disabled={!consent || !validation.valid || !hasResults || shareBusy} onClick={() => void share(true)}>{t('שיתוף תוצאות שהושלמו', 'Share completed results')}</button><button type="button" className={BUTTON} disabled={shareBusy} onClick={() => void share(false)}>{t('ביטול שיתוף התוצאות', 'Withdraw shared results')}</button></div>
    </div>
    {message && <p role="status" className="text-sm">{message}</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </section>
}

function EntryEditor({ entry, courseOptions, allEntries, transferMode, canMoveUp, canMoveDown, onChange, onMove, onDelete, outcomeOptions }: {
  entry: BiddingEntry; courseOptions: BiddingPanelProps['courseOptions']; allEntries: BiddingEntry[]
  transferMode: BiddingDraft['transferMode']; canMoveUp: boolean; canMoveDown: boolean
  onChange: (patch: Partial<BiddingEntry>) => void; onMove: (offset: number) => void; onDelete: () => void
  outcomeOptions: Array<[BiddingOutcome, string]>
}) {
  const { t } = useLocale()
  const [memberCourse, setMemberCourse] = useState('')
  const [memberGroup, setMemberGroup] = useState('')
  const knownCourse = courseOptions.some((course) => course.id === entry.courseId)
  return <fieldset className={`${BOX} space-y-3`}>
    <legend className="px-1 text-sm font-semibold">{entry.priority}. {entry.label}</legend>
    <div className="flex flex-wrap items-center gap-2">
      <span className="me-auto text-xs text-[var(--text-muted)]">{entry.kind === 'bundle' ? t('מנה חלופית', 'Alternative packet') : t('קורס וקבוצה', 'Course and group')}</span>
      <button type="button" className={BUTTON} aria-label={t(`העלאת עדיפות ${entry.label}`, `Move up ${entry.label}`)} disabled={!canMoveUp} onClick={() => onMove(-1)}>↑</button>
      <button type="button" className={BUTTON} aria-label={t(`הורדת עדיפות ${entry.label}`, `Move down ${entry.label}`)} disabled={!canMoveDown} onClick={() => onMove(1)}>↓</button>
      <button type="button" className={BUTTON} aria-label={t(`מחיקת ${entry.label}`, `Delete ${entry.label}`)} onClick={onDelete}>{t('מחיקה', 'Delete')}</button>
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label={t('שם הבחירה', 'Entry name')}><input className={CONTROL} maxLength={200} value={entry.label} onChange={(e) => onChange({ label: e.target.value })} /></Field>
      {entry.kind === 'course' && <Field label={t('קורס', 'Course')}><select className={CONTROL} value={entry.courseId ?? ''} onChange={(e) => onChange({ courseId: e.target.value || undefined, label: courseOptions.find((c) => c.id === e.target.value)?.name ?? entry.label })}><option value="">{t('בחירת קורס', 'Select a course')}</option>{!knownCourse && entry.courseId && <option value={entry.courseId}>{entry.label} · {entry.courseId}</option>}{courseOptions.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.id}</option>)}</select></Field>}
      <Field label={t('קבוצה/מזהה מנה', 'Group/packet identifier')}><input className={CONTROL} maxLength={100} value={entry.group} onChange={(e) => onChange({ group: e.target.value })} /></Field>
      <Field label={t('ניקוד התחלתי', 'Initial points')}><input className={CONTROL} type="number" min={0} max={1_000_000_000} step={1} value={entry.points} onChange={(e) => onChange({ points: Number(e.target.value) })} /></Field>
      {transferMode === 'manual' && <Field label={t('יעד העברה בדחייה', 'Transfer target on rejection')}><select className={CONTROL} value={entry.transferTo ?? ''} onChange={(e) => onChange({ transferTo: e.target.value || null })}><option value="">{t('ללא יעד', 'No target')}</option>{allEntries.filter((e) => e.id !== entry.id).map((e) => <option key={e.id} value={e.id}>{e.priority}. {e.label}</option>)}</select></Field>}
      <Field label={t('תוצאה בדיווח הסטודנט', 'Student-reported result')}><select className={CONTROL} value={entry.outcome} onChange={(e) => onChange({ outcome: e.target.value as BiddingOutcome })}>{outcomeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <Field label={t('ניקוד סופי מדווח (אופציונלי)', 'Reported final points (optional)')}><input className={CONTROL} type="number" min={0} max={1_000_000_000} step={1} value={entry.effectivePoints ?? ''} onChange={(e) => onChange({ effectivePoints: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
      {entry.outcome === 'rejected' && <Field label={t('סיבת דחייה ידועה', 'Known rejection reason')}><select className={CONTROL} value={entry.rejectionReason ?? ''} onChange={(e) => onChange({ rejectionReason: e.target.value || undefined })}>
        <option value="">{t('לא ידועה', 'Unknown')}</option><option value="points">{t('ניקוד', 'Points')}</option><option value="closed_group">{t('קבוצה סגורה', 'Closed group')}</option><option value="ineligible">{t('אי עמידה בתנאי רישום', 'Ineligible')}</option><option value="canceled">{t('הקורס בוטל', 'Course canceled')}</option><option value="other_group">{t('שיבוץ לקבוצה אחרת', 'Other group')}</option><option value="other">{t('אחר', 'Other')}</option>
        {entry.rejectionReason && !['points', 'closed_group', 'ineligible', 'canceled', 'other_group', 'other'].includes(entry.rejectionReason) && <option value={entry.rejectionReason}>{entry.rejectionReason}</option>}
      </select></Field>}
    </div>
    <p className="text-xs text-[var(--text-muted)]">{t('ניקוד סופי ממולא רק כשידוע מהתוצאה בפועל, כולל העברות. תרחיש בדיקה אינו ממלא אותו.', 'Enter final points only when known from the actual result, including transfers. A what-if does not fill this field.')}</p>
    {entry.kind === 'bundle' && <div className="space-y-2">
      <p className="text-sm font-medium">{t('קורסים וקבוצות במנה', 'Courses and groups in the packet')}</p>
      {entry.members.map((member, index) => <div key={`${member.courseId}-${index}`} className="flex items-center gap-2 text-sm"><span className="me-auto">{courseOptions.find((c) => c.id === member.courseId)?.name ?? member.courseId} · <bdi>{member.courseId} / {member.group || '—'}</bdi></span><button type="button" className={BUTTON} aria-label={t(`הסרת ${member.courseId} מהמנה`, `Remove ${member.courseId} from packet`)} onClick={() => onChange({ members: entry.members.filter((_, i) => i !== index) })}>{t('הסרה', 'Remove')}</button></div>)}
      <div className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
        <Field label={t('קורס במנה', 'Packet course')}><select className={CONTROL} value={memberCourse} onChange={(e) => setMemberCourse(e.target.value)}><option value="">{t('בחירת קורס', 'Select a course')}</option>{courseOptions.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.id}</option>)}</select></Field>
        <Field label={t('קבוצת קורס במנה', 'Packet course group')}><input className={CONTROL} maxLength={100} value={memberGroup} onChange={(e) => setMemberGroup(e.target.value)} /></Field>
        <button type="button" className={BUTTON} disabled={!memberCourse || !memberGroup.trim() || entry.members.length >= 50} onClick={() => { onChange({ members: [...entry.members, { courseId: memberCourse, group: memberGroup.trim() }] }); setMemberCourse(''); setMemberGroup('') }}>{t('הוספת קורס למנה', 'Add packet member')}</button>
      </div>
    </div>}
  </fieldset>
}

export default BiddingPanel
