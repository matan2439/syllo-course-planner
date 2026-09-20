import { Card } from '../../../components/ui'
import { semesterTitleHe } from '../../../lib/planner/board-vm'
import type { ManualAddIntent } from '../types'

/** Asks which semester a course picked from the repository should be added to. */
export default function ManualAddPrompt({ intent, courseName, saving, onCancel, onPick }: {
  intent: ManualAddIntent
  courseName: string
  saving: boolean
  onCancel: () => void
  onPick: (semesterId: string) => void
}) {
  return (
    <Card className="flex flex-col gap-3 p-4" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold">הוספת {courseName}</h2>
        <button
          type="button"
          aria-label="ביטול הוספת קורס"
          onClick={onCancel}
          disabled={saving}
          className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)] disabled:opacity-50"
        >
          ביטול
        </button>
      </div>
      {intent.semesterIds.length ? (
        <div className="flex flex-wrap gap-2">
          {intent.semesterIds.map((semesterId) => (
            <button key={semesterId} type="button" disabled={saving}
              onClick={() => onPick(semesterId)}
              className="rounded-full border border-[var(--border)] px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]">
              הוסף אל {semesterTitleHe(semesterId)}
            </button>
          ))}
        </div>
      ) : <p className="text-sm text-[var(--text-muted)]">לא נמצא סמסטר מוצע סמכותי לקורס זה.</p>}
    </Card>
  )
}
