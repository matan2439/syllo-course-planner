'use client'

import type { TimeSlot } from '../../../shared/planner/schedule'

const DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'] as const
const HOURS = Array.from({ length: 14 }, (_, i) => 8 + i) // 08:00..21:00
const ROW_HEIGHT = 48 // px per hour
const GUTTER_WIDTH = '4rem'
const GRID_TEMPLATE_COLUMNS = `${GUTTER_WIDTH} repeat(6, minmax(6rem, 1fr))`
const CELL_BORDER = '1px solid var(--border)'

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
        className="weekly-grid-layout"
        style={{ minWidth: `calc(${GUTTER_WIDTH} + 6 * 6rem)`, border: CELL_BORDER, borderRadius: '0.5rem', overflow: 'hidden' }}
      >
        {/* Day-of-week header row. */}
        <div className="grid" style={{ gridTemplateColumns: GRID_TEMPLATE_COLUMNS }}>
          <div aria-hidden="true" style={{ borderBottom: CELL_BORDER, background: 'var(--surface)' }} />
          {DAYS.map((day, i) => (
            <div
              key={day}
              className="text-center text-sm font-semibold py-1.5"
              style={{
                borderBottom: CELL_BORDER,
                borderInlineStart: i > 0 ? CELL_BORDER : 'none',
                background: 'var(--surface)',
              }}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Hour × day body: an hour-label gutter plus a fully bordered 6x14 cell grid, with blocks overlaid absolutely on top. */}
        <div
          role="grid"
          aria-label="מערכת שעות שבועית"
          className="weekly-grid-hours relative grid"
          style={{
            gridTemplateColumns: GRID_TEMPLATE_COLUMNS,
            gridTemplateRows: `repeat(${HOURS.length}, ${ROW_HEIGHT}px)`,
          }}
        >
          {HOURS.map((hour, i) => (
            <div
              key={`hour-${hour}`}
              aria-hidden="true"
              className="flex items-start justify-center pt-1 text-xs text-[var(--text-muted)]"
              style={{
                gridColumn: 1,
                gridRow: i + 1,
                borderBottom: CELL_BORDER,
              }}
            >
              {`${hour}:00`}
            </div>
          ))}

          {HOURS.map((hour, hourIndex) =>
            DAYS.map((day, dayIndex) => (
              <div
                key={`cell-${day}-${hour}`}
                aria-hidden="true"
                className="weekly-grid-cell"
                style={{
                  gridColumn: dayIndex + 2,
                  gridRow: hourIndex + 1,
                  borderBottom: CELL_BORDER,
                  borderInlineStart: dayIndex > 0 ? CELL_BORDER : 'none',
                }}
              />
            )),
          )}

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
                className="weekly-grid-block absolute rounded px-1 text-xs overflow-hidden border border-[var(--purple-strong)] bg-[var(--purple)]/15"
                style={{
                  top: `${top}px`,
                  height: `${height}px`,
                  right: `calc(${GUTTER_WIDTH} + ${dayIndex} * (100% - ${GUTTER_WIDTH}) / 6)`,
                  width: `calc((100% - ${GUTTER_WIDTH}) / 6)`,
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
