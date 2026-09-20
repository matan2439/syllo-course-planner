import { useCallback, useState } from 'react'
import type { ChatMsg } from '../types'

/**
 * What the student has typed or picked so far. It is only RECORDED here:
 * nothing in this hook ever triggers a build.
 */
export function usePlannerInputs() {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [draftText, setDraftText] = useState('')
  const [maxHours, setMaxHours] = useState('')
  const [priorHours, setPriorHours] = useState('')
  const [wantIds, setWantIds] = useState<string[]>([])
  const [excludeIds, setExcludeIds] = useState<string[]>([])
  // Exclusions: a non-empty selection is inherently explicit; an empty one is
  // only an answer once the student says so. Untouched stays UNKNOWN.
  const [exclusionsNoneConfirmed, setExclusionsNoneConfirmed] = useState(false)
  const [preferenceVersion, setPreferenceVersion] = useState(0)

  const updatePreferenceVersion = useCallback(() => {
    setPreferenceVersion((v) => v + 1) // preference edits invalidate old proposals
  }, [])

  const sendMessage = () => {
    const text = draftText.trim()
    if (!text) return
    setMessages((m) => [
      ...m,
      { role: 'user', text },
      { role: 'system', text: 'ההודעה נשמרה. לחצו "בנה תוכנית" כדי לייצר הצעה מהשיחה וההעדפות.' },
    ])
    setDraftText('')
  }

  return {
    messages, setMessages, draftText, setDraftText, sendMessage,
    maxHours, setMaxHours, priorHours, setPriorHours,
    wantIds, setWantIds, excludeIds, setExcludeIds,
    exclusionsNoneConfirmed, setExclusionsNoneConfirmed,
    preferenceVersion, updatePreferenceVersion,
  }
}
