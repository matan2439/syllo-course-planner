'use client'

/**
 * Embeds the canonical static planner (served raw at /planner/legacy) inside
 * the Next product shell. An iframe keeps the legacy document in its own
 * context — every script, localStorage key and its own theme run unchanged —
 * while the shell provides the gradient frame, brand and cross-navigation.
 * Same-origin, so tau_theme and the saved program persist across the frame.
 *
 * The wrapper carries the themed background so there is no white flash before
 * the legacy HTML paints (it seeds its own theme in <head> synchronously).
 */
export default function LegacyPlannerFrame({
  programQuerySuffix = '',
}: {
  programQuerySuffix?: string
}) {
  return (
    <div className="h-full w-full overflow-hidden rounded-t-2xl border-t border-[var(--border)] bg-[var(--bg)]">
      <iframe
        src={`/planner/legacy${programQuerySuffix}`}
        title="מתכנן הלימודים המלא"
        className="h-full w-full border-0"
      />
    </div>
  )
}
