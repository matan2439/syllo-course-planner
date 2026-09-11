'use client'

import type { TimeSlot } from '../../../shared/planner/schedule'

const DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'] as const
const HOURS = Array.from({ length: 14 }, (_, i) => 8 + i) // 08:00..21:00
const ROW_HEIGHT = 40 // px per hour

export interface GridBlock {
  key: string
  courseId: string
  courseName: string
  groupId: string
  kind: string
  slot: TimeSlot
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export default function WeeklyScheduleGrid({ blocks }: { blocks: GridBlock[] }) {
  const gridStartMinutes = HOURS[0] * 60

  return (
    <div className="weekly-grid-wrapper overflow-x-auto">
      <div
        className="weekly-grid-layout grid"
        style={{ gridTemplateColumns: '4rem repeat(6, minmax(6rem, 1fr))' }}
      >
        <div aria-hidden="true" />
        {DAYS.map((day) => (
          <div key={day} className="text-center text-sm font-semibold py-1">
            {day}
          </div>
        ))}
        <div
          role="grid"
          aria-label="מערכת שעות שבועית"
          className="weekly-grid-hours relative"
          style={{ gridColumn: '1 / -1', height: `${HOURS.length * ROW_HEIGHT}px` }}
        >
          {HOURS.map((hour, i) => (
            <div
              key={hour}
              aria-hidden="true"
              className="absolute right-0 text-xs text-[var(--text-muted)]"
              style={{ top: `${i * ROW_HEIGHT}px` }}
            >
              {`${hour}:00`}
            </div>
          ))}
          {blocks.map((block) => {
            const dayIndex = DAYS.indexOf(block.slot.day as (typeof DAYS)[number])
            if (dayIndex === -1) return null
            const top = ((toMinutes(block.slot.start) - gridStartMinutes) / 60) * ROW_HEIGHT
            const height = Math.max(
              ((toMinutes(block.slot.end) - toMinutes(block.slot.start)) / 60) * ROW_HEIGHT,
              16,
            )
            return (
              <div
                key={block.key}
                role="gridcell"
                aria-label={`${block.courseName}, ${block.kind}, יום ${block.slot.day}, ${block.slot.start}-${block.slot.end}`}
                className="weekly-grid-block absolute rounded px-1 text-xs overflow-hidden bg-[var(--accent-soft,#c7d2fe)]"
                style={{
                  top: `${top}px`,
                  height: `${height}px`,
                  left: `calc(4rem + ${dayIndex} * (100% - 4rem) / 6)`,
                  width: `calc((100% - 4rem) / 6)`,
                }}
              >
                <div className="font-semibold truncate">{block.courseName}</div>
                <div className="truncate">{block.kind} · {block.slot.start}–{block.slot.end}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
