'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

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
 * current-program label and the theme toggle are mirrored here as outer,
 * product-level controls. The legacy HTML is untouched: its `<script>` block
 * is a single non-module scope, so `openMyCoursesModal`, `showModal`,
 * `resetBoard` and `applyTheme` are reachable as plain globals on the
 * same-origin iframe window — no bridge hooks needed inside the legacy file.
 * The legacy in-frame toolbar keeps these same controls too (not removed yet).
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
  const [theme, setTheme] = useState<'dark' | 'light'>('light')

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

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-t-2xl border-t border-[var(--border)] bg-[var(--bg)]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
        <span className="min-w-0 truncate ps-1 text-xs font-medium text-[var(--text-muted)]">
          {programLabel || 'הממשק המלא'}
        </span>
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
        src={`/planner/legacy${programQuerySuffix}`}
        title="מתכנן הלימודים המלא"
        className="h-full w-full min-h-0 flex-1 border-0"
      />
    </div>
  )
}
