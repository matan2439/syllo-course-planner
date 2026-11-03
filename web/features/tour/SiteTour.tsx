'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale } from '../locale/LocaleProvider'

/** Anyone (e.g. the profile menu) can relaunch the tour with this event. */
export const START_TOUR_EVENT = 'syllo:start-tour'
export const TOUR_DONE_KEY = 'syllo_tour_done'
export const startTour = () => window.dispatchEvent(new Event(START_TOUR_EVENT))

export type TourStep = {
  /** CSS selector of the element to highlight; missing → a centered card. */
  target?: string
  title: [he: string, en: string]
  body: [he: string, en: string]
  /** What the student can do here, one short line each. */
  points?: ReadonlyArray<[he: string, en: string]>
  /** Runs before the step is shown (switch a tab, open a panel). */
  prepare?: () => void
}

/**
 * A lightweight custom tour: a spotlight cut-out around the target, a card with Back/Next/Skip,
 * RTL-aware (logical positioning) and keyboard-operable. Completion (finish or skip) is remembered.
 */
export default function SiteTour({ steps, autoStart = false }: { steps: readonly TourStep[]; autoStart?: boolean }) {
  const { t, dir } = useLocale()
  const [index, setIndex] = useState<number | null>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const start = () => setIndex(0)
    window.addEventListener(START_TOUR_EVENT, start)
    let seen = true
    try { seen = localStorage.getItem(TOUR_DONE_KEY) === '1' } catch { /* storage blocked: don't nag */ }
    if (autoStart && !seen) setIndex(0)
    return () => window.removeEventListener(START_TOUR_EVENT, start)
  }, [autoStart])

  const finish = useCallback(() => {
    setIndex(null)
    try { localStorage.setItem(TOUR_DONE_KEY, '1') } catch { /* best effort */ }
  }, [])

  const step = index === null ? null : steps[index]
  // The parent rebuilds `steps` on every render; key all effects on the index so a step's
  // prepare() runs once per step, not on every parent re-render (that would fight the user).
  const stepRef = useRef(step)
  stepRef.current = step
  const target = step?.target
  const measure = useCallback(() => {
    const el = target ? document.querySelector<HTMLElement>(target) : null
    const next = el && el.offsetParent !== null ? el.getBoundingClientRect() : null
    setRect((old) => old && next && old.top === next.top && old.left === next.left && old.width === next.width && old.height === next.height ? old : next)
  }, [target])

  useEffect(() => {
    if (index === null) return
    stepRef.current?.prepare?.()
    // A timer, not rAF: rAF is paused in background tabs. Lets a tab switch render first.
    const timer = setTimeout(() => {
      if (target) document.querySelector<HTMLElement>(target)?.scrollIntoView?.({ block: 'center' })
      measure()
      cardRef.current?.focus()
    }, 50)
    return () => clearTimeout(timer)
  }, [index, target, measure])

  useEffect(() => {
    if (index === null) return
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [index, measure])

  if (index === null || !step) return null
  const last = index === steps.length - 1
  const back = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
  const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
  const pad = 6
  // Below the target when it fits, else above it, else (a target taller than the screen) pinned
  // to the bottom edge; centered when there is no target. Always inside the viewport.
  const CARD_H = 220
  const fitsBelow = rect ? rect.bottom + pad + 10 + CARD_H < window.innerHeight : false
  const fitsAbove = rect ? rect.top - pad - 10 - CARD_H > 0 : false
  const cardStyle = !rect
    ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
    : fitsBelow ? { top: rect.bottom + pad + 10, insetInlineStart: 16 }
    : fitsAbove ? { bottom: window.innerHeight - rect.top + pad + 10, insetInlineStart: 16 }
    : { bottom: 16, insetInlineStart: 16 }

  return (
    <div className="site-tour" dir={dir}>
      {rect
        ? <div aria-hidden="true" className="site-tour-spotlight" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
        : <div aria-hidden="true" className="site-tour-backdrop" />}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="site-tour-title"
        tabIndex={-1}
        className="site-tour-card"
        style={cardStyle}
        onKeyDown={(e) => {
          if (e.key === 'Escape') finish()
          else if (e.key === forward && !last) setIndex(index + 1)
          else if (e.key === back && index > 0) setIndex(index - 1)
        }}
      >
        <div className="flex items-center gap-2">
          <div aria-hidden="true" className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--border)]">
            <div className="h-full rounded-full bg-[var(--purple-strong)] transition-[width] duration-300" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
          </div>
          <p className="text-[11px] tabular-nums text-[var(--text-muted)]">{t(`${index + 1} מתוך ${steps.length}`, `${index + 1} of ${steps.length}`)}</p>
        </div>
        <h2 id="site-tour-title" className="mt-2 text-base font-bold">{t(...step.title)}</h2>
        <p className="mt-1 text-xs leading-5">{t(...step.body)}</p>
        {step.points && step.points.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 text-xs leading-5">
            {step.points.map((point, i) => (
              <li key={i} className="flex gap-1.5"><span aria-hidden="true" className="text-[var(--purple-strong)]">✓</span><span>{t(...point)}</span></li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={finish} className="site-tour-skip">{t('דלג', 'Skip')}</button>
          <span className="flex-1" />
          <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)} className="site-tour-secondary">{t('הקודם', 'Back')}</button>
          <button type="button" onClick={() => (last ? finish() : setIndex(index + 1))} className="site-tour-primary">{last ? t('סיום', 'Done') : t('הבא', 'Next')}</button>
        </div>
      </div>
    </div>
  )
}
