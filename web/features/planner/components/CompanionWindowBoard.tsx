'use client'

import { boardModelToVM } from '../../../lib/planner/board-vm'
import { defaultCommittedBoard, defaultGetBoard } from '../lib/api-defaults'
import { useCommittedBoard } from '../hooks/use-committed-board'
import { useLocale } from '../../locale/LocaleProvider'
import NativePlannerBoard from './NativePlannerBoard'

/**
 * The other two-year window's board (its committed plan over its catalog), shown read-only beside
 * the editable one so the whole degree scrolls as one row. Each window stays its own planning
 * universe: editing happens only after switching to that window.
 */
export default function CompanionWindowBoard({ boardId, placement }: { boardId: string; placement: 'before' | 'after' }) {
  const { t } = useLocale()
  const { boardPhase, current } = useCommittedBoard({
    programId: boardId, getBoardFn: defaultGetBoard, committedBoardFn: defaultCommittedBoard,
  })
  // A separator toward the editable board: in reading order the companion sits before (or after) it.
  const edge = placement === 'before' ? 'border-e-2' : 'border-s-2'
  return (
    <div
      data-companion-board={boardId}
      title={t('לצפייה בלבד — לעריכה בחרו את השנים האלה', 'View only — pick these years to edit them')}
      className={`flex shrink-0 items-start border-dashed border-[var(--border)] opacity-80 ${edge}`}
    >
      {current
        ? <NativePlannerBoard board={boardModelToVM(current)} readOnly chrome={false} />
        : <p className="p-4 text-xs text-[var(--text-muted)]">{boardPhase === 'error' ? t('לא ניתן לטעון את השנים האלה', 'Could not load these years') : t('טוען…', 'Loading…')}</p>}
    </div>
  )
}
