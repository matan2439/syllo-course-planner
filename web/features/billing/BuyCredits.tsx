'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BUY_CREDITS_EVENT } from './ai_access'
import { LEGAL_VERSIONS, PURCHASE_DISCLOSURE_HE } from '../../../shared/billing/legal_versions'
import { loadPaddle, paddleClientConfigured, type PaddleEventData } from './paddle-client'

interface Pkg { id: string; name_he: string; credits: number; paddle_price_id: string }
interface Purchase {
  payment_id: string
  status: string
  completed_at: string | null
  credits: { purchased: number; consumed: number; in_use: number; unused: number; revoked: number }
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'choose' }
  | { kind: 'creating' }
  | { kind: 'checkout'; transactionId: string }
  | { kind: 'processing'; transactionId: string }
  | { kind: 'success'; credits: number }
  | { kind: 'error'; message: string }

const BTN = 'w-full rounded-lg bg-[var(--purple-strong)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--purple)] disabled:opacity-60'
const PKG = 'flex w-full items-center justify-between gap-3 rounded-xl bg-[var(--purple-strong)] px-4 py-3 text-start text-white transition hover:bg-[var(--purple)] disabled:opacity-50'
const LINK = 'w-full text-xs font-semibold text-[var(--purple)] underline disabled:opacity-60'
const POLL_MS = 2_000
const POLL_LIMIT = 45 // ~90s; after that the purchase is still processed server-side

const STATUS_HE: Record<string, string> = {
  completed: 'הושלמה', partially_refunded: 'הוחזרה חלקית', refunded: 'הוחזרה', disputed: 'במחלוקת', chargeback: 'במחלוקת',
}

async function getJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { credentials: 'same-origin', ...init })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, body }
}

/**
 * Buy Syllo Credits. The balance changes ONLY after the server processed Paddle's
 * verified webhook — never optimistically from the browser's checkout event.
 */
export default function BuyCredits({ onBalanceChanged, trigger = true }: {
  onBalanceChanged(): void
  /** Render the inline "buy credits" link; false = open only via openBuyCredits(). */
  trigger?: boolean
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [packages, setPackages] = useState<Pkg[]>([])
  // Paddle's own localized price and product name per price id (never hardcoded here).
  const [preview, setPreview] = useState<Record<string, { total: string; name?: string }>>({})
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [accepted, setAccepted] = useState(false)
  const polls = useRef(0)

  useEffect(() => {
    if (phase.kind !== 'processing') return
    const timer = setInterval(async () => {
      polls.current += 1
      const { ok, body } = await getJson(`/api/billing/status?transaction_id=${encodeURIComponent(phase.transactionId)}`).catch(() => ({ ok: false, body: {} }))
      if (ok && body.credited) {
        clearInterval(timer)
        onBalanceChanged()
        setPhase({ kind: 'success', credits: Number(body.credits) })
      } else if (polls.current >= POLL_LIMIT) {
        clearInterval(timer)
        setPhase({ kind: 'error', message: 'התשלום עדיין בעיבוד. הקרדיטים יתווספו אוטומטית ברגע שהתשלום יאושר.' })
      }
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [phase, onBalanceChanged])

  useEffect(() => {
    const onOpen = () => { if (paddleClientConfigured()) void open() }
    window.addEventListener(BUY_CREDITS_EVENT, onOpen)
    return () => window.removeEventListener(BUY_CREDITS_EVENT, onOpen)
  })

  if (!paddleClientConfigured()) return null

  const onPaddleEvent = (event: PaddleEventData) => {
    if (event.name === 'checkout.completed' && event.data?.transaction_id) {
      polls.current = 0
      setPhase({ kind: 'processing', transactionId: event.data.transaction_id })
    }
  }

  const open = async () => {
    setPhase({ kind: 'loading' })
    try {
      const [{ body: pkgs }, { body: me }] = await Promise.all([getJson('/api/billing/packages'), getJson('/api/billing/me')])
      const list: Pkg[] = pkgs.packages ?? []
      setPackages(list)
      setPurchases(me.purchases ?? [])
      setPhase(list.length ? { kind: 'choose' } : { kind: 'error', message: 'רכישת קרדיטים אינה זמינה כרגע.' })
      if (list.length) {
        // Prices come from Paddle (localized, tax-aware) — Syllo never hardcodes them.
        const paddle = await loadPaddle(onPaddleEvent)
        const result = await paddle.PricePreview({ items: list.map((p) => ({ priceId: p.paddle_price_id, quantity: 1 })) })
        setPreview(Object.fromEntries(result.data.details.lineItems.map((item) => [item.price.id, { total: item.formattedTotals.total, name: item.product?.name }])))
      }
    } catch {
      setPhase((current) => (current.kind === 'loading' ? { kind: 'error', message: 'רכישת קרדיטים אינה זמינה כרגע.' } : current))
    }
  }

  const buy = async (pkg: Pkg) => {
    setPhase({ kind: 'creating' })
    try {
      const { ok, body } = await getJson('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package_id: pkg.id, disclosure_version: LEGAL_VERSIONS.purchaseDisclosure, accepted }),
      })
      if (!ok || !body.transaction_id) {
        setPhase({ kind: 'error', message: body.code === 'PURCHASE_RESTRICTED' ? 'לא ניתן לבצע רכישה בחשבון זה כרגע. אפשר לפנות לתמיכה.' : 'לא ניתן לפתוח את התשלום כרגע. נסו שוב.' })
        return
      }
      const paddle = await loadPaddle(onPaddleEvent)
      paddle.Checkout.open({ transactionId: body.transaction_id })
      setPhase({ kind: 'checkout', transactionId: body.transaction_id })
    } catch {
      setPhase({ kind: 'error', message: 'לא ניתן לפתוח את התשלום כרגע. נסו שוב.' })
    }
  }

  if (phase.kind === 'idle') {
    return trigger ? <button type="button" className={LINK} onClick={() => void open()}>קניית קרדיטים</button> : null
  }

  const close = () => setPhase({ kind: 'idle' })
  // A dialog of its own (not inside the account popover), portaled to <body>.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) close() }}>
    <div role="dialog" aria-modal="true" aria-label="קניית קרדיטים" data-testid="buy-credits"
      className="max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-panel)] p-5 text-sm shadow-[var(--shadow-premium)]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-[var(--text)]">קניית קרדיטים</h2>
        <button type="button" aria-label="סגירה" onClick={close} className="rounded-full px-2 text-lg leading-none text-[var(--text-muted)] hover:text-[var(--text)]">×</button>
      </div>
      <p className="text-xs text-[var(--text-muted)]">כל תשובה של העוזר החכם עולה קרדיט אחד.</p>
      {phase.kind === 'loading' && <p className="text-xs text-[var(--text-muted)]">טוען חבילות…</p>}
      {(phase.kind === 'choose' || phase.kind === 'creating' || phase.kind === 'checkout') && (
        <>
          <ul className="space-y-2">
            {packages.map((pkg) => (
              <li key={pkg.id}>
                <button type="button" dir="ltr" className={PKG} disabled={!accepted || phase.kind !== 'choose'} onClick={() => void buy(pkg)}>
                  <span className="flex flex-col items-start">
                    <span className="font-semibold">{preview[pkg.paddle_price_id]?.name ?? `${pkg.credits} credits`}</span>
                    <span className="text-xs opacity-80">{pkg.credits.toLocaleString('en-US')} AI credits</span>
                  </span>
                  <span className="text-base font-bold tabular-nums">{preview[pkg.paddle_price_id]?.total ?? '…'}</span>
                </button>
              </li>
            ))}
          </ul>
          {/* REQUIRES LEGAL REVIEW: placeholder disclosure, versioned in shared/billing/legal_versions.ts */}
          <div data-testid="purchase-disclosure" className="space-y-1 text-[11px] leading-snug text-[var(--text-muted)]">
            {PURCHASE_DISCLOSURE_HE.map((line) => <p key={line}>{line}</p>)}
          </div>
          <label className="flex items-start gap-2 text-xs text-[var(--text)]">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            <span>קראתי ואני מסכים/ה לתנאים ולמדיניות ההחזרים</span>
          </label>
          {phase.kind === 'checkout' && <p role="status" className="text-xs text-[var(--text-muted)]">חלון התשלום של Paddle פתוח.</p>}
        </>
      )}
      {phase.kind === 'processing' && <PurchaseProgress />}
      {phase.kind === 'success' && (
        <div role="status" data-testid="purchase-success" className="space-y-3 py-2 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-2xl text-white shadow-lg" aria-hidden="true">✓</span>
          <p className="text-lg font-bold text-[var(--text)]">+{phase.credits.toLocaleString('he-IL')} קרדיטים</p>
          <p className="text-xs text-[var(--text-muted)]">התשלום אומת מול Paddle והקרדיטים זמינים בחשבון.</p>
          <button type="button" className={BTN} onClick={close}>להתחיל להשתמש בעוזר</button>
        </div>
      )}
      {phase.kind === 'error' && <p role="status" className="text-xs text-[var(--text-muted)]">{phase.message}</p>}
      {purchases.length > 0 && (
        <div data-testid="purchase-history" className="space-y-1 border-t border-[var(--border)] pt-2">
          <p className="text-xs font-semibold text-[var(--text)]">הרכישות שלי</p>
          {purchases.map((p) => (
            <p key={p.payment_id} className="text-[11px] text-[var(--text-muted)]">
              {p.credits.purchased} נרכשו · {p.credits.consumed} נוצלו · {p.credits.unused} זמינים{p.credits.revoked ? ` · ${p.credits.revoked} בוטלו` : ''}
              {STATUS_HE[p.status] && p.status !== 'completed' ? ` · ${STATUS_HE[p.status]}` : ''}
            </p>
          ))}
        </div>
      )}
    </div>
    </div>,
    document.body,
  )
}

/** Verification in progress: the balance changes only after the server processes Paddle's signed webhook. */
function PurchaseProgress() {
  const steps = [
    { label: 'התשלום התקבל ב-Paddle', done: true },
    { label: 'אימות מאובטח של התשלום', done: false },
    { label: 'הוספת הקרדיטים לחשבון', done: false },
  ]
  return (
    <div role="status" aria-live="polite" data-testid="purchase-progress" className="space-y-3 py-1">
      <ol className="space-y-2">
        {steps.map((step, i) => {
          const active = !step.done && (i === 0 || steps[i - 1].done)
          return (
            <li key={step.label} className="flex items-center gap-3 text-sm">
              <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                step.done ? 'bg-emerald-500 text-white'
                  : active ? 'border-2 border-[var(--purple)] border-t-transparent animate-spin'
                    : 'border border-[var(--border)] text-[var(--text-muted)]'}`}>
                {step.done ? '✓' : active ? '' : i + 1}
              </span>
              <span className={step.done || active ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}>{step.label}</span>
            </li>
          )
        })}
      </ol>
      <p className="text-xs text-[var(--text-muted)]">זה לוקח בדרך כלל כמה שניות. אפשר לסגור את החלון — הקרדיטים יתווספו גם כך.</p>
    </div>
  )
}
