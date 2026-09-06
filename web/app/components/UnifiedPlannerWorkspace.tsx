'use client'

import { useEffect, useRef, useState } from 'react'
import type { RepositoryVM } from '../../lib/repository'
import NativePlannerJourney, { type ManualAddIntent } from './NativePlannerJourney'
import UnifiedCourseRepository, { type SemesterDestination } from './UnifiedCourseRepository'
import type { PlannerDragPayload } from '../../lib/planner/drag-payload'

type WorkspaceView = 'board' | 'repository' | 'agent'

const DEFAULT_SEMESTER_DESTINATIONS: readonly SemesterDestination[] = [
  { id: 'year_3_semester_a', label: 'שנה ג׳ — סמסטר א׳' },
  { id: 'year_3_semester_b', label: 'שנה ג׳ — סמסטר ב׳' },
  { id: 'year_4_semester_a', label: 'שנה ד׳ — סמסטר א׳' },
  { id: 'year_4_semester_b', label: 'שנה ד׳ — סמסטר ב׳' },
]

export default function UnifiedPlannerWorkspace({
  programId,
  repo,
  selectedCourseIds = [],
  onRequestAdd = () => undefined,
  semesterDestinations = DEFAULT_SEMESTER_DESTINATIONS,
}: {
  programId: string
  repo: RepositoryVM
  selectedCourseIds?: readonly string[]
  onRequestAdd?: (courseId: string) => void
  semesterDestinations?: readonly SemesterDestination[]
}) {
  const [activeView, setActiveView] = useState<WorkspaceView>('board')
  const [repositoryOpen, setRepositoryOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const [manualAddIntent, setManualAddIntent] = useState<ManualAddIntent | null>(null)
  const [committedCourseIds, setCommittedCourseIds] = useState<readonly string[]>(selectedCourseIds)
  const [activeDrag, setActiveDrag] = useState<PlannerDragPayload | null>(null)
  const repositoryToggleRef = useRef<HTMLButtonElement | null>(null)
  const agentToggleRef = useRef<HTMLButtonElement | null>(null)
  const repositoryCloseRef = useRef<HTMLButtonElement | null>(null)
  const repositoryWasOpen = useRef(false)
  const agentCloseRef = useRef<HTMLButtonElement | null>(null)
  const agentWasOpen = useRef(false)

  const selectView = (view: WorkspaceView) => {
    setActiveView(view)
    if (view === 'repository') setRepositoryOpen(true)
    if (view === 'agent') setAgentOpen(true)
  }

  const requestAdd = (courseId: string, semesterId?: string) => {
    const course = repo.categories.flatMap((category) => category.courses).find((item) => item.id === courseId)
    const offered = new Set((course?.offered ?? []).map((value) => value.toLowerCase()))
    const semesterIds = semesterDestinations
      .map(({ id }) => id)
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
        className="planner-workbench planner-drawers-overlay min-w-0"
        data-mobile-surface={activeView}
        data-layout={repositoryOpen || agentOpen ? 'drawer-split' : 'board'}
        data-drawer-mode="overlay"
        data-repository-open={repositoryOpen}
        data-agent-open={agentOpen}
        data-drag-active={activeDrag ? 'true' : 'false'}
        data-drawer-interaction="below-toolbar"
      >
        <div
          id="workspace-panel-journey"
          role="region"
          data-mobile-surface={activeView}
          data-board-surface="persistent-drop-target"
          data-board-layout="stable"
          data-drop-surface="semester-table"
          aria-label="לוח סמסטרים פעיל"
          className="planner-board-canvas planner-board-canvas-stable planner-agent-drawer min-w-0"
        >
          {repositoryOpen && (
            <p
              role="status"
              aria-live="polite"
              className="planner-board-drop-hint"
            >
              גררו קורס מהמאגר אל עמודת סמסטר כדי להוסיף אותו ללוח. לחלופין,
              השתמשו ב״הוסף לסמסטר״.
            </p>
          )}
          <NativePlannerJourney
            programId={programId}
            useAcademicDecisionAgent
            initializePlanningContext
            onCloseAgent={closeAgent}
            agentCloseRef={agentCloseRef}
            manualAddIntent={manualAddIntent}
            onManualAddSettled={() => setManualAddIntent(null)}
            onManualAddCancelled={() => setManualAddIntent(null)}
            onCommittedCourseIdsChange={setCommittedCourseIds}
            agentOpen={agentOpen}
            activeDrag={activeDrag}
            onDragStateChange={setActiveDrag}
          />
        </div>
          <aside
          id="workspace-panel-repository"
          aria-label="מאגר קורסים"
            data-open={repositoryOpen}
            data-drag-pass-through={activeDrag ? 'true' : 'false'}
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
            semesterDestinations={semesterDestinations}
            onRequestAdd={requestAdd}
            onDragStateChange={setActiveDrag}
          />
        </aside>
      </div>
    </section>
  )
}
