'use client'
import type { DegreeRule } from '../../../../shared/planner/degree-rules'
import type { DegreeEvidence } from '../../../../shared/planner/degree-evidence'

export default function TechnicianExemptionFields({ rules, value, courseNames, onChange }: {
  rules: readonly DegreeRule[]; value: DegreeEvidence; courseNames: Readonly<Record<string, string>>
  onChange: (value: DegreeEvidence) => void
}) {
  const field = 'block w-full rounded border border-[var(--border)] bg-[var(--surface)] p-1'
  return <>{rules.filter(rule => rule.kind === 'course_exemption').map(rule => {
    const report = value.technicianExemptions?.[rule.rule_id] ?? {}
    const update = (patch: Partial<typeof report>) => onChange({ ...value,
      technicianExemptions: { ...value.technicianExemptions, [rule.rule_id]: { ...report, ...patch } },
    })
    const byCredential = rule.params?.eligible_course_ids_by_credential as Record<string, string[]> | undefined
    const labels = rule.params?.credential_labels_he as Record<string, string> | undefined
    const ids = byCredential?.[report.credential ?? ''] ?? []
    return <details key={rule.rule_id} className="my-3 rounded border border-[var(--border)] p-3 text-sm">
      <summary>פטורים לבעלי תעודת הנדסאי</summary>
      <p>זכאות אינה מעניקה פטור אוטומטי. יש לדווח רק על פטור אישי שהאוניברסיטה העניקה ועל שעות התואר שהוכרו בו.</p>
      <label className="block">סוג תעודת הנדסאי
        <select className={field} value={report.credential ?? ''} onChange={event => {
          const credential = event.target.value || undefined
          const eligible = new Set(byCredential?.[credential ?? ''] ?? [])
          update({ credential, awards: Object.fromEntries(Object.entries(report.awards ?? {}).map(([id, award]) =>
            [id, eligible.has(id) ? award : { ...award, approved: false }])) })
        }}>
          <option value="">לא נעשה שימוש בפטור</option>
          {Object.keys(byCredential ?? {}).map(key => <option key={key} value={key}>{labels?.[key] ?? key}</option>)}
        </select>
      </label>
      {report.credential && <>
        <label className="block">ממוצע בחינת הגמר הממשלתית ללא הפרויקט
          <input className={field} type="number" min={0} max={100} step={0.01} value={report.governmentExamAverage ?? ''} onChange={event => {
            const average = event.target.valueAsNumber
            update({ governmentExamAverage: Number.isFinite(average) && average >= 0 && average <= 100 ? average : undefined })
          }} />
        </label>
        <label className="block"><input type="checkbox" checked={report.excludesProject === true}
          onChange={event => update({ excludesProject: event.target.checked })} /> הממוצע המדווח אינו כולל את הפרויקט</label>
        {ids.map(id => {
          const award = report.awards?.[id] ?? { approved: false, reference: '' }
          const updateAward = (patch: Partial<typeof award>) => update({ awards: { ...report.awards, [id]: { ...award, ...patch } } })
          return <div key={id} className="my-2">
            <label className="block"><input type="checkbox" checked={award.approved} onChange={event => updateAward({ approved: event.target.checked })} />
              האוניברסיטה העניקה לי פטור מ־{courseNames[id] ?? id} <span dir="ltr">({id})</span>
            </label>
            {award.approved && <>
              <label className="block">שעות התואר שהוכרו בפטור {id}
                <input className={field} type="number" min={0} max={30} step={0.5} value={award.degreeCreditHours ?? ''} onChange={event => {
                  const hours = event.target.valueAsNumber
                  updateAward({ degreeCreditHours: Number.isFinite(hours) && hours >= 0 && hours <= 30 ? hours : undefined })
                }} />
              </label>
              <label className="block">אסמכתה להענקת הפטור ולזיכוי השעות {id}
                <input className={field} maxLength={500} value={award.reference} onChange={event => updateAward({ reference: event.target.value })} />
              </label>
            </>}
          </div>
        })}
      </>}
    </details>
  })}</>
}
