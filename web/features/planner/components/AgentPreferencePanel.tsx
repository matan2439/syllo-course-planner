import type { Dispatch, SetStateAction } from 'react'
import type { GeneratedPlanModel } from '../../../../shared/planner/model'
import type { PreferenceProfile } from '../../../../api/ai/preference_model'
import PreferenceConversation from '../../agent/components/PreferenceConversation'
import CompletedCoursesPanel, { type AcademicStatusDraft } from '../../courses/components/CompletedCoursesPanel'
import CourseNamePicker, { type PickerCourse } from '../../courses/components/CourseNamePicker'
import type { RequirementCategoryVM } from '../../../lib/requirements'

/** Values match api/ai/gateway_assessment.ts GATEWAY_ASSESSMENT_TYPES. */
const GATEWAY_ASSESSMENT_OPTIONS = [
  { value: 'final_exam', label: 'בחינה סופית' },
  { value: 'home_exam', label: 'בחינת בית' },
  { value: 'paper', label: 'עבודה או פרויקט' },
]

/**
 * What the assistant (and the progress view) needs to know. Inside the agent conversation it is a
 * collapsed optional section; as `alwaysOpen` (the workspace profile tab) it is a first-class panel.
 */
export default function AgentPreferencePanel({
  programId, pickerCourses, catalogHoursById, academicStatus, updateAcademicStatus,
  maxHours, setMaxHours, priorHours, setPriorHours, gatewayCategory = null, completedCategoryCounts = {},
  setCompletedCategoryCounts = () => undefined, wantIds, setWantIds, excludeIds, setExcludeIds, gatewayAssessments = [], setGatewayAssessments = () => undefined,
  exclusionsNoneConfirmed, setExclusionsNoneConfirmed, updatePreferenceVersion, onProfileChange, proposal, stale, alwaysOpen = false,
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
  /** The program's שער רוח requirement, when it has one — name and minimum come from program data. */
  gatewayCategory?: RequirementCategoryVM | null
  completedCategoryCounts?: Record<string, number>
  setCompletedCategoryCounts?: (counts: Record<string, number>) => void
  wantIds: string[]
  setWantIds: (ids: string[]) => void
  excludeIds: string[]
  setExcludeIds: (ids: string[]) => void
  /** Preferred שער רוח final-assessment types; empty = no preference. */
  gatewayAssessments?: string[]
  setGatewayAssessments?: (types: string[]) => void
  exclusionsNoneConfirmed: boolean
  setExclusionsNoneConfirmed: Dispatch<SetStateAction<boolean>>
  /** Any preference edit invalidates proposals built from the old preferences. */
  updatePreferenceVersion: () => void
  onProfileChange: (profile: PreferenceProfile) => void
  proposal: GeneratedPlanModel | null
  stale: boolean
  alwaysOpen?: boolean
}) {
  const input = 'w-24 rounded-lg border border-[var(--border)] bg-transparent px-2.5 py-1.5 text-sm text-[var(--text)]'
  const row = 'flex items-center justify-between gap-3 text-xs'
  const checkbox = 'size-4 shrink-0 accent-[var(--purple-strong)]'
  const heading = 'text-xs font-bold text-[var(--text-muted)]'
  const toggleAssessment = (type: string, on: boolean) => {
    setGatewayAssessments(on ? [...gatewayAssessments, type] : gatewayAssessments.filter((t) => t !== type))
    updatePreferenceVersion()
  }
  const hasGateway = Boolean(gatewayCategory && gatewayCategory.minCourses > 0)

  const body = (
        <div className="mt-3 flex flex-col gap-5">
          <section aria-label="הלימודים שלי" className="flex flex-col gap-2.5">
            <h3 className={heading}>הלימודים שלי</h3>
            <CompletedCoursesPanel
              programId={programId}
              catalogCourses={pickerCourses}
              catalogHoursById={catalogHoursById}
              value={academicStatus}
              onChange={updateAcademicStatus}
            />
            <label className={row}>
              ש״ש שהושלמו מחוץ לרשימה
              <input name="known-completed-hours" aria-label="שעות שהושלמו" inputMode="numeric" value={priorHours} placeholder="0"
                onChange={(e) => { setPriorHours(e.target.value); updatePreferenceVersion() }}
                className={input} />
            </label>
            {hasGateway && gatewayCategory && (
              <label className={row}>
                {`${gatewayCategory.title} שהשלמתי (מתוך ${gatewayCategory.minCourses})`}
                <input name="completed-gateway-courses" aria-label={`${gatewayCategory.title} שהשלמתי`}
                  type="number" inputMode="numeric" min={0} max={gatewayCategory.minCourses} step={1} placeholder="0"
                  value={completedCategoryCounts[gatewayCategory.id] ?? ''}
                  onChange={(e) => {
                    const n = Math.min(gatewayCategory.minCourses, Math.max(0, Math.floor(Number(e.target.value) || 0)))
                    const { [gatewayCategory.id]: _dropped, ...rest } = completedCategoryCounts
                    setCompletedCategoryCounts(e.target.value === '' ? rest : { ...rest, [gatewayCategory.id]: n })
                    updatePreferenceVersion()
                  }}
                  className={input} />
              </label>
            )}
          </section>

          <section aria-label="העדפות לתכנון" className="flex flex-col gap-3">
            <h3 className={heading}>העדפות לתכנון</h3>
            <label className={row}>
              מקסימום ש״ש בסמסטר
              <input id="max-weekly-hours-control" name="max-weekly-hours" aria-label="מגבלת שעות שבועיות" inputMode="numeric" value={maxHours} placeholder="—"
                onChange={(e) => { setMaxHours(e.target.value); updatePreferenceVersion() }}
                className={input} />
            </label>
            <CourseNamePicker inputName="wanted-course-search" label="קורסים שחשוב לי לשלב" placeholder="חיפוש לפי שם…"
              courses={pickerCourses} selectedIds={wantIds}
              onChange={(ids) => { setWantIds(ids); updatePreferenceVersion() }} />
            <div id="excluded-courses-control" className="flex flex-col gap-1.5">
              <CourseNamePicker inputName="excluded-course-search" label="קורסים להימנע מהם" placeholder="חיפוש לפי שם…"
                courses={pickerCourses} selectedIds={excludeIds}
                onChange={(ids) => { setExcludeIds(ids); updatePreferenceVersion() }} />
              {excludeIds.length === 0 && (
                <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <input type="checkbox" className={checkbox} checked={exclusionsNoneConfirmed}
                    onChange={() => { setExclusionsNoneConfirmed((v) => !v); updatePreferenceVersion() }} />
                  אין כאלה
                </label>
              )}
            </div>
            {hasGateway && (
              <fieldset className="flex flex-col gap-1.5 text-xs">
                <legend className="mb-1 text-[var(--text-muted)]">סוג מטלת סיום בשער רוח <span className="opacity-75">(בלי סימון — כל הסוגים)</span></legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {GATEWAY_ASSESSMENT_OPTIONS.map((o) => (
                    <label key={o.value} className="flex items-center gap-1.5">
                      <input type="checkbox" className={checkbox} checked={gatewayAssessments.includes(o.value)}
                        onChange={(e) => toggleAssessment(o.value, e.target.checked)} />
                      {o.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </section>

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
  )
  if (alwaysOpen) {
    return (
      <section aria-label="הפרופיל שלי" className="flex flex-col gap-3">
        <h2 className="text-base font-bold">הפרופיל שלי</h2>
        {body}
      </section>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <details>
        <summary className="cursor-pointer text-sm font-semibold">מה חשוב לעוזר לדעת? (אופציונלי)</summary>
        {body}
      </details>
    </div>
  )
}
