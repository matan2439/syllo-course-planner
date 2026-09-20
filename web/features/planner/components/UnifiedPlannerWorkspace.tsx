'use client'

import { useEffect, useRef, useState } from 'react'
import type { RepositoryVM } from '../../../lib/repository'
import NativePlannerJourney, { type ManualAddIntent } from './NativePlannerJourney'
import UnifiedCourseRepository, { type SemesterDestination } from '../../courses/components/UnifiedCourseRepository'
import WeeklyScheduleDrawer from '../../schedule/components/WeeklyScheduleDrawer'
import type { PlannerDragPayload } from '../../../lib/planner/drag-payload'

type RailTab = 'courses' | 'agent' | 'profile'

const TABS: ReadonlyArray<{ id: RailTab; label: string; icon: string; noun: string }> = [
  { id: 'courses', label: 'קורסים', icon: '☰', noun: 'מאגר קורסים' },
  { id: 'agent', label: 'עוזר AI', icon: '✦', noun: 'עוזר AI' },
  { id: 'profile', label: 'הפרופיל שלי', icon: '◎', noun: 'הפרופיל שלי' },
]

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
  // One rail, one open tab. `null` = closed, board only.
  const [railTab, setRailTab] = useState<RailTab | null>(null)
  const [semesterCourses, setSemesterCourses] = useState<Array<{ semesterId: string; courseIds: string[] }>>([])
  const [manualAddIntent, setManualAddIntent] = useState<ManualAddIntent | null>(null)
  const [committedCourseIds, setCommittedCourseIds] = useState<readonly string[]>(selectedCourseIds)
  const [activeDrag, setActiveDrag] = useState<PlannerDragPayload | null>(null)
  // The assistant lives in the journey (it owns the planning state) and renders into this slot.
  const [agentSlot, setAgentSlot] = useState<HTMLDivElement | null>(null)
  const [profileSlot, setProfileSlot] = useState<HTMLDivElement | null>(null)
  const toggleRefs = useRef<Record<RailTab, HTMLButtonElement | null>>({ courses: null, agent: null, profile: null })
  const railCloseRef = useRef<HTMLButtonElement | null>(null)
  const lastTab = useRef<RailTab>('courses')
  const railWasOpen = useRef(false)
  if (railTab) lastTab.current = railTab

  const requestAdd = (courseId: string, semesterId?: string) => {
    const course = repo.categories.flatMap((category) => category.courses).find((item) => item.id === courseId)
    const offered = new Set((course?.offered ?? []).map((value) => value.toLowerCase()))
    const semesterIds = semesterDestinations
      .map(({ id }) => id)
      .filter((semesterId) => offered.has(semesterId) || offered.has(semesterId.endsWith('_a') ? 'a' : 'b'))
    setManualAddIntent({ courseId, semesterIds: semesterId ? [semesterId] : semesterIds })
    onRequestAdd(courseId)
  }

  const closeRail = () => {
    setRailTab(null)
    toggleRefs.current[lastTab.current]?.focus()
  }

  const toggleTab = (tab: RailTab) => (railTab === tab ? closeRail() : setRailTab(tab))

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !railTab) return
      event.preventDefault()
      closeRail()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [railTab])

  useEffect(() => {
    if (railTab && !railWasOpen.current) railCloseRef.current?.focus()
    railWasOpen.current = railTab !== null
  }, [railTab])

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
        {TABS.map((tab) => (
          <button
            key={tab.id}
            ref={(el) => { toggleRefs.current[tab.id] = el }}
            type="button"
            aria-controls="workspace-rail"
            aria-expanded={railTab === tab.id}
            aria-label={`${railTab === tab.id ? 'סגור' : 'פתח'} ${tab.noun}`}
            onClick={() => toggleTab(tab.id)}
            className={`planner-drawer-toggle planner-drawer-toggle-${tab.id}`}
          >
            <span aria-hidden="true">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div
        className="planner-workbench min-w-0"
        data-rail-open={railTab !== null}
        data-rail-tab={railTab ?? 'none'}
        data-drag-active={activeDrag ? 'true' : 'false'}
      >
        <div
          id="workspace-panel-journey"
          role="region"
          data-board-surface="persistent-drop-target"
          data-board-layout="stable"
          data-drop-surface="semester-table"
          aria-label="לוח סמסטרים פעיל"
          className="planner-board-canvas planner-board-canvas-stable min-w-0"
        >
          {railTab === 'courses' && (
            <p role="status" aria-live="polite" className="planner-board-drop-hint">
              גררו קורס מהמאגר אל עמודת סמסטר כדי להוסיף אותו ללוח. לחלופין,
              השתמשו ב״הוסף לסמסטר״.
            </p>
          )}
          <NativePlannerJourney
            programId={programId}
            useAcademicDecisionAgent
            initializePlanningContext
            manualAddIntent={manualAddIntent}
            onManualAddSettled={() => setManualAddIntent(null)}
            onManualAddCancelled={() => setManualAddIntent(null)}
            onCommittedCourseIdsChange={setCommittedCourseIds}
            onSemestersChange={setSemesterCourses}
            agentOpen={railTab === 'agent'}
            agentPortalTarget={agentSlot}
            profilePortalTarget={profileSlot}
            activeDrag={activeDrag}
            onDragStateChange={setActiveDrag}
          />
        </div>

        <aside
          id="workspace-rail"
          aria-label="סרגל כלים"
          data-open={railTab !== null}
          data-drag-pass-through={activeDrag ? 'true' : 'false'}
          aria-hidden={railTab === null}
          inert={railTab === null}
          className="planner-rail min-w-0"
        >
          <div className="planner-rail-header">
            <div role="tablist" aria-label="כלי תכנון" className="flex gap-1">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`workspace-tab-${tab.id}`}
                  aria-selected={railTab === tab.id}
                  aria-controls={`workspace-panel-${tab.id}`}
                  onClick={() => setRailTab(tab.id)}
                  className="planner-rail-tab"
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              ref={railCloseRef}
              type="button"
              aria-label="סגור סרגל כלים"
              onClick={closeRail}
              className="planner-drawer-close"
            >
              × <span>סגור</span>
            </button>
          </div>

          <div
            id="workspace-panel-courses"
            role="tabpanel"
            aria-labelledby="workspace-tab-courses"
            hidden={railTab !== 'courses'}
            className="planner-rail-body"
          >
            <UnifiedCourseRepository
              repo={repo}
              programId={programId}
              selectedCourseIds={committedCourseIds}
              semesterDestinations={semesterDestinations}
              onRequestAdd={requestAdd}
              onDragStateChange={setActiveDrag}
            />
          </div>
          <div
            id="workspace-panel-agent"
            role="tabpanel"
            aria-labelledby="workspace-tab-agent"
            hidden={railTab !== 'agent'}
            ref={setAgentSlot}
            className="planner-rail-body"
          />
          <div
            id="workspace-panel-profile"
            role="tabpanel"
            aria-labelledby="workspace-tab-profile"
            hidden={railTab !== 'profile'}
            ref={setProfileSlot}
            className="planner-rail-body"
          />
        </aside>
      </div>

      <section
        id="workspace-panel-weekly"
        aria-label="מערכת שעות"
        className="planner-weekly-panel w-full"
      >
        <WeeklyScheduleDrawer
          programId={programId}
          semesterDestinations={semesterDestinations}
          semesterCourses={semesterCourses}
        />
      </section>
    </section>
  )
}
