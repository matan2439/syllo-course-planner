'use client'

import { evaluateDegreeRules, type DegreeRule } from '../../../../shared/planner/degree-rules'
import type { RequirementsVM } from '../../../lib/requirements'
import type { DegreeEvidence } from '../../../../shared/planner/degree-evidence'
import DegreeEvidenceFields from './DegreeEvidenceFields'
import type { DegreeCatalogFacts } from '../../../../shared/planner/degree-catalog'

const LABELS: Record<string, string> = {
  distinct_categories: 'בחירה ממסלולים שונים', mutually_exclusive: 'חפיפה בין קורסים',
  year_restriction: 'שנת לימוד ותנאי קבלה', offering_window: 'מועד לימוד הקורס',
  language_requirement: 'קורסים באנגלית', cohort_restriction: 'תנאים אישיים',
  load_limit: 'היקף הלימודים', study_duration: 'משך הלימודים', prerequisite_policy: 'דרישות קדם',
  course_exemption: 'זכאות לפטור על סמך לימודים קודמים', course_recognition: 'הכרה בקורסים נוספים',
  optional_pathway: 'מסלול מקצועי לבחירה',
}

export function currentCourseIdsFromStatus(status: unknown): string[] {
  const rows = (status as { currently_taking?: unknown } | null)?.currently_taking
  return Array.isArray(rows) ? rows.flatMap(row => typeof row?.course_id === 'string' ? [row.course_id] : []) : []
}

export default function DegreeRulesPanel({ rules, requirements, trackCourseIds, evidence, catalogFacts, courseNames = {}, onEvidenceChange, semesters, completedCourseIds = [], currentCourseIds = [] }: {
  rules: readonly DegreeRule[]
  requirements?: RequirementsVM | null
  trackCourseIds?: readonly string[]
  evidence?: DegreeEvidence
  catalogFacts?: DegreeCatalogFacts
  courseNames?: Readonly<Record<string, string>>
  onEvidenceChange?: (evidence: DegreeEvidence) => void
  semesters: readonly { semesterId: string; courseIds: readonly string[] }[]
  completedCourseIds?: readonly string[]
  currentCourseIds?: readonly string[]
}) {
  if (!rules.length && !requirements) return null
  const results = evaluateDegreeRules(rules, {
    placements: semesters.flatMap(s => s.courseIds.map(courseId => ({ courseId, semesterId: s.semesterId }))),
    completedCourseIds, currentCourseIds, trackCourseIds, evidence,
    courseHours: catalogFacts?.courseHours, mandatorySemesters: catalogFacts?.mandatorySemesters,
    prerequisiteExpressions: catalogFacts?.prerequisiteExpressions,
  })
  return <details className="my-3 rounded-lg border border-[var(--border)] p-3" dir="rtl">
    <summary className="cursor-pointer font-semibold">כללי התואר</summary>
    {onEvidenceChange && <DegreeEvidenceFields rules={rules} value={evidence} courseNames={courseNames}
      semesterIds={semesters.filter(s => s.courseIds.length > 0).map(s => s.semesterId)}
      pastCourseIds={[...completedCourseIds, ...currentCourseIds]} currentlyTakenPrerequisiteIds={currentCourseIds}
      onChange={onEvidenceChange} />}
    {requirements && <ul className="my-2 list-inside list-disc space-y-1 text-sm">
      <li>סה״כ נדרש לתואר: {requirements.totalRequiredHours} ש״ס</li>
      {requirements.core.min > 0 && <li>לפחות {requirements.core.min} קורסי ליבה</li>}
      {requirements.categories.filter(c => c.minCourses > 0).map(c => <li key={c.id}>{c.title}: לפחות {c.minCourses} קורסים</li>)}
    </ul>}
    {results.length > 0 && <p className="my-2 text-sm text-[var(--text-muted)]">{results.filter(r => r.status === 'pass').length}/{results.length} בדיקות הושלמו. אישורים ותנאים אישיים מצריכים בדיקה נוספת.</p>}
    <ul className="space-y-2">{results.map((result, index) => <li key={result.rule_id} className="rounded border border-[var(--border)] p-2 text-sm">
      <strong>{LABELS[rules[index].kind] ?? 'תנאי נוסף לתואר'} · {result.status === 'pass' ? 'תקין' : result.status === 'fail' ? 'טרם הושלם' : 'נדרשת בדיקה'}</strong>
      <p>{result.explanation}</p>
    </li>)}</ul>
  </details>
}
