'use client'

import { useEffect, useState } from 'react'
import type { CourseInsightsResponse } from '../../../../api/ai/course_insights/types'

export type CourseInsightsFetch = (courseId: string, programId: string) => Promise<CourseInsightsResponse>

export type CourseInsightsState =
  | { status: 'idle' | 'loading' | 'error'; data: null }
  | { status: 'ready'; data: CourseInsightsResponse }

/** GET /api/ai/course-insights — grades, syllabus and suggestion chips for one course. */
export const fetchCourseInsights: CourseInsightsFetch = async (courseId, programId) => {
  const params = new URLSearchParams({ course_id: courseId, program_id: programId })
  const response = await fetch(`/api/ai/course-insights?${params}`)
  if (!response.ok) throw new Error(`course insights ${response.status}`)
  return response.json()
}

// Reopening a course in the same visit shows its insights instantly.
const loaded = new Map<string, CourseInsightsResponse>()

export function useCourseInsights(
  courseId: string | null,
  programId: string | undefined,
  fetchFn: CourseInsightsFetch = fetchCourseInsights,
): CourseInsightsState {
  const key = courseId && programId ? `${programId}:${courseId}` : null
  const [state, setState] = useState<CourseInsightsState>(() =>
    key && loaded.has(key) ? { status: 'ready', data: loaded.get(key)! } : { status: key ? 'loading' : 'idle', data: null })

  useEffect(() => {
    if (!key || !courseId || !programId) { setState({ status: 'idle', data: null }); return }
    const cached = loaded.get(key)
    if (cached) { setState({ status: 'ready', data: cached }); return }
    let live = true
    setState({ status: 'loading', data: null })
    fetchFn(courseId, programId).then(
      (data) => { loaded.set(key, data); if (live) setState({ status: 'ready', data }) },
      () => { if (live) setState({ status: 'error', data: null }) },
    )
    return () => { live = false }
  }, [key, courseId, programId, fetchFn])

  return state
}
