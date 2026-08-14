'use client'

/**
 * K9C — the evidence-backed explanation for the selected proposal.
 *
 * Renders ONLY what the server actually grounded: which confirmed preference
 * influenced ranking, which course feature supported it, and the official source
 * and academic year behind that feature. Source detail sits behind a disclosure,
 * so the default view stays a single factual sentence.
 *
 * It states nothing the evidence does not support — no "better course", no
 * "easier", no workload claim, no career claim — and it never reads missing
 * evidence as proof that a course has no laboratory. Coverage limits are
 * disclosed as limits.
 *
 * Accessibility: a real <button> toggle with aria-expanded/aria-controls, a
 * labelled region, visible focus, and meaning carried by TEXT (never colour
 * alone). RTL comes from the page. No motion is introduced — this is a
 * frequently-read status surface, and per the frequency rule a disclosure the
 * user opens repeatedly should not animate.
 */
import { useId, useState } from 'react'

export default function GroundedExplanation({
  explanationHe,
  sources = [],
  coverage,
}: {
  explanationHe?: string
  sources?: Array<{ courseId: string; sourceRef: string; academicYear: number | string }>
  coverage?: { coveredCourseCount: number; requestedCourseCount: number; unknownCourseIds: string[] }
}) {
  const [open, setOpen] = useState(false)
  const regionId = useId()

  // No grounded objective applied ⇒ render nothing at all, rather than an
  // empty-looking claim.
  if (!explanationHe) return null

  return (
    <section className="text-sm" aria-label="הסבר על ההעדפה שהשפיעה על הבחירה">
      <p className="text-[var(--text)]">{explanationHe}</p>

      {(sources.length > 0 || coverage) && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={regionId}
            className="mt-1 rounded-md px-2 py-1 text-[var(--purple-strong)] underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]"
          >
            {open ? 'הסתר מקורות' : 'הצג מקורות'}
          </button>

          {open && (
            <div id={regionId} role="region" aria-label="מקורות רשמיים" className="mt-2 flex flex-col gap-2">
              {sources.map((s) => (
                <p key={`${s.courseId}-${s.sourceRef}`} className="text-xs text-[var(--text-muted)]">
                  {`קורס ${s.courseId} — סילבוס רשמי, שנת ${s.academicYear}: `}
                  <span dir="ltr">{s.sourceRef}</span>
                </p>
              ))}
              {coverage && (
                <p className="text-xs text-[var(--text-muted)]">
                  {`נמצאה עדות רשמית עבור ${coverage.coveredCourseCount} מתוך ${coverage.requestedCourseCount} קורסים אפשריים.`}
                  {coverage.unknownCourseIds.length > 0 &&
                    ` עבור חלק מהקורסים אופן ההוראה אינו מצוין במקור הרשמי — היעדר מידע אינו מעיד שאין בהם מעבדה.`}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
