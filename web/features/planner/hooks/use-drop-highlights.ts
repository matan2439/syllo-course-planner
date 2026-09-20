import { useCallback, useEffect, useRef, useState } from 'react'

type Highlight = { semesterId: string; key: number }

/** A semester highlight that switches itself off after `durationMs`. */
function useTransientHighlight(durationMs: number) {
  const [value, setValue] = useState<Highlight | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback((semesterId: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const key = Date.now()
    setValue({ semesterId, key })
    timerRef.current = setTimeout(() => {
      setValue((current) => current?.key === key ? null : current)
      timerRef.current = null
    }, durationMs)
  }, [durationMs])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  return [value, show] as const
}

/**
 * Brief board feedback for manual edits.
 *
 * A server refusal happens after the browser's local drag preview has
 * disappeared, so `rejectedDrop` keeps the refused target highlighted for a
 * moment and the user can connect the written explanation with the semester
 * they attempted. `justPlaced` mirrors it for success: it flashes the semester
 * a manual add/move actually landed in.
 */
export function useDropHighlights() {
  const [rejectedDrop, showRejectedDrop] = useTransientHighlight(1100)
  const [justPlaced, showJustPlaced] = useTransientHighlight(500)
  return { rejectedDrop, justPlaced, showRejectedDrop, showJustPlaced }
}
