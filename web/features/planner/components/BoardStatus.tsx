/** Placeholder and failure states shown in place of the board while it loads or fails to load. */
export function BoardLoading() {
  return (
    <section aria-label="התוכנית הנוכחית" className="planner-board-region flex flex-col gap-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-bold tracking-tight">לוח הסמסטרים</h2>
        <p role="status" aria-live="polite" className="mt-2 text-sm text-[var(--text-muted)]">
          טוען את התוכנית הנוכחית…
        </p>
        <div aria-hidden="true" className="mt-4 grid min-h-40 grid-flow-col auto-cols-[minmax(12rem,1fr)] gap-px overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--border)]">
          {[
            { id: 'year-3-a', label: 'שנה ג׳ — סמסטר א׳' },
            { id: 'year-3-b', label: 'שנה ג׳ — סמסטר ב׳' },
            { id: 'year-4-a', label: 'שנה ד׳ — סמסטר א׳' },
            { id: 'year-4-b', label: 'שנה ד׳ — סמסטר ב׳' },
          ].map((semester) => (
            <div key={semester.id} className="animate-pulse bg-[var(--surface)] p-3">
              <div className="h-4 w-20 rounded bg-black/[.06] dark:bg-white/[.08]" />
              <div className="mt-5 h-20 rounded-lg bg-black/[.04] dark:bg-white/[.05]" />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function BoardError() {
  return (
    <section aria-label="התוכנית הנוכחית" className="planner-board-region flex flex-col gap-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-bold tracking-tight">לוח הסמסטרים</h2>
        <p role="alert" className="mt-2 rounded-lg border border-red-500/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          טעינת התוכנית הנוכחית נכשלה. נא לרענן או לנסות שוב מאוחר יותר.
        </p>
      </div>
    </section>
  )
}
