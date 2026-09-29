'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Internal billing console. Access is enforced by the server (developers only);
 * this page only renders what /api/billing/admin/* returns.
 */

type Json = Record<string, any>
const CARD = 'rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4'
const BTN = 'rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:border-[var(--purple)] disabled:opacity-50'

const HEALTH: Record<string, { label: string; tone: string }> = {
  normal: { label: 'NORMAL — הכל תקין', tone: 'bg-emerald-600' },
  review: { label: 'REVIEW REQUIRED — יש מקרים לבדיקה', tone: 'bg-amber-600' },
  critical: { label: 'CRITICAL INTEGRATION ERROR — נדרשת בדיקה מיידית', tone: 'bg-red-600' },
}

async function api(path: string, init?: RequestInit): Promise<Json> {
  const res = await fetch(`/api/billing/admin/${path}`, { credentials: 'same-origin', ...init })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(body.code ?? `HTTP ${res.status}`), { status: res.status })
  return body
}
const post = (path: string, body: Json) =>
  api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

function Stat({ label, value }: { label: string; value: unknown }) {
  return (
    <div className={CARD}>
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="text-xl font-bold text-[var(--text)]">{String(value ?? '—')}</p>
    </div>
  )
}

const askReason = (question: string) => window.prompt(question)?.trim() || null

function PaymentDetail({ id, onClose, onChanged }: { id: string; onClose(): void; onChanged(): void }) {
  const [detail, setDetail] = useState<Json | null>(null)
  const [tab, setTab] = useState<'timeline' | 'evidence'>('timeline')
  useEffect(() => { api(`payment?id=${encodeURIComponent(id)}`).then(setDetail, () => setDetail({ error: true })) }, [id])
  if (!detail) return <p className="text-sm">טוען…</p>
  if (detail.error) return <p className="text-sm">לא ניתן לטעון את הרכישה.</p>
  const e = detail.evidence
  return (
    <section className={CARD + ' space-y-3'} data-testid="payment-detail">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold">רכישה #{e.purchase.payment_id}</h2>
        <button type="button" className={BTN} onClick={onClose}>סגירה</button>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs md:grid-cols-4" dir="ltr">
        {[
          ['User', e.purchase.syllo_user_id], ['Paddle txn', e.purchase.paddle_transaction_id], ['Package', e.purchase.package_id],
          ['Amount', `${e.purchase.amount_total ?? '—'} ${e.purchase.currency ?? ''} (minor)`], ['Status', e.purchase.status],
          ['Refunded', e.purchase.refunded_amount], ['Dispute', e.purchase.dispute_state],
          ['Purchased / consumed / unused / revoked', `${e.credits.purchased} / ${e.credits.consumed} / ${e.credits.unused} / ${e.credits.revoked}`],
          ['Purchased at', e.purchase.purchased_at], ['Terms', e.purchase.terms_accepted?.purchase_disclosure],
          ['Policy', e.policy_decisions.at(-1)?.policy_version ?? '—'], ['Risk', detail.risk?.payment_risk_state ?? '—'],
        ].map(([k, v]) => (
          <div key={String(k)}><dt className="text-[var(--text-muted)]">{k}</dt><dd className="break-all font-mono">{String(v ?? '—')}</dd></div>
        ))}
      </dl>
      <div className="flex gap-2">
        <button type="button" className={BTN} disabled={tab === 'timeline'} onClick={() => setTab('timeline')}>ציר זמן</button>
        <button type="button" className={BTN} disabled={tab === 'evidence'} onClick={() => setTab('evidence')}>ראיות</button>
        <a className={BTN} href={`/api/billing/admin/evidence?id=${encodeURIComponent(id)}`}>JSON ↓</a>
        <a className={BTN} href={`/api/billing/admin/evidence?id=${encodeURIComponent(id)}&format=text`}>סיכום טקסט ↓</a>
      </div>
      {tab === 'timeline' ? (
        <ol className="space-y-1 text-xs" dir="ltr">
          {detail.timeline.map((t: Json, i: number) => (
            <li key={i} className="flex gap-3"><span className="w-44 shrink-0 font-mono text-[var(--text-muted)]">{t.at}</span><span className="w-20 shrink-0 font-semibold">{t.kind}</span><span>{t.label}</span></li>
          ))}
        </ol>
      ) : (
        <div className="space-y-2 text-xs" dir="ltr">
          <p>{e.statement}</p>
          <table className="w-full text-start">
            <thead><tr className="text-[var(--text-muted)]"><th>Delivered at</th><th>Operation</th><th>Endpoint</th><th>Model</th><th>Credits</th><th>Tokens in/out</th></tr></thead>
            <tbody>
              {e.service_delivery.operations.map((o: Json) => (
                <tr key={o.operation_id} className="font-mono"><td>{o.delivered_at}</td><td>{o.operation_id}</td><td>{o.endpoint}</td><td>{o.model}</td><td>{o.credits_from_this_purchase}</td><td>{o.input_tokens ?? '?'}/{o.output_tokens ?? '?'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detail.alerts.length > 0 && <p className="text-xs">התראות: {detail.alerts.map((a: Json) => `${a.code} (${a.status})`).join(', ')}</p>}
      {e.purchase.syllo_user_id && (
        <label className="flex items-center gap-2 text-xs">
          מצב סיכון לחשבון (משפיע רק על רכישות חדשות):
          <select
            aria-label="מצב סיכון"
            className="rounded border border-[var(--border)] bg-[var(--surface)] px-1"
            value={detail.risk?.payment_risk_state ?? 'normal'}
            onChange={async (ev) => {
              const reason = askReason('סיבה לשינוי מצב הסיכון:')
              if (!reason) return
              await post('risk-state', { user_id: e.purchase.syllo_user_id, state: ev.target.value, reason }).catch(() => undefined)
              onChanged()
              setDetail(await api(`payment?id=${encodeURIComponent(id)}`))
            }}
          >
            <option value="normal">normal</option><option value="review_required">review_required</option><option value="payment_risk_restricted">payment_risk_restricted</option>
          </select>
        </label>
      )}
    </section>
  )
}

const CASE_STATUSES = ['open', 'in_progress', 'awaiting_customer', 'resolved'] as const

/** One case (a billing_alerts row): facts, suggested reply, notes, status, history. Nothing is sent from here. */
function CaseDetail({ id, onClose, onChanged, onOpenPayment }: { id: string; onClose(): void; onChanged(): void; onOpenPayment(id: string): void }) {
  const [detail, setDetail] = useState<Json | null>(null)
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const reload = useCallback(async () => {
    try { const d = await api(`case?id=${encodeURIComponent(id)}`); setDetail(d); setDraft(d.draft) } catch { setDetail({ error: true }) }
  }, [id])
  useEffect(() => { void reload() }, [reload])
  if (!detail) return <p className="text-sm">טוען…</p>
  if (detail.error) return <p className="text-sm">לא ניתן לטעון את התיק.</p>
  const c = detail.case
  const change = async (fn: () => Promise<unknown>) => { await fn().catch(() => undefined); await reload(); onChanged() }
  return (
    <section className={CARD + ' space-y-3'} data-testid="case-detail">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold">תיק #{c.id} · {c.code}</h2>
        <button type="button" className={BTN} onClick={onClose}>סגירה</button>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs md:grid-cols-4" dir="ltr">
        {[['Status', c.case_status], ['Severity', c.severity], ['Customer email', c.customer_email], ['Reason', c.reason],
          ['Opened', c.created_at], ['User', c.user_id], ['Details', JSON.stringify(c.details)]].map(([k, v]) => (
          <div key={String(k)}><dt className="text-[var(--text-muted)]">{k}</dt><dd className="break-all font-mono">{String(v ?? '—')}</dd></div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {c.payment_id && <button type="button" className={BTN} onClick={() => onOpenPayment(String(c.payment_id))}>רכישה #{c.payment_id}</button>}
        {c.payment_id && <a className={BTN} href={`/api/billing/admin/evidence?id=${encodeURIComponent(c.payment_id)}`}>ראיות JSON ↓</a>}
        {detail.evidence?.purchase.paddle_transaction_id && <span className="font-mono" dir="ltr">Paddle {detail.evidence.purchase.paddle_transaction_id}</span>}
        <label className="flex items-center gap-1">
          מצב:
          <select aria-label="מצב התיק" className="rounded border border-[var(--border)] bg-[var(--surface)] px-1" value={c.case_status}
            onChange={(ev) => { const reason = askReason('סיבה לשינוי מצב התיק:'); if (reason) void change(() => post('cases/status', { id, case_status: ev.target.value, reason })) }}>
            {CASE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      {detail.timeline.length > 0 && (
        <ol className="space-y-1 text-xs" dir="ltr">
          {detail.timeline.map((t: Json, i: number) => (
            <li key={i} className="flex gap-3"><span className="w-44 shrink-0 font-mono text-[var(--text-muted)]">{t.at}</span><span className="w-20 shrink-0 font-semibold">{t.kind}</span><span>{t.label}</span></li>
          ))}
        </ol>
      )}
      <div className="space-y-1">
        <p className="text-xs font-semibold">טיוטת תשובה {detail.draft_saved ? '(נשמרה)' : '(נוצרה אוטומטית)'} — לבדיקה ושליחה ידנית</p>
        <textarea aria-label="טיוטת תשובה" className="h-56 w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs" value={draft} onChange={(ev) => setDraft(ev.target.value)} />
        <div className="flex gap-2">
          <button type="button" className={BTN} onClick={async () => { await navigator.clipboard?.writeText(draft).catch(() => undefined); setCopied(true) }}>{copied ? 'הועתק' : 'העתקה'}</button>
          <button type="button" className={BTN} onClick={() => void change(() => post('cases/draft', { id, draft, reason: 'draft edited by admin' }))}>שמירת הטיוטה</button>
          <button type="button" className={BTN} onClick={() => void change(() => post('cases/draft', { id, reason: 'regenerate draft from record' }))}>יצירה מחדש</button>
        </div>
      </div>
      <div className="space-y-1 text-xs">
        <p className="font-semibold">הערות פנימיות</p>
        <ul className="space-y-0.5" dir="ltr">{c.notes.map((n: Json, i: number) => <li key={i}><span className="font-mono text-[var(--text-muted)]">{n.at}</span> {n.text}</li>)}</ul>
        <button type="button" className={BTN} onClick={() => { const note = askReason('הערה פנימית:'); if (note) void change(() => post('cases/note', { id, reason: note })) }}>הוספת הערה</button>
      </div>
      {detail.actions.length > 0 && (
        <ul className="space-y-0.5 text-xs" dir="ltr">
          {detail.actions.map((a: Json) => <li key={a.id}><span className="font-mono text-[var(--text-muted)]">{a.created_at}</span> {a.action} — {a.reason}</li>)}
        </ul>
      )}
    </section>
  )
}

const PAYMENT_FILTERS = [['', 'הכל'], ['refunded', 'הוחזרו'], ['partially_refunded', 'הוחזרו חלקית'], ['disputed', 'במחלוקת'], ['chargeback', 'chargeback'], ['failed', 'נכשלו']] as const

export default function BillingAdminPage() {
  const [overview, setOverview] = useState<Json | null>(null)
  const [alerts, setAlerts] = useState<Json[]>([])
  const [payments, setPayments] = useState<Json[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedCase, setSelectedCase] = useState<string | null>(null)
  const [paymentFilter, setPaymentFilter] = useState('')
  const [caseView, setCaseView] = useState<'open' | 'resolved'>('open')
  const [runs, setRuns] = useState<Json[]>([])
  const [actions, setActions] = useState<Json[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [o, a, p, r, h] = await Promise.all([
        api('overview'), api(`alerts?status=${caseView}`), api(`payments${paymentFilter ? `?status=${paymentFilter}` : ''}`),
        api('reconcile-runs'), api('actions'),
      ])
      setOverview(o); setAlerts(a.alerts); setPayments(p.payments); setRuns(r.runs); setActions(h.actions); setError(null)
    } catch (e) {
      setError((e as { status?: number }).status === 403 || (e as { status?: number }).status === 401 ? 'אין הרשאה.' : 'טעינה נכשלה.')
    }
  }, [caseView, paymentFilter])
  useEffect(() => { void load() }, [load])

  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await load() } catch { setError('הפעולה נכשלה.') } finally { setBusy(false) } }
  const resolve = (id: string) => {
    const reason = window.prompt('סיבה לסגירת ההתראה:')
    if (reason) void act(() => post('alerts/resolve', { id, reason }))
  }
  const runReconcile = () => {
    const reason = window.prompt('סיבה להרצת התאמה ידנית:')
    if (reason) void act(() => post('reconcile', { reason }))
  }

  if (error && !overview) return <main className="p-6 text-sm">{error}</main>
  if (!overview) return <main className="p-6 text-sm">טוען…</main>
  const health = HEALTH[overview.health] ?? HEALTH.critical
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 text-[var(--text)]">
      <h1 className="text-xl font-bold">תשלומים והחזרים — מסוף ניהול</h1>
      <div data-testid="health" className={`rounded-xl px-4 py-2 text-sm font-bold text-white ${health.tone}`}>{health.label}</div>
      {error && <p role="status" className="text-xs">{error}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="רכישות שהושלמו" value={overview.payments.purchases} />
        <Stat label="קרדיטים שנמכרו" value={overview.payments.credits_sold} />
        <Stat label="קרדיטים בתשלום שנוצלו" value={overview.purchased_credits.consumed} />
        <Stat label="קרדיטים בתשלום שלא נוצלו" value={overview.purchased_credits.unused} />
        <Stat label="החזרים מלאים" value={overview.payments.refunds} />
        <Stat label="החזרים חלקיים" value={overview.payments.partial_refunds} />
        <Stat label="מחלוקות / chargebacks" value={overview.payments.disputes} />
        <Stat label="החזר אחרי שימוש" value={overview.payments.refunds_after_consumption} />
        <Stat label="לבדיקה (review)" value={overview.open_alerts.review} />
        <Stat label="קריטי" value={overview.open_alerts.critical} />
        <Stat label="הפרות אינווריאנט" value={overview.invariant_violations} />
        <Stat label="התאמה אחרונה" value={overview.last_reconciliation ? `${overview.last_reconciliation.status} · ${overview.last_reconciliation.started_at}` : 'לא רצה'} />
      </div>
      <div className={CARD + ' text-xs'} dir="ltr">
        Gross / refunded by currency (Paddle totals, minor units, before Paddle fees):{' '}
        {overview.money_by_currency.map((m: Json) => `${m.currency}: ${m.gross} / ${m.refunded}`).join(' · ') || '—'}
      </div>

      {selectedCase && <CaseDetail id={selectedCase} onClose={() => setSelectedCase(null)} onChanged={() => void load()} onOpenPayment={setSelected} />}
      {selected && <PaymentDetail id={selected} onClose={() => setSelected(null)} onChanged={() => void load()} />}

      <section className={CARD + ' space-y-2'}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">תיקים, תור בדיקה והתראות ({alerts.length})</h2>
          <div className="flex gap-2">
            <button type="button" className={BTN} disabled={caseView === 'open'} onClick={() => setCaseView('open')}>פתוחים</button>
            <button type="button" className={BTN} disabled={caseView === 'resolved'} onClick={() => setCaseView('resolved')}>סגורים</button>
            <button type="button" className={BTN} disabled={busy} onClick={runReconcile}>הרצת התאמה עכשיו</button>
          </div>
        </div>
        {alerts.length === 0 ? <p className="text-xs text-[var(--text-muted)]">{caseView === 'open' ? 'אין התראות פתוחות.' : 'אין תיקים סגורים.'}</p> : (
          <ul className="space-y-1 text-xs" dir="ltr">
            {alerts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 font-bold text-white ${a.severity === 'critical' ? 'bg-red-600' : 'bg-amber-600'}`}>{a.severity}</span>
                <button type="button" className="font-mono underline" onClick={() => setSelectedCase(String(a.id))}>#{a.id} {a.code}</button>
                <span className="rounded border border-[var(--border)] px-1">{a.case_status}</span>
                {a.payment_id && <button type="button" className="underline" onClick={() => setSelected(String(a.payment_id))}>payment #{a.payment_id}</button>}
                <span className="text-[var(--text-muted)]">{JSON.stringify(a.details)}</span>
                {a.status === 'open' && <button type="button" className={BTN} disabled={busy} onClick={() => resolve(String(a.id))}>סגירה</button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={CARD + ' space-y-2 overflow-x-auto'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold">רכישות, החזרים ומחלוקות</h2>
          <label className="flex items-center gap-1 text-xs">
            סינון:
            <select aria-label="סינון רכישות" className="rounded border border-[var(--border)] bg-[var(--surface)] px-1" value={paymentFilter} onChange={(ev) => setPaymentFilter(ev.target.value)}>
              {PAYMENT_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <table className="w-full text-xs" dir="ltr">
          <thead><tr className="text-start text-[var(--text-muted)]"><th>#</th><th>Status</th><th>Package</th><th>Amount</th><th>Refunded</th><th>Credits (bought/used/revoked)</th><th>Paddle txn</th><th>Review</th></tr></thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="cursor-pointer font-mono hover:bg-[var(--purple)]/10" onClick={() => setSelected(String(p.id))}>
                <td>{p.id}</td><td>{p.status}</td><td>{p.package_id}</td><td>{p.amount_total ?? '—'} {p.currency ?? ''}</td><td>{p.refunded_amount}</td>
                <td>{p.credits_purchased}/{p.credits_consumed ?? 0}/{p.credits_revoked ?? 0}</td><td>{p.paddle_transaction_id}</td><td>{p.manual_review_required ? '⚠' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <details className={CARD + ' text-xs'}>
        <summary className="cursor-pointer text-base font-bold">היסטוריית התאמות ({runs.length})</summary>
        <ul className="mt-2 space-y-1" dir="ltr">
          {runs.map((r) => (
            <li key={r.id}>
              <span className="font-mono">#{r.id} {r.started_at} · {r.trigger} · {r.status} · checked {r.checked} · repaired {r.repaired} · escalated {r.escalated}</span>
              {Array.isArray(r.findings) && r.findings.length > 0 && <span className="text-[var(--text-muted)]"> — {r.findings.map((f: Json) => `${f.code}:${f.outcome}`).join(', ')}</span>}
            </li>
          ))}
        </ul>
      </details>

      <details className={CARD + ' text-xs'}>
        <summary className="cursor-pointer text-base font-bold">היסטוריית פעולות מנהל ({actions.length})</summary>
        <ul className="mt-2 space-y-1" dir="ltr">
          {actions.map((a) => <li key={a.id} className="font-mono">{a.created_at} · {a.action} · {a.target} · {a.reason}</li>)}
        </ul>
      </details>
    </main>
  )
}
