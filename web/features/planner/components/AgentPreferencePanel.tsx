import type { Dispatch, SetStateAction } from 'react'
import type { GeneratedPlanModel } from '../../../../shared/planner/model'
import type { PreferenceProfile } from '../../../../api/ai/preference_model'
import PreferenceConversation from '../../agent/components/PreferenceConversation'
import CompletedCoursesPanel, { type AcademicStatusDraft } from '../../courses/components/CompletedCoursesPanel'
import CourseNamePicker, { type PickerCourse } from '../../courses/components/CourseNamePicker'

/** The optional "what matters to the assistant" section shown inside the agent conversation. */
export default function AgentPreferencePanel({
  programId, pickerCourses, catalogHoursById, academicStatus, updateAcademicStatus,
  maxHours, setMaxHours, priorHours, setPriorHours, wantIds, setWantIds, excludeIds, setExcludeIds,
  exclusionsNoneConfirmed, setExclusionsNoneConfirmed, updatePreferenceVersion, onProfileChange, proposal, stale,
}: {
  programId: string
  pickerCourses: PickerCourse[]
  catalogHoursById: Record<string, number | null | undefined>
  academicStatus: AcademicStatusDraft
  updateAcademicStatus: (next: AcademicStatusDraft) => void
  maxHours: string
  setMaxHours: (value: string) => void
  priorHours: string
  setPriorHours: (value: string) => void
  wantIds: string[]
  setWantIds: (ids: string[]) => void
  excludeIds: string[]
  setExcludeIds: (ids: string[]) => void
  exclusionsNoneConfirmed: boolean
  setExclusionsNoneConfirmed: Dispatch<SetStateAction<boolean>>
  /** Any preference edit invalidates proposals built from the old preferences. */
  updatePreferenceVersion: () => void
  onProfileChange: (profile: PreferenceProfile) => void
  proposal: GeneratedPlanModel | null
  stale: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <details>
        <summary className="cursor-pointer text-sm font-semibold">מה חשוב לעוזר לדעת? (אופציונלי)</summary>
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-xs text-[var(--text-muted)]">אפשר להשלים כאן פרטים שיעזרו לשיחה. הסוכן יאשר אותם מולכם — ואין כאן בנייה אוטומטית.</p>
          <CompletedCoursesPanel
            programId={programId}
            catalogCourses={pickerCourses}
            catalogHoursById={catalogHoursById}
            value={academicStatus}
            onChange={updateAcademicStatus}
          />
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
            מגבלת שעות שבועיות (אם יש לך העדפה ברורה)
            <input id="max-weekly-hours-control" name="max-weekly-hours" aria-label="מגבלת שעות שבועיות" inputMode="numeric" value={maxHours}
              onChange={(e) => { setMaxHours(e.target.value); updatePreferenceVersion() }}
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text)]" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
            שעות שכבר הושלמו (רק אם אינן מופיעות ברשימה)
            <input name="known-completed-hours" aria-label="שעות שהושלמו" inputMode="numeric" value={priorHours}
              onChange={(e) => { setPriorHours(e.target.value); updatePreferenceVersion() }}
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text)]" />
          </label>
          <CourseNamePicker inputName="wanted-course-search" label="קורסים שחשוב לך לשלב" placeholder="חיפוש לפי שם קורס…"
            courses={pickerCourses} selectedIds={wantIds}
            onChange={(ids) => { setWantIds(ids); updatePreferenceVersion() }} />
          <div id="excluded-courses-control">
            <CourseNamePicker inputName="excluded-course-search" label="קורסים שתרצה להימנע מהם" placeholder="חיפוש לפי שם קורס…"
              courses={pickerCourses} selectedIds={excludeIds}
              onChange={(ids) => { setExcludeIds(ids); updatePreferenceVersion() }} />
            {excludeIds.length === 0 && (
              <button
                type="button"
                aria-pressed={exclusionsNoneConfirmed}
                onClick={() => { setExclusionsNoneConfirmed((v) => !v); updatePreferenceVersion() }}
                className={`mt-2 self-start rounded-full border px-4 py-1.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)] ${
                  exclusionsNoneConfirmed
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-dashed border-[var(--border)] text-[var(--text-muted)]'
                }`}
              >
                אין קורסים שאני רוצה להימנע מהם
              </button>
            )}
          </div>
          <PreferenceConversation
            onBuild={() => undefined}
            onProfileChange={onProfileChange}
            showBuild={false}
            showInitialQuestion={false}
            // Server-provided impact signals only refine which question is useful.
            elicitationContext={{
              ...(proposal && proposal.balanceAlternativesMaterial === false ? { irrelevantTopicIds: ['semester_balance'] } : {}),
              ...(proposal?.groundedQuestionImpact ? { groundedFeatureImpact: proposal.groundedQuestionImpact } : {}),
              ...(proposal?.topicQuestionImpact ? { topicInterestImpact: proposal.topicQuestionImpact } : {}),
              ...(proposal?.priorityQuestionImpact && !stale ? {
                objectivePriorityImpact: {
                  eligible: proposal.priorityQuestionImpact.eligible,
                  options: proposal.priorityQuestionImpact.options.map((o) => ({ value: o.value, labelHe: o.labelHe })),
                },
              } : {}),
            }}
          />
        </div>
      </details>
    </div>
  )
}
