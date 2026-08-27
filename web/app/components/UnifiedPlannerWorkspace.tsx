'use client'

import { useRef, useState } from 'react'
import type { RepositoryVM } from '../../lib/repository'
import NativePlannerJourney from './NativePlannerJourney'
import UnifiedCourseRepository from './UnifiedCourseRepository'

type WorkspaceView = 'planner' | 'repository'

const VIEWS: Array<{ id: WorkspaceView; label: string }> = [
  { id: 'planner', label: 'לוח ועוזר' },
  { id: 'repository', label: 'מאגר קורסים' },
]

export default function UnifiedPlannerWorkspace({
  programId,
  repo,
  selectedCourseIds = [],
  onRequestAdd = () => undefined,
}: {
  programId: string
  repo: RepositoryVM
  selectedCourseIds?: readonly string[]
  onRequestAdd?: (courseId: string) => void
}) {
  const [activeView, setActiveView] = useState<WorkspaceView>('planner')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  const selectView = (view: WorkspaceView, focus = false) => {
    setActiveView(view)
    if (focus) {
      const index = VIEWS.findIndex((item) => item.id === view)
      tabRefs.current[index]?.focus()
    }
  }

  const onTabKeyDown = (index: number, key: string) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return
    let next = index
    if (key === 'Home') next = 0
    else if (key === 'End') next = VIEWS.length - 1
    else if (key === 'ArrowRight') next = (index - 1 + VIEWS.length) % VIEWS.length
    else next = (index + 1) % VIEWS.length
    selectView(VIEWS[next].id, true)
  }

  return (
    <section
      role="region"
      aria-label="מרחב תכנון מאוחד"
      dir="rtl"
      className="flex flex-col gap-5"
    >
      <div>
        <h1 className="text-xl font-bold tracking-tight">מרחב התכנון</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          הלוח, מאגר הקורסים ועוזר התכנון עובדים כאן כחלקים של אותו מוצר.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="אזורי מרחב התכנון"
        className="flex gap-2 lg:hidden"
      >
        {VIEWS.map((view, index) => (
          <button
            key={view.id}
            ref={(node) => { tabRefs.current[index] = node }}
            type="button"
            role="tab"
            id={`workspace-tab-${view.id}`}
            aria-controls={`workspace-panel-${view.id}`}
            aria-selected={activeView === view.id}
            tabIndex={activeView === view.id ? 0 : -1}
            onClick={() => selectView(view.id)}
            onKeyDown={(event) => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault()
                onTabKeyDown(index, event.key)
              }
            }}
            className={`rounded-full px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)] ${
              activeView === view.id
                ? 'bg-[var(--purple-strong)] text-white'
                : 'border border-[var(--border)] bg-[var(--surface)]'
            }`}
          >
            {view.label}
          </button>
        ))}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div
          id="workspace-panel-planner"
          role="tabpanel"
          aria-labelledby="workspace-tab-planner"
          className={activeView === 'planner' ? 'min-w-0' : 'hidden min-w-0 lg:block'}
        >
          <NativePlannerJourney programId={programId} useAcademicDecisionAgent />
        </div>
        <aside
          id="workspace-panel-repository"
          role="tabpanel"
          aria-labelledby="workspace-tab-repository"
          className={activeView === 'repository' ? 'min-w-0' : 'hidden min-w-0 lg:block'}
        >
          <UnifiedCourseRepository
            repo={repo}
            selectedCourseIds={selectedCourseIds}
            onRequestAdd={onRequestAdd}
          />
        </aside>
      </div>
    </section>
  )
}
