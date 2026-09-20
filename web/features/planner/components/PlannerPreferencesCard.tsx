import { Card } from '../../../components/ui'
import CourseNamePicker, { type PickerCourse } from '../../courses/components/CourseNamePicker'

/** Weekly-hours limit, completed hours, and wanted/excluded courses for the standard (non-agent) build. */
export default function PlannerPreferencesCard({
  maxHours, setMaxHours, priorHours, setPriorHours, wantIds, setWantIds, excludeIds, setExcludeIds,
  pickerCourses, updatePreferenceVersion,
}: {
  maxHours: string
  setMaxHours: (value: string) => void
  priorHours: string
  setPriorHours: (value: string) => void
  wantIds: string[]
  setWantIds: (ids: string[]) => void
  excludeIds: string[]
  setExcludeIds: (ids: string[]) => void
  pickerCourses: PickerCourse[]
  /** Any preference edit invalidates proposals built from the old preferences. */
  updatePreferenceVersion: () => void
}) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-bold tracking-tight">העדפות</h2>
      <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
        מגבלת שעות שבועיות לסמסטר
        <input id="max-weekly-hours-control" name="max-weekly-hours" aria-label="מגבלת שעות שבועיות" inputMode="numeric" value={maxHours}
          onChange={(e) => { setMaxHours(e.target.value); updatePreferenceVersion() }}
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text)]" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
        שעות שהושלמו (שנים א׳–ב׳, מחוץ ללוח)
        <input name="known-completed-hours" aria-label="שעות שהושלמו" inputMode="numeric" value={priorHours}
          onChange={(e) => { setPriorHours(e.target.value); updatePreferenceVersion() }}
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text)]" />
      </label>
      <CourseNamePicker inputName="wanted-course-search" label="קורסים להוספה (חיפוש לפי שם)" placeholder="הקלידו שם קורס להוספה…"
        courses={pickerCourses} selectedIds={wantIds}
        onChange={(ids) => { setWantIds(ids); updatePreferenceVersion() }} />
      <div id="excluded-courses-control">
        <CourseNamePicker inputName="excluded-course-search" label="קורסים להחריג (לא יופיעו בתוכנית)" placeholder="הקלידו שם קורס להחרגה…"
          courses={pickerCourses} selectedIds={excludeIds}
          onChange={(ids) => { setExcludeIds(ids); updatePreferenceVersion() }} />
      </div>
    </Card>
  )
}
