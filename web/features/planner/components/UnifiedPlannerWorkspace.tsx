'use client'

import { useEffect, useRef, useState } from 'react'
import type { RepositoryVM } from '../../../lib/repository'
import NativePlannerJourney, { type ManualAddIntent } from './NativePlannerJourney'
import UnifiedCourseRepository, { type SemesterDestination } from '../../courses/components/UnifiedCourseRepository'
import WeeklyScheduleDrawer from '../../schedule/components/WeeklyScheduleDrawer'
import type { PlannerDragPayload } from '../../../lib/planner/drag-payload'
import { LAST_PROGRAM_KEY } from '../../shell/last-program'

type RailTab = 'courses' | 'agent' | 'profile'
type MainTab = 'board' | 'schedule'

const MAIN_TABS: ReadonlyArray<{ id: MainTab; label: string }> = [
  { id: 'board', label: 'לוח סמסטרים' },
  { id: 'schedule', label: 'מערכת שעות' },
]

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
  const [mainTab, setMainTab] = useState<MainTab>('board')
  // First-visit setup card: shown until the student acts on it or dismisses it (remembered per program).
  const setupKey = `syllo_setup_done_${programId}`
  const [showSetup, setShowSetup] = useState(false)
  useEffect(() => {
    try {
      localStorage.setItem(LAST_PROGRAM_KEY, programId) // lets the landing page resume this plan
      setShowSetup(localStorage.getItem(setupKey) !== '1')
    } catch { /* storage unavailable: no card, no memory */ }
  }, [programId, setupKey])
  const finishSetup = (tab?: RailTab) => {
    setShowSetup(false)
    try { localStorage.setItem(setupKey, '1') } catch { /* best effort */ }
    if (tab) setRailTab(tab)
  }
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
    setMainTab('board') // the semester prompt lives on the board
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
        <div className="planner-main min-w-0">
        {showSetup && mainTab === 'board' && (
          <section aria-label="הגדרה ראשונית" className="planner-setup-card">
            <div>
              <h2 className="text-sm font-bold">בואו נתחיל: איפה אתם בתואר?</h2>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                ככל שהעוזר יודע יותר (קורסים שהשלמתם, שעות שבועיות, מה לשלב או להימנע) כך התוכנית מדויקת יותר. אפשר גם לדלג ולגרור קורסים ישר ללוח.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => finishSetup('agent')} className="planner-setup-primary">ספרו לעוזר</button>
              <button type="button" onClick={() => finishSetup('profile')} className="planner-setup-secondary">סמנו קורסים שהשלמתי</button>
              <button type="button" onClick={() => finishSetup()} className="planner-setup-dismiss">לא עכשיו</button>
            </div>
          </section>
        )}
        <div role="tablist" aria-label="תצוגת תכנון" className="planner-main-tabs">
          {MAIN_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`workspace-main-tab-${tab.id}`}
              aria-selected={mainTab === tab.id}
              aria-controls={tab.id === 'board' ? 'workspace-panel-journey' : 'workspace-panel-weekly'}
              onClick={() => setMainTab(tab.id)}
              className="planner-rail-tab"
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div
          id="workspace-panel-journey"
          role="region"
          hidden={mainTab !== 'board'}
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

        {/* Kept mounted (hidden) so the chosen groups survive switching back to the board. */}
        <section
          id="workspace-panel-weekly"
          aria-label="מערכת שעות"
          hidden={mainTab !== 'schedule'}
          className="planner-weekly-panel w-full"
        >
          <WeeklyScheduleDrawer
            programId={programId}
            semesterDestinations={semesterDestinations}
            semesterCourses={semesterCourses}
          />
        </section>
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

      {/* Phones: the four working views one thumb away (the tabs above and the toolbar are for larger screens). */}
      <nav aria-label="ניווט תכנון" className="planner-bottom-bar">
        {[
          { key: 'board', label: 'לוח', active: mainTab === 'board' && railTab === null, go: () => { setMainTab('board'); setRailTab(null) } },
          { key: 'schedule', label: 'מערכת', active: mainTab === 'schedule' && railTab === null, go: () => { setMainTab('schedule'); setRailTab(null) } },
          { key: 'courses', label: 'קורסים', active: railTab === 'courses', go: () => setRailTab('courses') },
          { key: 'agent', label: 'עוזר', active: railTab === 'agent', go: () => setRailTab('agent') },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={item.go}
            aria-current={item.active ? 'page' : undefined}
            className="planner-bottom-tab"
          >
            {item.label}
          </button>
        ))}
      </nav>
    </section>
  )
}
