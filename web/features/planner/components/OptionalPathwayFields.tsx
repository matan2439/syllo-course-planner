'use client'
import type { DegreeRule } from '../../../../shared/planner/degree-rules'
import type { DegreeEvidence } from '../../../../shared/planner/degree-evidence'

export default function OptionalPathwayFields({ rules, value, courseNames, onChange }: {
  rules: readonly DegreeRule[]; value: DegreeEvidence; courseNames: Readonly<Record<string, string>>
  onChange: (value: DegreeEvidence) => void
}) {
  return <>{rules.filter(rule => rule.kind === 'optional_pathway').map(rule => {
    const params = rule.params ?? {}, goal = params.optional_goal
    if (typeof goal !== 'string') return null
    const selected = value.optionalGoals?.includes(goal) ?? false
    const projects = Array.isArray(params.project_course_ids) ? params.project_course_ids.filter((id): id is string => typeof id === 'string') : []
    const domain = typeof params.project_domain === 'string' ? params.project_domain : ''
    const label = typeof params.goal_label_he === 'string' ? params.goal_label_he : goal
    const domainLabel = typeof params.project_domain_label_he === 'string' ? params.project_domain_label_he : domain
    return <details key={rule.rule_id}>
      <summary>מסלולים מקצועיים לבחירה — {label}</summary>
      <label><input type="checkbox" checked={selected} onChange={event => {
        const goals = new Set(value.optionalGoals)
        if (event.target.checked) goals.add(goal)
        else goals.delete(goal)
        onChange({ ...value, optionalGoals: [...goals] })
      }} /> ברצוני לתכנן את {label}</label>
      {selected && <>
        <p>הבדיקה מתייחסת למסלול הלימודים שפרסמה האוניברסיטה. היא אינה מעניקה רישיון מקצועי.</p>
        {projects.map(id => {
          const report = value.projectDomains?.[id]
          return <div key={id} className="my-2">
            <label className="block">תחום הפרויקט של {courseNames[id] ?? id}
              <select value={report?.domain ?? ''} onChange={event => {
                const reports = { ...value.projectDomains }
                if (event.target.value) reports[id] = { domain: event.target.value, reference: report?.reference ?? '' }
                else delete reports[id]
                onChange({ ...value, projectDomains: reports })
              }}>
                <option value="">טרם דווח</option><option value={domain}>{domainLabel}</option><option value="other">תחום אחר</option>
              </select>
            </label>
            {report && <label className="block">אסמכתה לתחום הפרויקט של {courseNames[id] ?? id}
              <input maxLength={500} value={report.reference} onChange={event => onChange({ ...value,
                projectDomains: { ...value.projectDomains, [id]: { ...report, reference: event.target.value } },
              })} />
            </label>}
          </div>
        })}
      </>}
    </details>
  })}</>
}
