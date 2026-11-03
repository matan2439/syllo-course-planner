'use client'
import { useState } from 'react'
import { biddingDraftSchema, type BiddingDraft, type BiddingEntry, type BiddingOutcome } from '../../../shared/planner/bidding'
import { archiveBiddingRound, prepareNextBiddingRound, type BiddingRoundSnapshot, type BiddingRoundTransition } from '../../../shared/planner/bidding-rounds'
import { uuidv4 } from '../../lib/ai-session-token'
import { useLocale } from '../locale/LocaleProvider'

const BUTTON = 'rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs hover:border-[var(--purple)] disabled:opacity-50'
export default function BiddingRoundTools({ draft, snapshots, onChange, onSnapshot, onTransition }: {
  draft: BiddingDraft; snapshots: readonly BiddingRoundSnapshot[]; onChange: (draft: BiddingDraft) => void
  onSnapshot?: (snapshot: BiddingRoundSnapshot) => void
  onTransition?: (transition: BiddingRoundTransition) => void
}) {
  const { t, locale } = useLocale()
  const [preparing, setPreparing] = useState<string | null>(null)
  const [pendingAccepted, setPendingAccepted] = useState(false)
  const fingerprint = JSON.stringify(draft)
  const full = snapshots.length >= 20
  const valid = biddingDraftSchema.safeParse(draft).success
  const hasPending = draft.entries.some((entry) => entry.outcome === 'pending')
  const latestRounds = new Map<number, BiddingRoundSnapshot>()
  snapshots.filter((snapshot) => snapshot.draft.academicYear === draft.academicYear && snapshot.draft.semester === draft.semester && snapshot.draft.round < draft.round)
    .forEach((snapshot) => { const previous = latestRounds.get(snapshot.draft.round); if (!previous || previous.savedAt <= snapshot.savedAt) latestRounds.set(snapshot.draft.round, snapshot) })
  const accepted = [...latestRounds.values()].flatMap((snapshot) => snapshot.draft.entries.filter((entry) => entry.outcome === 'accepted' || entry.outcome === 'other_group')
    .map((entry) => ({ entry, round: snapshot.draft.round, snapshotId: snapshot.id })))
  const outcome = (value: BiddingOutcome) => ({
    pending: t('ממתין — התוצאה עדיין לא ידועה', 'Pending — result not yet known'),
    accepted: t('התקבלתי (דיווח אישי)', 'Accepted (student-reported)'),
    rejected: t('נדחיתי', 'Rejected'), other_group: t('קבוצה אחרת (יש לבדוק איזו)', 'Other group (verify the received group)'), canceled: t('בוטל', 'Canceled'),
  })[value]
  const describe = (entry: BiddingEntry) => `${entry.label}${entry.outcome === 'other_group' ? '' : ` · ${entry.group}`}`
  const metadata = () => ({ id: `round_${uuidv4()}`, savedAt: Date.now() })
  return <div className="space-y-2 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      {onSnapshot && <button type="button" className={BUTTON} disabled={full || !valid} onClick={() => onSnapshot(archiveBiddingRound(draft, metadata()))}>{t('שמירת תמונת מקצה', 'Save round snapshot')}</button>}
      {onTransition && <button type="button" className={BUTTON} disabled={full || !valid || draft.round >= 20} onClick={() => { setPendingAccepted(false); setPreparing(fingerprint) }}>{t('הכנת המקצה הבא', 'Prepare next round')}</button>}
    </div>
    {full && <p className="text-[var(--text-muted)]">{t('ההיסטוריה מלאה (20 תמונות). המקצים הקיימים נשמרים.', 'History is full (20 snapshots). Existing rounds are preserved.')}</p>}
    {preparing === fingerprint && onTransition && <div className="space-y-2 rounded-md border border-[var(--border)] p-3">
      <p>{t('נדחים וממתינים עוברים לטיוטה הבאה באפס נקודות. קבלות, קבוצה אחרת וביטולים נשארים בהיסטוריה. יש להזין תקציב מחדש ולאשר את הכללים.', 'Rejected and pending choices move to the next draft at zero points. Acceptances, other groups and cancellations remain in history. Enter your budget again and confirm the rules.')}</p>
      {hasPending && <label className="flex items-start gap-2"><input type="checkbox" checked={pendingAccepted} onChange={(event) => setPendingAccepted(event.target.checked)} />{t('להעביר בחירות ממתינות כבחירות שטרם אושרו במקצה הבא', 'Keep pending choices as unconfirmed in the next round')}</label>}
      <div className="flex flex-wrap gap-2"><button type="button" className={BUTTON} disabled={full || !valid || draft.round >= 20 || (hasPending && !pendingAccepted)} onClick={() => { onTransition(prepareNextBiddingRound(draft, metadata())); setPreparing(null) }}>{t(`שמירה ומעבר למקצה ${draft.round + 1}`, `Archive and open round ${draft.round + 1}`)}</button>
        <button type="button" className={BUTTON} onClick={() => setPreparing(null)}>{t('ביטול', 'Cancel')}</button></div>
    </div>}
    {accepted.length > 0 && <section aria-label={t('קבלות מדווחות ממקצים קודמים', 'Reported acceptances from previous rounds')} className="space-y-1 rounded-md bg-[var(--surface)] p-3">
      <h3 className="font-medium">{t('קבלות מדווחות ממקצים קודמים', 'Reported acceptances from previous rounds')}</h3>
      <ul className="space-y-1">{accepted.map(({ entry, round, snapshotId }) => <li key={`${snapshotId}:${entry.id}`}>{describe(entry)} · {t('מקצה', 'Round')} {round} · {outcome(entry.outcome)}</li>)}</ul>
      <p className="text-[var(--text-muted)]">{t('דיווח אישי בלבד; יש לוודא את הרישום והקבוצה באתר הרשמי.', 'Student reports only; verify registration and the received group on the official site.')}</p>
    </section>}
    {snapshots.length > 0 && <details>
      <summary className="w-fit cursor-pointer py-1 text-[var(--text-muted)]">{t(`היסטוריית מקצים (${snapshots.length})`, `Round history (${snapshots.length})`)}</summary>
      <div className="mt-2 space-y-3">{[...snapshots].sort((a, b) => b.savedAt - a.savedAt).map((snapshot) => <article key={snapshot.id} className="space-y-2 rounded-md border border-[var(--border)] p-3">
        <p className="font-medium"><bdi>{snapshot.draft.academicYear}–{snapshot.draft.academicYear + 1}</bdi> · {t('סמסטר', 'Semester')} {snapshot.draft.semester} · {t('מקצה', 'Round')} {snapshot.draft.round}</p>
        <p className="text-[var(--text-muted)]">{new Date(snapshot.savedAt).toLocaleString(locale === 'he' ? 'he-IL' : 'en-GB')} · {t('תקציב', 'Budget')}: {snapshot.draft.budget}</p>
        <ul className="space-y-1">{[...snapshot.draft.entries].sort((a, b) => a.priority - b.priority).map((entry) => <li key={entry.id}>
          {entry.priority}. {entry.label} · {t('קבוצה/מנה מבוקשת', 'Requested group/packet')} {entry.group} · {t('התחלתי', 'Initial')} {entry.points} · {outcome(entry.outcome)}
          {entry.effectivePoints !== undefined && <> · {t('סופי מדווח', 'Reported final')} {entry.effectivePoints}</>}
          {entry.rejectionReason && <> · {entry.rejectionReason}</>}
          {entry.members.length > 0 && <span className="block text-[var(--text-muted)]">{entry.members.map((member) => `${member.courseId} / ${member.group}`).join(', ')}</span>}
        </li>)}</ul>
        <button type="button" className={BUTTON} aria-label={t(`העתקת מקצה שמור ${snapshot.draft.round} לטיוטה`, `Copy archived round ${snapshot.draft.round} into draft`)} onClick={() => onChange(JSON.parse(JSON.stringify(snapshot.draft)))}>{t('העתקה לטיוטה לתיקון ידני', 'Copy into draft for manual correction')}</button>
        <p className="text-[var(--text-muted)]">{t('העותק ניתן לעריכה; התמונה השמורה נשארת ללא שינוי.', 'The copy can be edited; the saved snapshot stays unchanged.')}</p>
      </article>)}</div>
    </details>}
  </div>
}
