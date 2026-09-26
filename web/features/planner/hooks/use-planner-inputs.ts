import { useCallback, useState } from 'react'
import type { ChatMsg } from '../types'

/** What the student has picked so far. It is only RECORDED here; the assistant conversation owns generation. */
export function usePlannerInputs() {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [maxHours, setMaxHours] = useState('')
  const [priorHours, setPriorHours] = useState('')
  // Category id → courses completed there that the student counted but did not name (e.g. שער רוח).
  const [completedCategoryCounts, setCompletedCategoryCounts] = useState<Record<string, number>>({})
  const [wantIds, setWantIds] = useState<string[]>([])
  const [excludeIds, setExcludeIds] = useState<string[]>([])
  // Exclusions: a non-empty selection is inherently explicit; an empty one is
  // only an answer once the student says so. Untouched stays UNKNOWN.
  const [exclusionsNoneConfirmed, setExclusionsNoneConfirmed] = useState(false)
  const [preferenceVersion, setPreferenceVersion] = useState(0)

  const updatePreferenceVersion = useCallback(() => {
    setPreferenceVersion((v) => v + 1) // preference edits invalidate old proposals
  }, [])

  return {
    messages, setMessages,
    maxHours, setMaxHours, priorHours, setPriorHours,
    completedCategoryCounts, setCompletedCategoryCounts,
    wantIds, setWantIds, excludeIds, setExcludeIds,
    exclusionsNoneConfirmed, setExclusionsNoneConfirmed,
    preferenceVersion, updatePreferenceVersion,
  }
}
