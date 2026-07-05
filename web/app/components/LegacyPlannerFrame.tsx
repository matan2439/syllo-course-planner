'use client'

import { useRef } from 'react'

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
 * Cross-cutting legacy actions (my courses / change degree / reset) are
 * mirrored here as outer, product-level buttons. The legacy HTML is untouched:
 * its `<script>` block is a single non-module scope, so `openMyCoursesModal`,
 * `showModal` and `resetBoard` are already reachable as plain globals on the
 * same-origin iframe's window — no bridge hooks needed inside the legacy file.
 * The legacy in-frame toolbar keeps these same buttons too (not removed yet).
 */
export default function LegacyPlannerFrame({
  programQuerySuffix = '',
}: {
  programQuerySuffix?: string
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

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

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-t-2xl border-t border-[var(--border)] bg-[var(--bg)]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
        <span className="ps-1 text-xs font-medium text-[var(--text-muted)]">
          הממשק המלא
        </span>
        <div className="flex items-center gap-2">
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
