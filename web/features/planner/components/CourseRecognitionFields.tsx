'use client'
import { useState } from 'react'
import type { DegreeRule } from '../../../../shared/planner/degree-rules'
import type { DegreeEvidence } from '../../../../shared/planner/degree-evidence'
import type { CourseRecognitionReport } from '../../../../shared/planner/course-recognition'

function RecognitionRuleFields({ rule, value, courseNames, onChange }: {
  rule: DegreeRule; value: DegreeEvidence; courseNames: Readonly<Record<string, string>>
  onChange: (value: DegreeEvidence) => void
}) {
  const [newId, setNewId] = useState('')
  const reports = value.additionalCourseRecognition?.[rule.rule_id] ?? {}
  const save = (next: typeof reports) => onChange({ ...value, additionalCourseRecognition: {
    ...value.additionalCourseRecognition, [rule.rule_id]: next,
  } })
  const validId = /^\d{4}-\d{4}$/.test(newId) && !Object.prototype.hasOwnProperty.call(reports, newId)
  const field = 'block w-full rounded border border-[var(--border)] bg-[var(--surface)] p-1'
  return <details className="my-3 rounded border border-[var(--border)] p-3 text-sm">
    <summary>אישורים והכרה בקורסים משלימים</summary>
    <p>דווחו לפי החלטת האוניברסיטה. אישור ללמוד קורס לבדו אינו מזכה בשעות; נדרש גם רישום השלמה וזיכוי אישי.</p>
    <label className="block">מספר הקורס הנוסף
      <input className={field} dir="ltr" value={newId} placeholder="0512-0000" onChange={event => setNewId(event.target.value.trim())} />
    </label>
    <button type="button" disabled={!validId} onClick={() => {
      if (!validId) return
      save({ ...reports, [newId]: { useForDegreeCredit: false, scope: courseNames[newId] ? 'supplementary' : 'out_of_catalog',
        completed: false, priorApproval: false, approvalReference: '', syllabusReference: '', instructorConsentReference: '', officialCourseReference: '' } })
      setNewId('')
    }}>הוספת דיווח הכרה</button>
    {Object.entries(reports).map(([id, report]) => {
      const update = (patch: Partial<CourseRecognitionReport>) => save({ ...reports, [id]: { ...report, ...patch } })
      return <fieldset key={id} className="my-3 space-y-2 border-t border-[var(--border)] pt-2">
        <legend>{courseNames[id] ?? report.nameHe ?? id} <span dir="ltr">({id})</span></legend>
        <label className="block">שם הקורס לפי הרישום
          <input className={field} maxLength={200} value={report.nameHe ?? ''} onChange={event => update({ nameHe: event.target.value })} />
        </label>
        <label className="block"><input type="checkbox" checked={report.useForDegreeCredit}
          onChange={event => update({ useForDegreeCredit: event.target.checked })} /> להשתמש באישור הקורס בבדיקת התואר</label>
        <label className="block">סוג ההכרה
          <select className={field} value={report.scope} onChange={event => update({ scope: event.target.value === 'out_of_catalog' ? 'out_of_catalog' : 'supplementary' })}>
            <option value="supplementary">קורס משלים מתוך הקטלוג</option><option value="out_of_catalog">קורס מחוץ לקטלוג התוכנית</option>
          </select>
        </label>
        <label className="block"><input type="checkbox" checked={report.priorApproval}
          onChange={event => update({ priorApproval: event.target.checked })} /> ועדת ההוראה אישרה את ההכרה לפני לימוד הקורס</label>
        <label className="block"><input type="checkbox" checked={report.completed}
          onChange={event => update({ completed: event.target.checked })} /> הקורס הושלם והאוניברסיטה העניקה זיכוי שעות</label>
        {([
          ['approvalReference', 'אסמכתה לאישור ועדת ההוראה'], ['syllabusReference', 'אסמכתה לסילבוס שהוגש'],
          ['instructorConsentReference', 'אסמכתה להסכמת המרצה'], ['officialCourseReference', 'מקור רשמי לזהות הקורס'],
          ['creditAwardReference', 'אסמכתה לזיכוי שעות התואר'],
        ] as const).filter(([key]) => key !== 'creditAwardReference' || report.completed).map(([key, label]) => <label key={key} className="block">{label} {id}
          <input className={field} maxLength={500} value={report[key] ?? ''} onChange={event => update({ [key]: event.target.value })} />
        </label>)}
        {report.completed && <label className="block">שעות התואר שהוכרו בקורס {id}
          <input className={field} type="number" min={0} max={30} step={0.5} value={report.recognizedDegreeHours ?? ''} onChange={event => {
            const hours = event.target.valueAsNumber
            update({ recognizedDegreeHours: Number.isFinite(hours) && hours >= 0 && hours <= 30 ? hours : undefined })
          }} />
        </label>}
        {report.scope === 'out_of_catalog' && <>
          <label className="block">ממוצע הציונים בעת בקשת ההכרה {id}
            <input className={field} type="number" min={0} max={100} step={0.01} value={report.averageAtApproval ?? ''} onChange={event => {
              const average = event.target.valueAsNumber
              update({ averageAtApproval: Number.isFinite(average) && average >= 0 && average <= 100 ? average : undefined })
            }} />
          </label>
          <label className="block">אסמכתה חריגה לאישור מספר קורסים, אם נדרשת {id}
            <input className={field} maxLength={500} value={report.exceptionalLimitReference ?? ''} onChange={event => update({ exceptionalLimitReference: event.target.value })} />
          </label>
        </>}
        {report.completed && <label className="block">סמסטר הלימודים שבו הושלם הקורס {id}
          <input className={field} type="number" min={1} max={40} step={1} value={value.courseStudySemesters?.[id] ?? ''} onChange={event => {
            const semester = event.target.valueAsNumber, dates = { ...value.courseStudySemesters }
            if (Number.isInteger(semester) && semester >= 1 && semester <= 40) dates[id] = semester
            else delete dates[id]
            onChange({ ...value, courseStudySemesters: dates })
          }} />
        </label>}
        <button type="button" onClick={() => { const next = { ...reports }; delete next[id]; save(next) }}>הסרת דיווח ההכרה {id}</button>
      </fieldset>
    })}
  </details>
}

export default function CourseRecognitionFields(props: Omit<Parameters<typeof RecognitionRuleFields>[0], 'rule'> & { rules: readonly DegreeRule[] }) {
  return <>{props.rules.filter(rule => rule.kind === 'course_recognition').map(rule => <RecognitionRuleFields key={rule.rule_id} {...props} rule={rule} />)}</>
}
