import { useCallback, useEffect, useRef, useState } from 'react'
import type { CompletedStudies } from '../../../../shared/planner/student-workspace'
import { loadCompletedStudies, saveCompletedStudies } from '../lib/student-workspace-client'
import type { CompletedStudiesStore } from '../components/StudentWorkspaceTools'

/**
 * The "my studies" facts for one degree program and owner. One document per program, so the
 * years 1–2 and years 3+ boards read and write the same values. Saves are debounced and serialized.
 */
export function useCompletedStudies(programId: string, scope: string | null): CompletedStudiesStore | null {
  const [state, setState] = useState<{ scope: string; value: CompletedStudies | null } | null>(null)
  const revision = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const queue = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    if (!scope) return
    let live = true
    loadCompletedStudies(programId).then(({ revision: rev, data }) => {
      if (!live) return
      revision.current = rev
      setState({ scope, value: data })
    }, () => { /* unavailable: fields work for this visit only */ })
    return () => { live = false; clearTimeout(timer.current) }
  }, [programId, scope])
  const save = useCallback((value: CompletedStudies) => {
    setState((old) => old && { ...old, value })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      queue.current = queue.current.then(async () => {
        try { revision.current = await saveCompletedStudies(programId, revision.current, value) }
        catch {
          // Another tab or device saved first: these are plain facts, so the latest edit wins.
          try { revision.current = (await loadCompletedStudies(programId)).revision; revision.current = await saveCompletedStudies(programId, revision.current, value) }
          catch { /* outage: the visible value stays; the next edit retries */ }
        }
      })
    }, 750)
  }, [programId])
  return state && state.scope === scope ? { value: state.value, ready: true, save } : null
}
