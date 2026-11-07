'use client'

import type { DegreeEvidence, SemesterDecisionEvidence } from '../../../../shared/planner/degree-evidence'
import type { DegreeRule } from '../../../../shared/planner/degree-rules'
import { semesterTitleHe } from '../../../lib/planner/board-vm'
import OptionalPathwayFields from './OptionalPathwayFields'

/** Explicit student reports used by the same validation context as completed courses. */
export default function DegreeEvidenceFields({ rules, value = {}, courseNames, semesterIds = [], pastCourseIds = [],
  currentlyTakenPrerequisiteIds, onChange }: {
  rules: readonly DegreeRule[]
  value?: DegreeEvidence
  courseNames: Readonly<Record<string, string>>
  semesterIds?: readonly string[]
  pastCourseIds?: readonly string[]
  /** When wired, restrict prerequisite reports to these currently taken prerequisite identities. */
  currentlyTakenPrerequisiteIds?: readonly string[]
  onChange: (value: DegreeEvidence) => void
}) {
  const needsIntake = rules.some(rule => rule.params?.cohort === 'spring_intake')
  const needsEnglish = rules.some(rule => rule.kind === 'language_requirement')
  const needsGraduate = rules.some(rule => rule.params?.course_level === 'graduate (תואר שני)')
  const needsAverage = needsGraduate || rules.some(rule => rule.params?.min_average !== undefined)
  const needsLoad = rules.some(rule => rule.params?.min_load_fraction_without_approval !== undefined)
  const durationRules = rules.filter(rule => rule.kind === 'study_duration' && rule.params?.extension_years !== undefined)
  const graduateRules = rules.filter(rule => rule.params?.course_level === 'graduate (תואר שני)')
  const prerequisiteIds = rules.some(rule => rule.kind === 'prerequisite_policy')
    ? [...new Set(currentlyTakenPrerequisiteIds ?? pastCourseIds)] : []
  const decisionRules = rules.filter(rule => rule.params?.admission_interview === true ||
    rule.params?.requires_supervisor_recommendation === true || rule.params?.completed_recommended_plan === true ||
    (rule.kind === 'load_limit' && rule.params?.course_level !== 'graduate (תואר שני)'))
  const field = 'block w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1'
  const semesterDecisionFields = (subject: string, decision: SemesterDecisionEvidence | undefined,
    update: (decision: SemesterDecisionEvidence) => void) => <div className="space-y-1">
    <label className="block">{subject}
      <select className={field} value={decision?.approved === undefined ? '' : String(decision.approved)}
        onChange={event => update({ ...decision, reference: decision?.reference ?? '',
          approved: event.target.value === '' ? undefined : event.target.value === 'true' })}>
        <option value="">טרם דווח</option><option value="true">אושר לפי ההחלטה שקיבלתי</option>
        <option value="false">לא אושר לפי ההחלטה שקיבלתי</option>
      </select>
    </label>
    <label className="block">סמסטר הלימודים האחרון שאושר עבור {subject}
      <input className={field} type="number" min={1} max={40} step={1} value={decision?.approvedThroughSemester ?? ''}
        onChange={event => {
          const semester = event.target.valueAsNumber
          update({ ...decision, reference: decision?.reference ?? '', approvedThroughSemester:
            Number.isInteger(semester) && semester >= 1 && semester <= 40 ? semester : undefined })
        }} />
    </label>
    <label className="block">אסמכתה להחלטה עבור {subject}
      <input className={field} maxLength={500} value={decision?.reference ?? ''}
        onChange={event => update({ ...decision, reference: event.target.value })} />
    </label>
  </div>
  if (!needsIntake && !needsAverage && !needsEnglish && !decisionRules.length &&
    !durationRules.length && !needsLoad && !prerequisiteIds.length && !rules.some(rule => rule.kind === 'optional_pathway')) return null
  return <fieldset className="my-3 space-y-3 rounded border border-[var(--border)] p-3 text-sm">
    <legend className="px-1 font-semibold">נתונים לבדיקת תנאי התואר</legend>
    <p className="text-[var(--text-muted)]">הדיווח נשמר עם המצב האקדמי בבניית תוכנית. אישור ניתן על ידי האוניברסיטה ויש לציין את האסמכתה שקיבלתם.</p>
    <OptionalPathwayFields rules={rules} value={value} courseNames={courseNames} onChange={onChange} />
    {needsIntake && <label className="block">מחזור תחילת הלימודים
      <select className={field} value={value.intake ?? ''} onChange={event => onChange({
        ...value, intake: event.target.value === 'spring' ? 'spring' : event.target.value === 'autumn' ? 'autumn' : undefined,
      })}>
        <option value="">טרם דווח</option><option value="autumn">סתיו</option><option value="spring">אביב</option>
      </select>
    </label>}
    {needsAverage && <label className="block">ממוצע ציונים נוכחי לפי גיליון הציונים
      <input className={field} type="number" min={0} max={100} step="0.01" value={value.average ?? ''}
        onChange={event => {
          const number = event.target.valueAsNumber
          onChange({ ...value, average: Number.isFinite(number) && number >= 0 && number <= 100 ? number : undefined })
        }} />
    </label>}
    {needsEnglish && <>
      <label className="block">שנת תחילת שנת הלימודים הראשונה בישראל (למשל תשפ״ב — 2021)
        <input className={field} type="number" min={1950} max={2200} step={1} value={value.higherEducationStartYear ?? ''}
          onChange={event => {
            const year = event.target.valueAsNumber
            onChange({ ...value, higherEducationStartYear: Number.isInteger(year) && year >= 1950 && year <= 2200 ? year : undefined })
          }} />
      </label>
      <details>
        <summary className="cursor-pointer">קורסים שהוכרו לצורך דרישת הלימודים באנגלית</summary>
        <p className="my-1 text-[var(--text-muted)]">סמנו לפי הרישום או האישור שקיבלתם מהאוניברסיטה.</p>
        <label className="block"><input type="checkbox" checked={value.recognizedEnglishCourseIds !== undefined}
          onChange={event => onChange({ ...value, recognizedEnglishCourseIds: event.target.checked ? [] : undefined })} /> השלמתי דיווח על קורסים מוכרים באנגלית</label>
        {value.recognizedEnglishCourseIds !== undefined && Object.entries(courseNames).map(([id, name]) => <label key={id} className="block">
          <input type="checkbox" checked={value.recognizedEnglishCourseIds!.includes(id)} onChange={event => {
            const ids = new Set(value.recognizedEnglishCourseIds)
            if (event.target.checked) ids.add(id)
            else ids.delete(id)
            onChange({ ...value, recognizedEnglishCourseIds: [...ids] })
          }} /> {name} <span dir="ltr">{id}</span>
        </label>)}
      </details>
    </>}
    {needsGraduate && <details>
      <summary className="cursor-pointer">קורסי תואר שני בתוכנית</summary>
      <label className="block"><input type="checkbox" checked={value.graduateCourseIds !== undefined}
        onChange={event => onChange({ ...value, graduateCourseIds: event.target.checked ? [] : undefined })} /> השלמתי דיווח על קורסי תואר שני</label>
      {value.graduateCourseIds !== undefined && Object.entries(courseNames).map(([id, name]) => <label key={id} className="block">
        <input type="checkbox" checked={value.graduateCourseIds!.includes(id)} onChange={event => {
          const ids = new Set(value.graduateCourseIds)
          if (event.target.checked) ids.add(id)
          else ids.delete(id)
          onChange({ ...value, graduateCourseIds: [...ids] })
        }} /> {name} <span dir="ltr">{id}</span>
      </label>)}
      {!!value.graduateCourseIds?.length && graduateRules.map(rule => {
        const eligibility = value.graduateEligibility?.[rule.rule_id] ?? {}
        const update = (patch: Partial<typeof eligibility>) => onChange({
          ...value, graduateEligibility: { ...value.graduateEligibility, [rule.rule_id]: { ...eligibility, ...patch } },
        })
        const approval = eligibility.trackHeadApproval
        return <div key={rule.rule_id} className="my-2 space-y-2">
          <p className="text-[var(--text-muted)]">יש לדווח על הסף שקבעה ועדת ההוראה ועל החלטת ראש המגמה בנפרד. אישור אינו מאפשר יותר משני קורסי תואר שני בסמסטר.</p>
          <label className="block">סף ממוצע שקבעה ועדת ההוראה לרישום לקורסי תואר שני
            <input className={field} type="number" min={0} max={100} step="0.01" value={eligibility.committeeMinimumAverage ?? ''}
              onChange={event => {
                const average = event.target.valueAsNumber
                update({ committeeMinimumAverage: Number.isFinite(average) && average >= 0 && average <= 100 ? average : undefined })
              }} />
          </label>
          <label className="block">אסמכתה לסף שקבעה ועדת ההוראה
            <input className={field} maxLength={500} value={eligibility.committeeReference ?? ''}
              onChange={event => update({ committeeReference: event.target.value })} />
          </label>
          <label className="block">החלטת ראש המגמה על רישום לקורסי תואר שני
            <select className={field} value={approval?.approved === undefined ? '' : String(approval.approved)}
              onChange={event => update({ trackHeadApproval: { reference: approval?.reference ?? '',
                approved: event.target.value === '' ? undefined : event.target.value === 'true' } })}>
              <option value="">טרם דווח</option><option value="true">הרישום אושר</option><option value="false">הרישום לא אושר</option>
            </select>
          </label>
          <label className="block">אסמכתה להחלטת ראש המגמה
            <input className={field} maxLength={500} value={approval?.reference ?? ''}
              onChange={event => update({ trackHeadApproval: { ...approval, reference: event.target.value } })} />
          </label>
        </div>
      })}
    </details>}
    {durationRules.map(rule => {
      const extension = value.durationExtensions?.[rule.rule_id] ?? {}
      const update = (patch: Partial<typeof extension>) => onChange({
        ...value, durationExtensions: { ...value.durationExtensions, [rule.rule_id]: { ...extension, ...patch } },
      })
      const eligible = extension.eligibleStudent
      return <details key={rule.rule_id}>
        <summary className="cursor-pointer">תקופת הארכת לימודים שאושרה</summary>
        <p className="my-1 text-[var(--text-muted)]">דווחו עד איזה סמסטר לימודים אושרה ההארכה. הארכה מעבר לתקופה הרגילה דורשת החלטה חריגה מפורשת ואסמכתה המתייחסת אליה.</p>
        {semesterDecisionFields('הארכה רגילה', extension.ordinary, ordinary => update({ ordinary }))}
        {semesterDecisionFields('הארכה חריגה מעבר לתקופה הרגילה', extension.exceptional, exceptional => update({ exceptional }))}
        {rule.params?.eligible_student_extension_semesters === 2 && <div className="my-2 space-y-1">
          <p>הארכה של שני סמסטרים לתלמידה זכאית מחייבת דיווח על הזכאות ועל החלטת האוניברסיטה לאחר בדיקת מצב הלימודים.</p>
          <label className="block">זכאות למסלול הארכה של שני סמסטרים
            <select className={field} value={eligible?.eligible === undefined ? '' : String(eligible.eligible)}
              onChange={event => update({ eligibleStudent: { ...eligible, reference: eligible?.reference ?? '',
                eligible: event.target.value === '' ? undefined : event.target.value === 'true' } })}>
              <option value="">טרם דווח</option><option value="true">יש לי זכאות לפי מסמכי האוניברסיטה</option>
              <option value="false">אין לי זכאות למסלול זה</option>
            </select>
          </label>
          <label className="block">אסמכתה לזכאות למסלול ההארכה
            <input className={field} maxLength={500} value={eligible?.reference ?? ''}
              onChange={event => update({ eligibleStudent: { ...eligible, reference: event.target.value } })} />
          </label>
          {semesterDecisionFields('הארכה לתלמידה זכאית', eligible?.decision,
            decision => update({ eligibleStudent: { ...eligible, reference: eligible?.reference ?? '', decision } }))}
        </div>}
      </details>
    })}
    {needsLoad && <details>
      <summary className="cursor-pointer">היקף לימודים מלא לפי התוכנית המומלצת</summary>
      {semesterIds.map(semester => {
        const full = value.fullTimeLoadBySemester?.[semester]
        return <div key={semester} className="my-2">
          <label className="block">היקף מלא בשעות עבור {semesterTitleHe(semester)}
            <input className={field} type="number" min={0.5} max={100} step={0.5} value={full?.hours ?? ''}
              onChange={event => {
                const hours = event.target.valueAsNumber
                const values = { ...value.fullTimeLoadBySemester }
                if (Number.isFinite(hours) && hours > 0 && hours <= 100) values[semester] = { hours, reference: full?.reference ?? '' }
                else delete values[semester]
                onChange({ ...value, fullTimeLoadBySemester: values })
              }} />
          </label>
          {full && <label className="block">מקור להיקף הלימודים המלא
            <input className={field} maxLength={500} value={full.reference}
              onChange={event => onChange({ ...value, fullTimeLoadBySemester: {
                ...value.fullTimeLoadBySemester, [semester]: { ...full, reference: event.target.value },
              } })} />
          </label>}
        </div>
      })}
    </details>}
    {pastCourseIds.length > 0 && <details>
      <summary className="cursor-pointer">מועד לימוד של קורסים עם מגבלת זמן</summary>
      {pastCourseIds.filter(id => rules.some(rule => rule.course_ids.includes(id) &&
        ['year_restriction', 'offering_window', 'cohort_restriction'].includes(rule.kind))).map(id => <label key={id} className="block">
        סמסטר הלימודים של {courseNames[id] ?? id}
        <input className={field} type="number" min={1} max={40} value={value.courseStudySemesters?.[id] ?? ''}
          onChange={event => {
            const semester = event.target.valueAsNumber
            const values = { ...value.courseStudySemesters }
            if (Number.isInteger(semester) && semester >= 1 && semester <= 40) values[id] = semester
            else delete values[id]
            onChange({ ...value, courseStudySemesters: values })
          }} />
      </label>)}
    </details>}
    {prerequisiteIds.length > 0 && <details>
      <summary className="cursor-pointer">השתתפות וזכאות לבחינה בקורסי קדם</summary>
      <p className="my-1 text-[var(--text-muted)]">{currentlyTakenPrerequisiteIds
        ? 'מוצגות דרישות קדם הנלמדות כעת.'
        : 'מוצגים קורסים שדווחו כהושלמו או כנלמדים כעת.'} יש לדווח השתתפות וזכאות לבחינה בנפרד ולציין אסמכתה.</p>
      {prerequisiteIds.map(id => {
        const eligibility = value.prerequisiteEligibility?.[id]
        const update = (patch: Partial<NonNullable<typeof eligibility>>) => onChange({
          ...value, prerequisiteEligibility: { ...value.prerequisiteEligibility,
            [id]: { attended: false, examEligible: false, reference: '', ...eligibility, ...patch } },
        })
        return <div key={id} className="my-2 space-y-1">
          <p>{courseNames[id] ?? id} <span dir="ltr">{id}</span></p>
          <label className="block"><input type="checkbox" checked={eligibility?.attended === true}
            onChange={event => update({ attended: event.target.checked })} /> השתתפתי בקורס</label>
          <label className="block"><input type="checkbox" checked={eligibility?.examEligible === true}
            onChange={event => update({ examEligible: event.target.checked })} /> אני זכאי או זכאית להשתתף בבחינה</label>
          <label className="block">אסמכתה להשתתפות ולזכאות לבחינה עבור {courseNames[id] ?? id}
            <input className={field} maxLength={500} value={eligibility?.reference ?? ''}
              onChange={event => update({ reference: event.target.value })} />
          </label>
        </div>
      })}
    </details>}
    {decisionRules.map(rule => {
      const decision = value.decisions?.[rule.rule_id]
      const courses = rule.course_ids.map(id => courseNames[id] ? `${courseNames[id]} (${id})` : id).join(', ')
      const subject = courses || (rule.kind === 'study_duration' ? 'הארכת לימודים' :
        rule.params?.max_per_semester !== undefined ? 'רישום לקורסי תואר שני' : 'היקף לימודים מצומצם')
      const label = rule.params?.admission_interview ? 'התקבל אישור לאחר ראיון'
        : rule.params?.requires_supervisor_recommendation ? 'התקבלה המלצת מנחה לרישום ידני'
        : rule.params?.extension_years !== undefined ? 'קיבלתי אישור להארכת הלימודים'
        : rule.kind === 'load_limit' ? 'קיבלתי אישור לעומס או לקורסי תואר שני לפי התנאים'
        : 'האוניברסיטה אישרה עמידה בתוכנית המומלצת'
      return <div key={rule.rule_id} className="space-y-1 border-t border-[var(--border)] pt-2">
        <p>{subject}</p>
        <label className="block"><input type="checkbox" checked={decision?.approved === true}
          onChange={event => onChange({ ...value, decisions: { ...value.decisions, [rule.rule_id]: {
            approved: event.target.checked, reference: decision?.reference ?? '',
          } } })} /> {label}</label>
        <label className="block">אסמכתה לאישור עבור {subject}
          <input className={field} maxLength={500} value={decision?.reference ?? ''}
            onChange={event => onChange({ ...value, decisions: { ...value.decisions, [rule.rule_id]: {
              approved: decision?.approved ?? false, reference: event.target.value,
            } } })} />
        </label>
      </div>
    })}
  </fieldset>
}
