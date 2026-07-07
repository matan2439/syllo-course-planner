'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { parseChipStatus, type ChipStatusVM } from '../../lib/chip-status'

/**
 * Embeds the canonical static planner (served raw at /planner/legacy) inside
 * the Next product shell. An iframe keeps the legacy document in its own
 * context — every script, localStorage key and its own theme run unchanged —
 * while the shell provides the gradient frame, brand and cross-navigation.
 * Same-origin, so tau_theme and the saved program persist across the frame.
 *
 * The wrapper carries the themed background so there is no white flash before
 * the legacy HTML paints (it seeds its own theme in <head> synchronously).
 *
 * Cross-cutting legacy actions (my courses / change degree / reset), the
 * current-program label, the live hdr-chips status and the theme toggle are
 * mirrored here as outer, product-level controls. The legacy HTML is
 * untouched: its `<script>` block is a single non-module scope, so
 * `openMyCoursesModal`, `showModal`, `resetBoard` and `applyTheme` are
 * reachable as plain globals on the same-origin iframe window — no bridge
 * hooks needed inside the legacy file. The legacy in-frame toolbar keeps
 * these same controls too (not removed yet).
 *
 * The iframe requests `?embed=1` (in addition to any ?program=), which
 * /planner/legacy injects scoped CSS for (see lib/embed-html.ts) to collapse
 * the legacy .page-hdr — now redundant since every control it held is
 * mirrored here. The raw /planner/legacy fallback (no embed) is unaffected.
 */
export default function LegacyPlannerFrame({
  programQuerySuffix = '',
  programLabel,
}: {
  programQuerySuffix?: string
  /** Current program (name · track · year), mirrors the legacy #hdr-prog-name. */
  programLabel?: string
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const observerRef = useRef<MutationObserver | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>('light')
  const [chips, setChips] = useState<ChipStatusVM | null>(null)

  // On mount, read the effective theme the same way the shell resolves it:
  // explicit data-theme (seeded from tau_theme in layout) → tau_theme →
  // prefers-color-scheme. Client-only, so no hydration mismatch.
  useEffect(() => {
    const attr = document.documentElement.dataset.theme
    if (attr === 'dark' || attr === 'light') return setTheme(attr)
    try {
      const stored = localStorage.getItem('tau_theme')
      if (stored === 'dark' || stored === 'light') return setTheme(stored)
    } catch {
      /* ignore */
    }
    setTheme(
      window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    )
  }, [])

  // renderChips() (legacy) runs on every state-changing action — drag/drop,
  // reset, program change, AI draft apply/reject — so a one-shot read on load
  // would go stale. Read #hdr-chips same-origin and mirror it verbatim: no
  // planner arithmetic is recomputed here, only display text already
  // sanitized by the legacy esc().
  const readChips = useCallback(() => {
    const container = iframeRef.current?.contentDocument?.getElementById('hdr-chips')
    if (!container) return
    const raw = Array.from(container.querySelectorAll('.chip')).map((el) => ({
      label: el.querySelector('.cl')?.textContent ?? '',
      value: el.querySelector('.cv')?.textContent ?? '',
      warn: el.classList.contains('warn'),
    }))
    setChips(parseChipStatus(raw))
  }, [])

  const setupChipObserver = useCallback(() => {
    readChips()
    observerRef.current?.disconnect()
    const container = iframeRef.current?.contentDocument?.getElementById('hdr-chips')
    if (!container) return
    const observer = new MutationObserver(readChips)
    observer.observe(container, { childList: true, subtree: true })
    observerRef.current = observer
  }, [readChips])

  // A same-origin iframe's `load` event can fire before React finishes
  // attaching a JSX `onLoad` listener — on a fast enough response (warm dev
  // server, production) the load wins the race and the one-shot event is
  // silently missed forever, so the observer never attaches. Checking for
  // the real document synchronously on mount covers the case where it
  // already fired; addEventListener('load', ...) covers the case where it
  // hasn't. Exactly one path runs per mount, so no duplicate observers — and
  // both are properly removed on cleanup, safe under StrictMode's
  // synchronous dev-mode mount→cleanup→mount and Fast Refresh re-running.
  //
  // contentDocument.readyState alone is NOT a safe "already loaded" signal:
  // an iframe's initial about:blank placeholder document also reports
  // readyState 'complete' immediately, before the real navigation even
  // starts — checking it would false-positive on the placeholder and skip
  // attaching the load listener entirely, permanently missing the real load
  // (verified via instrumented logging). #hdr-chips only exists in the real
  // legacy document, so its presence is the robust "already loaded" check.
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    if (iframe.contentDocument?.getElementById('hdr-chips')) {
      setupChipObserver()
      return () => observerRef.current?.disconnect()
    }
    iframe.addEventListener('load', setupChipObserver)
    return () => {
      iframe.removeEventListener('load', setupChipObserver)
      observerRef.current?.disconnect()
    }
  }, [setupChipObserver])

  const callLegacy = (fn: 'openMyCoursesModal' | 'showModal' | 'resetBoard') => {
    const win = iframeRef.current?.contentWindow as
      | (Window & Record<'openMyCoursesModal' | 'showModal' | 'resetBoard', () => void>)
      | null
      | undefined
    win?.[fn]?.()
  }

  const handleReset = () => {
    // resetBoard() itself has no confirmation in the legacy file — the outer
    // action is stricter than the button it mirrors, not just a passthrough.
    if (window.confirm('לאפס את כל התוכנית שבנית? הפעולה אינה הפיכה.')) {
      callLegacy('resetBoard')
    }
  }

  // Single theme source for both surfaces: write tau_theme (the legacy planner's
  // own key, shared same-origin), set data-theme on the shell document, and let
  // the iframe re-apply via its global applyTheme() — no desync, explicit choice
  // persists and stops following the OS.
  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try {
      localStorage.setItem('tau_theme', next)
    } catch {
      /* ignore */
    }
    document.documentElement.dataset.theme = next
    const win = iframeRef.current?.contentWindow as
      | (Window & { applyTheme?: () => void })
      | null
      | undefined
    if (win) {
      win.document.documentElement.dataset.theme = next
      win.applyTheme?.()
    }
  }, [theme])

  const hasChips =
    chips && (chips.total || chips.placed || chips.repo || chips.missingHours)
  const embedSuffix = programQuerySuffix
    ? `${programQuerySuffix}&embed=1`
    : '?embed=1'

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-t-2xl border-t border-[var(--border)] bg-[var(--bg)]">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
        <span className="min-w-0 truncate ps-1 text-xs font-medium text-[var(--text-muted)]">
          {programLabel || 'הממשק המלא'}
        </span>
        {hasChips && (
          <div className="flex flex-wrap items-center gap-1.5">
            {chips!.total != null && <StatusChip label="סה״כ" value={chips!.total} />}
            {chips!.placed != null && <StatusChip label="מוצבים" value={chips!.placed} />}
            {chips!.repo != null && <StatusChip label="במאגר" value={chips!.repo} />}
            {chips!.missingHours != null && (
              <StatusChip
                label="חסרות שעות"
                value={chips!.missingHours}
                warn={chips!.missingHoursWarn}
              />
            )}
          </div>
        )}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => callLegacy('openMyCoursesModal')}
            className="rounded-full px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]"
          >
            📋 הקורסים שלי
          </button>
          <button
            type="button"
            onClick={() => callLegacy('showModal')}
            className="rounded-full px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]"
          >
            החלפת תואר
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors duration-150 hover:border-red-500/40 hover:text-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]"
          >
            ↺ איפוס
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'מעבר למצב יום' : 'מעבר למצב לילה'}
            className="rounded-full px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]"
          >
            {theme === 'dark' ? '☀ יום' : '☾ לילה'}
          </button>
        </div>
      </div>
      <iframe
        ref={iframeRef}
        src={`/planner/legacy${embedSuffix}`}
        title="מתכנן הלימודים המלא"
        className="h-full w-full min-h-0 flex-1 border-0"
      />
    </div>
  )
}

/** Compact, muted status pill — mirrors one legacy hdr-chip verbatim. */
function StatusChip({
  label,
  value,
  warn,
}: {
  label: string
  value: string
  warn?: boolean
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
        warn
          ? 'border-amber-500/40 text-amber-700 dark:text-amber-300'
          : 'border-[var(--border)] text-[var(--text-muted)]'
      }`}
    >
      <span className="opacity-80">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  )
}
