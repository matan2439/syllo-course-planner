'use client'
import type { DegreeRule } from '../../../../shared/planner/degree-rules'
import type { DegreeEvidence } from '../../../../shared/planner/degree-evidence'

export default function LabCreditFields({ rules, value, selectedCourseIds, courseNames, onChange }: {
  rules: readonly DegreeRule[]; value: DegreeEvidence; selectedCourseIds: readonly string[]
  courseNames: Readonly<Record<string, string>>; onChange: (value: DegreeEvidence) => void
}) {
  return <>{rules.filter(rule => rule.params?.same_track_requires_third_lab === true).map(rule => {
    const labs = [...new Set(selectedCourseIds)].filter(id => rule.course_ids.includes(id))
    if (labs.length <= 2) return null
    const report = value.labCreditAllocations?.[rule.rule_id] ?? { creditedLabCourseIds: [], nonTheoryLabCourseIds: labs, reference: '' }
    const update = (patch: Partial<typeof report>) => onChange({ ...value,
      labCreditAllocations: { ...value.labCreditAllocations, [rule.rule_id]: { ...report, ...patch } },
    })
    const field = 'block w-full rounded border border-[var(--border)] bg-[var(--surface)] p-1'
    return <details key={rule.rule_id} className="my-3 rounded border border-[var(--border)] p-3 text-sm">
      <summary>זיכוי שעות עבור מעבדות נוספות</summary>
      <p>בחרו לפי הרישום שקיבלתם מהאוניברסיטה את שתי המעבדות המוכרות. המעבדות הנוספות לא יפחיתו את יתרת השעות הנדרשות בקורסים עיוניים.</p>
      {labs.map(id => <label key={id} className="block"><input type="checkbox" checked={report.creditedLabCourseIds.includes(id)} onChange={event => {
        const credited = new Set(report.creditedLabCourseIds)
        if (event.target.checked) credited.add(id)
        else credited.delete(id)
        update({ creditedLabCourseIds: [...credited], nonTheoryLabCourseIds: labs.filter(lab => !credited.has(lab)) })
      }} /> {courseNames[id] ?? id}</label>)}
      <label className="block">אסמכתה לאופן זיכוי שעות המעבדות
        <input className={field} maxLength={500} value={report.reference} onChange={event => update({ reference: event.target.value })} />
      </label>
      <label className="block">שעות תואר נוספות שהוכרו מעבר לקורסים המזוהים, ללא המעבדות הנוספות
        <input className={field} type="number" min={0} max={400} step={0.5} value={report.otherRecognizedDegreeHours ?? ''} onChange={event => {
          const hours = event.target.valueAsNumber
          update({ otherRecognizedDegreeHours: Number.isFinite(hours) && hours >= 0 && hours <= 400 ? hours : undefined })
        }} />
      </label>
      {report.otherRecognizedDegreeHours !== undefined && <label className="block">אסמכתה לשעות הנוספות בלבד
        <input className={field} maxLength={500} value={report.otherCreditReference ?? ''} onChange={event => update({ otherCreditReference: event.target.value })} />
      </label>}
    </details>
  })}</>
}
