'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { RepositoryVM } from '../../../lib/repository'
import NativePlannerJourney, { type ManualAddIntent } from './NativePlannerJourney'
import { CLOSE_PANELS_EVENT } from '../../billing/ai_access'
import UnifiedCourseRepository, { type SemesterDestination } from '../../courses/components/UnifiedCourseRepository'
import WeeklyScheduleDrawer from '../../schedule/components/WeeklyScheduleDrawer'
import type { PlannerDragPayload } from '../../../lib/planner/drag-payload'
import { LAST_PROGRAM_KEY } from '../../shell/last-program'
import { semesterWindowForDegreeYear, semesterWindowSlots, type SemesterWindow } from '../../../lib/planner/semester-window'
import { useCurrentDegreeYear } from '../hooks/use-current-degree-year'
import { useAuth } from '../../auth/AuthProvider'

type RailTab = 'courses' | 'agent' | 'profile'
type MainTab = 'board' | 'schedule'

const MAIN_TABS: ReadonlyArray<{ id: MainTab; label: string }> = [
  { id: 'board', label: 'לוח סמסטרים' },
  { id: 'schedule', label: 'מערכת שעות' },
]

const TABS: ReadonlyArray<{ id: RailTab; label: string }> = [
  { id: 'courses', label: 'קורסים' },
  { id: 'agent', label: 'עוזר AI' },
  { id: 'profile', label: 'הפרופיל שלי' },
]

const DEFAULT_SEMESTER_DESTINATIONS: readonly SemesterDestination[] = semesterWindowSlots()

/** The board a two-year window plans over, with its course repository and columns. */
export type WindowBoard = { boardId: string; repo: RepositoryVM; semesterDestinations: readonly SemesterDestination[] }

export default function UnifiedPlannerWorkspace({
  programId,
  repo,
  selectedCourseIds = [],
  onRequestAdd = () => undefined,
  semesterDestinations: programDestinations = DEFAULT_SEMESTER_DESTINATIONS,
  windowBoards = {},
}: {
  programId: string
  repo: RepositoryVM
  selectedCourseIds?: readonly string[]
  onRequestAdd?: (courseId: string) => void
  /** The board's real columns — where a course can be placed. */
  semesterDestinations?: readonly SemesterDestination[]
  /** The board each two-year window plans over; a window without one falls back to the program's board. */
  windowBoards?: Partial<Record<SemesterWindow, WindowBoard>>
}) {
  // Profile fact → derived window → the board it plans over and the weekly schedule's four tabs.
  const [currentDegreeYear, setCurrentDegreeYear] = useCurrentDegreeYear()
  const semesterWindow = semesterWindowForDegreeYear(currentDegreeYear)
  const scheduleSemesters = useMemo(() => semesterWindowSlots(semesterWindow), [semesterWindow])
  const { boardId, repo: boardRepo, semesterDestinations } =
    windowBoards[semesterWindow] ?? { boardId: programId, repo, semesterDestinations: programDestinations }
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
  // Signed in: the program is part of the account profile too (resumes on any device).
  const { profile, updateProfile } = useAuth()
  const accountProgramId = profile ? profile.program_id : undefined
  useEffect(() => {
    if (accountProgramId !== undefined && accountProgramId !== programId) void updateProfile({ program_id: programId })
  }, [accountProgramId, programId, updateProfile])
  const finishSetup = (tab?: RailTab) => {
    setShowSetup(false)
    try { localStorage.setItem(setupKey, '1') } catch { /* best effort */ }
    if (tab) setRailTab(tab)
  }
  const [semesterCourses, setSemesterCourses] = useState<Array<{ semesterId: string; courseIds: string[] }>>([])
  const [manualAddIntent, setManualAddIntent] = useState<ManualAddIntent | null>(null)
  useEffect(() => setManualAddIntent(null), [boardId]) // a pending add targets the previous board's columns
  const [committedCourseIds, setCommittedCourseIds] = useState<readonly string[]>(selectedCourseIds)
  const [activeDrag, setActiveDrag] = useState<PlannerDragPayload | null>(null)
  // The assistant lives in the journey (it owns the planning state) and renders into this slot.
  const [agentSlot, setAgentSlot] = useState<HTMLDivElement | null>(null)
  const [profileSlot, setProfileSlot] = useState<HTMLDivElement | null>(null)
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  const railCloseRef = useRef<HTMLButtonElement | null>(null)
  const lastTab = useRef<RailTab>('courses')
  const railWasOpen = useRef(false)
  if (railTab) lastTab.current = railTab

  const requestAdd = (courseId: string, semesterId?: string) => {
    const course = boardRepo.categories.flatMap((category) => category.courses).find((item) => item.id === courseId)
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
    toggleRef.current?.focus()
  }

  useEffect(() => {
    const close = () => setRailTab(null)
    window.addEventListener(CLOSE_PANELS_EVENT, close)
    return () => window.removeEventListener(CLOSE_PANELS_EVENT, close)
  }, [])

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

      {/* One toggle: the rail's own tabs switch between courses, assistant and profile. */}
      <div className="planner-drawer-controls">
        <button
          ref={toggleRef}
          type="button"
          aria-controls="workspace-rail"
          aria-expanded={railTab !== null}
          aria-label={`${railTab ? 'סגור' : 'פתח'} כלי תכנון`}
          onClick={() => (railTab ? closeRail() : setRailTab(lastTab.current))}
          className="planner-drawer-toggle"
        >
          <span aria-hidden="true">☰</span>
          <span>כלי תכנון</span>
        </button>
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
            key={boardId}
            programId={boardId}
            initializePlanningContext
            manualAddIntent={manualAddIntent}
            onManualAddSettled={() => setManualAddIntent(null)}
            onManualAddCancelled={() => setManualAddIntent(null)}
            onCommittedCourseIdsChange={setCommittedCourseIds}
            onSemestersChange={setSemesterCourses}
            agentOpen={railTab === 'agent'}
            agentPortalTarget={agentSlot}
            profilePortalTarget={profileSlot}
            currentDegreeYear={currentDegreeYear}
            onCurrentDegreeYearChange={setCurrentDegreeYear}
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
            currentDegreeYear={currentDegreeYear}
            semesterDestinations={scheduleSemesters}
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
              repo={boardRepo}
              programId={boardId}
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
