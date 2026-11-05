'use client'

import { evaluateDegreeRules, type DegreeRule } from '../../../../shared/planner/degree-rules'

const LABELS: Record<string, string> = {
  distinct_categories: 'בחירה ממסלולים שונים', mutually_exclusive: 'חפיפה בין קורסים',
  year_restriction: 'שנת לימוד ותנאי קבלה', offering_window: 'מועד לימוד הקורס',
  language_requirement: 'קורסים באנגלית', cohort_restriction: 'תנאים אישיים',
  load_limit: 'היקף הלימודים', study_duration: 'משך הלימודים', prerequisite_policy: 'דרישות קדם',
}

export default function DegreeRulesPanel({ rules, semesters, completedCourseIds = [], currentCourseIds = [] }: {
  rules: readonly DegreeRule[]
  semesters: readonly { semesterId: string; courseIds: readonly string[] }[]
  completedCourseIds?: readonly string[]
  currentCourseIds?: readonly string[]
}) {
  if (!rules.length) return null
  const results = evaluateDegreeRules(rules, {
    placements: semesters.flatMap(s => s.courseIds.map(courseId => ({ courseId, semesterId: s.semesterId }))),
    completedCourseIds, currentCourseIds,
  })
  return <details className="my-3 rounded-lg border border-[var(--border)] p-3" dir="rtl">
    <summary className="cursor-pointer font-semibold">כללי התואר — {results.filter(r => r.status === 'pass').length}/{results.length} בדיקות הושלמו</summary>
    <p className="my-2 text-sm text-[var(--text-muted)]">הבדיקה מתייחסת ללוח המוצג ולקורסים שסומנו בלימודים שלי. אישורים ותנאים אישיים שמצריכים בדיקה נוספת אינם מאושרים אוטומטית.</p>
    <ul className="space-y-2">{results.map((result, index) => <li key={result.rule_id} className="rounded border border-[var(--border)] p-2 text-sm">
      <strong>{LABELS[rules[index].kind] ?? 'תנאי נוסף לתואר'} · {result.status === 'pass' ? 'תקין' : result.status === 'fail' ? 'טרם הושלם' : 'נדרשת בדיקה'}</strong>
      <p>{result.explanation}</p>
    </li>)}</ul>
  </details>
}
