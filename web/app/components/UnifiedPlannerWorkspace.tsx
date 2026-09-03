'use client'

import { useEffect, useRef, useState } from 'react'
import type { RepositoryVM } from '../../lib/repository'
import NativePlannerJourney, { type ManualAddIntent } from './NativePlannerJourney'
import UnifiedCourseRepository from './UnifiedCourseRepository'

type WorkspaceView = 'board' | 'repository' | 'agent'

const VIEWS: Array<{ id: WorkspaceView; label: string }> = [
  { id: 'board', label: 'לוח סמסטרים' },
  { id: 'repository', label: 'מאגר קורסים' },
  { id: 'agent', label: 'עוזר אקדמי' },
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
  const [activeView, setActiveView] = useState<WorkspaceView>('board')
  const [repositoryOpen, setRepositoryOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const [manualAddIntent, setManualAddIntent] = useState<ManualAddIntent | null>(null)
  const [committedCourseIds, setCommittedCourseIds] = useState<readonly string[]>(selectedCourseIds)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const repositoryToggleRef = useRef<HTMLButtonElement | null>(null)
  const agentToggleRef = useRef<HTMLButtonElement | null>(null)
  const repositoryCloseRef = useRef<HTMLButtonElement | null>(null)
  const repositoryWasOpen = useRef(false)
  const agentCloseRef = useRef<HTMLButtonElement | null>(null)
  const agentWasOpen = useRef(false)

  const selectView = (view: WorkspaceView, focus = false) => {
    setActiveView(view)
    if (view === 'repository') setRepositoryOpen(true)
    if (view === 'agent') setAgentOpen(true)
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

  const requestAdd = (courseId: string, semesterId?: string) => {
    const course = repo.categories.flatMap((category) => category.courses).find((item) => item.id === courseId)
    const offered = new Set((course?.offered ?? []).map((value) => value.toLowerCase()))
    const semesterIds = ['year_3_semester_a', 'year_3_semester_b', 'year_4_semester_a', 'year_4_semester_b']
      .filter((semesterId) => offered.has(semesterId) || offered.has(semesterId.endsWith('_a') ? 'a' : 'b'))
    setManualAddIntent({ courseId, semesterIds: semesterId ? [semesterId] : semesterIds })
    onRequestAdd(courseId)
    selectView('board')
  }

  const closeRepository = () => {
    setRepositoryOpen(false)
    setActiveView(agentOpen ? 'agent' : 'board')
    repositoryToggleRef.current?.focus()
  }

  const closeAgent = () => {
    setAgentOpen(false)
    setActiveView(repositoryOpen ? 'repository' : 'board')
    agentToggleRef.current?.focus()
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (agentOpen) {
        closeAgent()
      } else if (repositoryOpen) {
        closeRepository()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [agentOpen, repositoryOpen])

  useEffect(() => {
    if (repositoryOpen && !repositoryWasOpen.current) repositoryCloseRef.current?.focus()
    repositoryWasOpen.current = repositoryOpen
  }, [repositoryOpen])

  useEffect(() => {
    if (agentOpen && !agentWasOpen.current) agentCloseRef.current?.focus()
    agentWasOpen.current = agentOpen
  }, [agentOpen])

  const toggleRepository = () => {
    if (repositoryOpen) closeRepository()
    else {
      setRepositoryOpen(true)
      setActiveView('repository')
    }
  }

  const toggleAgent = () => {
    if (agentOpen) closeAgent()
    else {
      setAgentOpen(true)
      setActiveView('agent')
    }
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
            aria-controls={view.id === 'repository' ? 'workspace-panel-repository' : 'workspace-panel-journey'}
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
                ? 'bg-[#7c3aed] text-white'
                : 'border border-[var(--border)] bg-[var(--surface)]'
            }`}
          >
            {view.label}
          </button>
        ))}
      </div>

      <div className="planner-drawer-controls" aria-label="כלי תכנון">
        <button
          ref={repositoryToggleRef}
          type="button"
          aria-controls="workspace-panel-repository"
          aria-expanded={repositoryOpen}
          aria-label={`${repositoryOpen ? 'סגור' : 'פתח'} מאגר קורסים`}
          onClick={toggleRepository}
          className="planner-drawer-toggle planner-drawer-toggle-repository"
        >
          <span aria-hidden="true">☰</span>
          <span>קורסים</span>
        </button>
        <button
          ref={agentToggleRef}
          type="button"
          aria-controls="workspace-agent-drawer"
          aria-expanded={agentOpen}
          aria-label={`${agentOpen ? 'סגור' : 'פתח'} עוזר AI`}
          onClick={toggleAgent}
          className="planner-drawer-toggle planner-drawer-toggle-agent"
        >
          <span aria-hidden="true">✦</span>
          <span>עוזר AI</span>
        </button>
      </div>

      <div
        className="planner-workbench min-w-0"
        data-mobile-surface={activeView}
        data-layout={repositoryOpen || agentOpen ? 'drawer-split' : 'board'}
        data-repository-open={repositoryOpen}
        data-agent-open={agentOpen}
      >
        <div
          id="workspace-panel-journey"
          role="tabpanel"
          aria-labelledby={`workspace-tab-${activeView === 'agent' ? 'agent' : 'board'}`}
          data-mobile-surface={activeView}
          data-board-surface="persistent-drop-target"
          aria-label="לוח סמסטרים פעיל"
          className="planner-board-canvas planner-agent-drawer min-w-0"
        >
          <NativePlannerJourney
            programId={programId}
            useAcademicDecisionAgent
            initializePlanningContext
            onCloseAgent={closeAgent}
            agentCloseRef={agentCloseRef}
            manualAddIntent={manualAddIntent}
            onManualAddSettled={() => setManualAddIntent(null)}
            onCommittedCourseIdsChange={setCommittedCourseIds}
          />
        </div>
        <aside
          id="workspace-panel-repository"
          role="tabpanel"
          aria-labelledby="workspace-tab-repository"
          data-open={repositoryOpen}
          aria-hidden={!repositoryOpen}
          className={`${activeView === 'repository' ? '' : 'hidden lg:block'} planner-repository-rail min-w-0`}
        >
          <button
            ref={repositoryCloseRef}
            type="button"
            aria-label="סגור סרגל מאגר קורסים"
            onClick={closeRepository}
            className="planner-drawer-close mb-3"
          >
            × <span>סגור מאגר</span>
          </button>
          <UnifiedCourseRepository
            repo={repo}
            selectedCourseIds={committedCourseIds}
            semesterDestinations={[
              { id: 'year_3_semester_a', label: 'שנה ג׳ — סמסטר א׳' },
              { id: 'year_3_semester_b', label: 'שנה ג׳ — סמסטר ב׳' },
              { id: 'year_4_semester_a', label: 'שנה ד׳ — סמסטר א׳' },
              { id: 'year_4_semester_b', label: 'שנה ד׳ — סמסטר ב׳' },
            ]}
            onRequestAdd={requestAdd}
          />
        </aside>
      </div>
    </section>
  )
}
