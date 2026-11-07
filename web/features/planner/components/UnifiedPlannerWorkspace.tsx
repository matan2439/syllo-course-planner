'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RepositoryVM } from '../../../lib/repository'
import type { DegreeRule } from '../../../../shared/planner/degree-rules'
import type { RequirementsVM } from '../../../lib/requirements'
import NativePlannerJourney, { type ManualAddIntent } from './NativePlannerJourney'
import CompanionWindowBoard from './CompanionWindowBoard'
import { CLOSE_PANELS_EVENT } from '../../billing/ai_access'
import { AccountPanel, OPEN_PROFILE_EVENT } from '../../auth/AccountButton'
import ProfileIdentityCard from '../../auth/ProfileIdentityCard'
import { getProgram } from '../../../lib/programs'
import { CourseNotesContext, type CourseNotesLibrary } from '../../courses/components/CourseNotesSection'
import SiteTour, { startTour, type TourStep } from '../../tour/SiteTour'
import UnifiedCourseRepository, { type SemesterDestination } from '../../courses/components/UnifiedCourseRepository'
import WeeklyScheduleDrawer from '../../schedule/components/WeeklyScheduleDrawer'
import type { PlannerDragPayload } from '../../../lib/planner/drag-payload'
import { LAST_PROGRAM_KEY } from '../../shell/last-program'
import { scheduleSlotsForBoard, semesterWindowForDegreeYear, semesterWindowSlots, withAddedSemesters, type SemesterWindow } from '../../../lib/planner/semester-window'
import { useCurrentDegreeYear } from '../hooks/use-current-degree-year'
import { useCompletedStudies } from '../hooks/use-completed-studies'
import { useAuth } from '../../auth/AuthProvider'
import { useLocale } from '../../locale/LocaleProvider'
import StudentWorkspaceTools, { type CompletedStudiesStore, type CourseSearchLibrary } from './StudentWorkspaceTools'
import type { BoardSnapshot } from '../lib/saved-plans'
import { EMPTY_WEEKLY_SCHEDULE, weeklyScheduleSchema, type SavedWeeklySchedule } from '../../../../shared/planner/student-workspace'
import type { WeeklyScheduleState } from '../../../lib/planner/schedule-storage'
import { semesterLabel } from '../../locale/semester-label'

type RailTab = 'courses' | 'agent'
type MainTab = 'board' | 'schedule' | 'bidding'

const MAIN_TABS: ReadonlyArray<{ id: MainTab; label: string }> = [
  { id: 'board', label: 'לוח סמסטרים' },
  { id: 'schedule', label: 'מערכת שעות' },
  { id: 'bidding', label: 'תכנון בידינג' },
]

// The profile is a popover under the header's profile button (OPEN_PROFILE_EVENT), never a rail tab.
const TABS: ReadonlyArray<{ id: RailTab; label: string }> = [
  { id: 'courses', label: 'קורסים' },
  { id: 'agent', label: 'עוזר AI' },
]
const MAIN_PANEL_ID: Record<MainTab, string> = { board: 'workspace-panel-journey', schedule: 'workspace-panel-weekly', bidding: 'workspace-panel-bidding' }
const MAIN_TAB_EN: Record<MainTab, string> = { board: 'Semester board', schedule: 'Weekly timetable', bidding: 'Bidding planner' }

const DEFAULT_SEMESTER_DESTINATIONS: readonly SemesterDestination[] = semesterWindowSlots()

type YearsView = SemesterWindow | 'all'
const YEARS_VIEWS: ReadonlyArray<{ id: YearsView; he: string; en: string }> = [
  { id: 'early', he: 'א׳–ב׳', en: 'Years 1–2' },
  { id: 'late', he: 'ג׳ ואילך', en: 'Years 3+' },
  { id: 'all', he: 'כל התואר', en: 'Whole degree' },
]

/** The board a two-year window plans over, with its course repository and columns. */
export type WindowBoard = { boardId: string; repo: RepositoryVM; semesterDestinations: readonly SemesterDestination[] }

export default function UnifiedPlannerWorkspace({
  programId,
  repo,
  selectedCourseIds = [],
  onRequestAdd = () => undefined,
  semesterDestinations: programDestinations = DEFAULT_SEMESTER_DESTINATIONS,
  windowBoards = {},
  degreeRules = [],
  degreeRequirements,
  degreeCatalog,
}: {
  programId: string
  repo: RepositoryVM
  selectedCourseIds?: readonly string[]
  onRequestAdd?: (courseId: string) => void
  /** The board's real columns — where a course can be placed. */
  semesterDestinations?: readonly SemesterDestination[]
  /** The board each two-year window plans over; a window without one falls back to the program's board. */
  windowBoards?: Partial<Record<SemesterWindow, WindowBoard>>
  degreeRules?: readonly DegreeRule[]
  degreeRequirements?: RequirementsVM | null
  degreeCatalog?: import('../../../../shared/planner/degree-catalog').DegreeCatalogFacts
}) {
  const { t, dir, locale } = useLocale()
  // Profile fact → derived window → the board it plans over and the weekly schedule's four tabs.
  const [currentDegreeYear, setCurrentDegreeYear] = useCurrentDegreeYear()
  // Which years the board shows: one two-year window (editable), or the whole degree, where the
  // other window's board joins the row read-only. Unset = follow the profile's degree year.
  const yearsViewKey = `syllo_years_view_${programId}`
  const [yearsView, setYearsView] = useState<YearsView | null>(null)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(yearsViewKey)
      setYearsView(saved === 'early' || saved === 'late' || saved === 'all' ? saved : null)
    } catch { /* storage unavailable: follow the profile year */ }
  }, [yearsViewKey])
  const chooseYearsView = (view: YearsView) => {
    setYearsView(view)
    try { localStorage.setItem(yearsViewKey, view) } catch { /* best effort */ }
  }
  const hasBothWindows = !!windowBoards.early && !!windowBoards.late
  const semesterWindow: SemesterWindow = hasBothWindows && (yearsView === 'early' || yearsView === 'late')
    ? yearsView : semesterWindowForDegreeYear(currentDegreeYear)
  const companionWindow: SemesterWindow = semesterWindow === 'early' ? 'late' : 'early'
  const companionBoardId = hasBothWindows && yearsView === 'all' ? windowBoards[companionWindow]!.boardId : null
  const companionPlacement = companionWindow === 'early' ? 'before' as const : 'after' as const
  // The board's columns as the journey reports them, including semesters the student added past the window.
  const [semesterCourses, setSemesterCourses] = useState<Array<{ semesterId: string; courseIds: string[] }>>([])
  const boardSemesterIds = useMemo(() => semesterCourses.map((s) => s.semesterId), [semesterCourses])
  const { boardId, repo: boardRepo, semesterDestinations: catalogDestinations } =
    windowBoards[semesterWindow] ?? { boardId: programId, repo, semesterDestinations: programDestinations }
  // Every semester the degree's published boards hold, so the year picker spans the whole degree.
  const degreeSemesterIds = useMemo(
    () => [...programDestinations, ...Object.values(windowBoards).flatMap((w) => w?.semesterDestinations ?? [])].map((d) => d.id),
    [programDestinations, windowBoards])
  const scheduleSemesters = useMemo(
    () => scheduleSlotsForBoard(semesterWindow, boardSemesterIds, catalogDestinations.map((d) => d.id)),
    [semesterWindow, boardSemesterIds, catalogDestinations])
  const semesterDestinations = useMemo(
    () => withAddedSemesters(catalogDestinations, boardSemesterIds), [catalogDestinations, boardSemesterIds])
  // One rail, one open tab. `null` = closed, board only.
  const [railTab, setRailTab] = useState<RailTab | null>(null)
  // Anchored under the header avatar; null = closed. Kept mounted so the journey's portal survives.
  const [profileAnchor, setProfileAnchor] = useState<{ top: number; end: number } | null>(null)
  const profileRef = useRef<HTMLDivElement | null>(null)
  const profileOpen = useRef(false)
  profileOpen.current = profileAnchor !== null
  const openProfile = useCallback(() => {
    const rect = document.querySelector('[data-tour="profile-button"]')?.getBoundingClientRect()
    const rtl = document.documentElement.dir !== 'ltr'
    setProfileAnchor(rect
      ? { top: rect.bottom + 8, end: Math.max(8, rtl ? rect.left : window.innerWidth - rect.right) }
      : { top: 64, end: 16 })
  }, [])
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
  const { profile, updateProfile, user, loading: authLoading } = useAuth()
  // The planner's board, planning context, and co-pilot digests all belong to one owner
  // (the server resolves auth:<uid> from the cookie). A sign-in, sign-out, or account switch
  // on an open page — or a server that no longer has this owner's context — remounts the
  // journey so everything is re-read for the owner the server now sees. The first session
  // restore does not count: the cookie was already sent with the first reads.
  const ownerId = authLoading ? undefined : (user?.id ?? null)
  const [owner, setOwner] = useState({ id: ownerId, epoch: 0 })
  if (ownerId !== undefined && ownerId !== owner.id) {
    setOwner({ id: ownerId, epoch: owner.id === undefined ? owner.epoch : owner.epoch + 1 })
  }
  const reloadForOwner = () => setOwner((current) => ({ ...current, epoch: current.epoch + 1 }))
  const scopeKey = `${boardId}:${ownerId === undefined ? 'pending' : ownerId ?? 'guest'}`
  const [searchLibrary, setSearchLibrary] = useState<{ scope: string; value: CourseSearchLibrary } | null>(null)
  const onSearchLibrary = useCallback((value: CourseSearchLibrary | null) => {
    setSearchLibrary((old) => value ? { scope: scopeKey, value } : old?.scope === scopeKey ? null : old)
  }, [scopeKey])
  const [notesLibrary, setNotesLibrary] = useState<{ scope: string; value: CourseNotesLibrary } | null>(null)
  const onNotesLibrary = useCallback((value: CourseNotesLibrary | null) => {
    setNotesLibrary((old) => value ? { scope: scopeKey, value } : old?.scope === scopeKey ? null : old)
  }, [scopeKey])
  const [studiesStore, setStudiesStore] = useState<{ scope: string; value: CompletedStudiesStore } | null>(null)
  const onStudiesStore = useCallback((value: CompletedStudiesStore | null) => {
    setStudiesStore((old) => value ? { scope: scopeKey, value } : old?.scope === scopeKey ? null : old)
  }, [scopeKey])
  // Profile facts live per degree program; the board document's copy (older saves) seeds it once.
  const programStudies = useCompletedStudies(programId, ownerId === undefined ? null : `${programId}:${ownerId ?? 'guest'}`)
  const legacyStudies = studiesStore?.scope === scopeKey ? studiesStore.value : null
  const completedStudies = programStudies && legacyStudies?.ready
    ? { ...programStudies, value: programStudies.value ?? legacyStudies.value } : null
  const restorePreparer = useRef<{ scope: string; prepare: () => Promise<void> } | null>(null)
  const onPrepareRestore = useCallback((prepare: (() => Promise<void>) | null) => {
    if (prepare) restorePreparer.current = { scope: scopeKey, prepare }
    else if (restorePreparer.current?.scope === scopeKey) restorePreparer.current = null
  }, [scopeKey])
  const [capturedBoard, setCapturedBoard] = useState<{ scope: string; value: BoardSnapshot } | null>(null)
  const [capturedWeekly, setCapturedWeekly] = useState<{ scope: string; value: SavedWeeklySchedule } | null>(null)
  const [restoredWeekly, setRestoredWeekly] = useState<{ scope: string; value: SavedWeeklySchedule; epoch: number } | null>(null)
  const onBoardSnapshot = useCallback((value: BoardSnapshot) => setCapturedBoard({ scope: scopeKey, value }), [scopeKey])
  const onWeeklyState = useCallback((value: WeeklyScheduleState) => {
    const parsed = weeklyScheduleSchema.safeParse(value)
    if (parsed.success) {
      setCapturedWeekly({ scope: scopeKey, value: parsed.data })
      // A restored payload seeds a mount once. Subsequent edits must be the seed
      // on a later account/window return, rather than replaying the old restore.
      setRestoredWeekly((previous) => previous?.scope === scopeKey
        && JSON.stringify(previous.value) !== JSON.stringify(parsed.data)
          ? { ...previous, value: parsed.data } : previous)
    }
  }, [scopeKey])
  const onPlanRestored = useCallback((value: SavedWeeklySchedule) => {
    setCapturedBoard(null)
    setCapturedWeekly({ scope: scopeKey, value })
    setRestoredWeekly((old) => ({ scope: scopeKey, value, epoch: (old?.epoch ?? 0) + 1 }))
    setOwner((current) => ({ ...current, epoch: current.epoch + 1 }))
  }, [scopeKey])
  const onWeeklyHydrated = useCallback((value: SavedWeeklySchedule) => {
    setCapturedWeekly({ scope: scopeKey, value })
    setRestoredWeekly((old) => ({ scope: scopeKey, value, epoch: (old?.epoch ?? 0) + 1 }))
  }, [scopeKey])
  const accountProgramId = profile ? profile.program_id : undefined
  useEffect(() => {
    if (accountProgramId !== undefined && accountProgramId !== programId) void updateProfile({ program_id: programId })
  }, [accountProgramId, programId, updateProfile])
  const finishSetup = (tab?: RailTab | 'profile') => {
    setShowSetup(false)
    try { localStorage.setItem(setupKey, '1') } catch { /* best effort */ }
    if (tab === 'profile') openProfile()
    else if (tab) setRailTab(tab)
  }
  const [manualAddIntent, setManualAddIntent] = useState<ManualAddIntent | null>(null)
  useEffect(() => setManualAddIntent(null), [boardId]) // a pending add targets the previous board's columns
  const [committedCourseIds, setCommittedCourseIds] = useState<readonly string[]>(selectedCourseIds)
  const [activeDrag, setActiveDrag] = useState<PlannerDragPayload | null>(null)
  // The assistant lives in the journey (it owns the planning state) and renders into this slot.
  const [agentSlot, setAgentSlot] = useState<HTMLDivElement | null>(null)
  const [profileSlot, setProfileSlot] = useState<HTMLDivElement | null>(null)
  const [biddingSlot, setBiddingSlot] = useState<HTMLElement | null>(null)
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
      .filter((semesterId) => offered.size === 0 || offered.has(semesterId) || offered.has(semesterId.endsWith('_a') ? 'a' : 'b'))
    setManualAddIntent({ courseId, semesterIds: semesterId ? [semesterId] : semesterIds })
    setMainTab('board') // the semester prompt lives on the board
    // On small screens the repository is a sheet over the board. Reveal the
    // confirmation prompt immediately instead of leaving it behind that sheet.
    if (window.matchMedia?.('(max-width: 1023px)').matches) setRailTab(null)
    onRequestAdd(courseId)
  }

  const closeRail = () => {
    setRailTab(null)
    if (window.matchMedia?.('(max-width: 1023px)').matches) {
      document.querySelector<HTMLButtonElement>(`.planner-bottom-tab[data-view="${mainTab}"]`)?.focus()
    } else {
      toggleRef.current?.focus()
    }
  }

  useEffect(() => {
    const open = (event: Event) => {
      event.preventDefault()
      if (profileOpen.current) setProfileAnchor(null)
      else openProfile()
    }
    window.addEventListener(OPEN_PROFILE_EVENT, open)
    return () => window.removeEventListener(OPEN_PROFILE_EVENT, open)
  }, [openProfile])

  useEffect(() => {
    if (!profileAnchor) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setProfileAnchor(null) } }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (profileRef.current?.contains(target) || document.querySelector('[data-tour="profile-button"]')?.contains(target)) return
      setProfileAnchor(null)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('keydown', onKeyDown); document.removeEventListener('pointerdown', onPointerDown) }
  }, [profileAnchor])

  useEffect(() => {
    const close = () => { setRailTab(null); setProfileAnchor(null) }
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
    if (railTab) setProfileAnchor(null) // one floating panel at a time
    if (railTab && !railWasOpen.current) railCloseRef.current?.focus()
    railWasOpen.current = railTab !== null
  }, [railTab])

  const tourSteps: TourStep[] = [
    { title: ['ברוכים הבאים ל־Syllo', 'Welcome to Syllo'], body: ['שתי דקות על כל מה שצריך כדי לתכנן את התואר. אפשר לדלג ולהפעיל שוב מהפרופיל.', 'Two minutes on everything you need to plan your degree. Skip anytime and relaunch it from your profile.'],
      points: [['תכנון סמסטרים, מערכת שעות ובידינג במקום אחד', 'Semesters, timetable and bidding in one place'], ['עוזר AI שמציע — ואתם מחליטים', 'An AI assistant that proposes — you decide'], ['הכול נשמר אוטומטית', 'Everything saves automatically']] },
    { target: '[data-tour="main-tabs"]', prepare: () => { setMainTab('board'); setRailTab(null) }, title: ['שלוש תצוגות, תוכנית אחת', 'Three views, one plan'], body: ['עוברים בין התצוגות בסרגל העליון. כולן עובדות על אותה תוכנית.', 'Switch views in the top bar. All of them work on the same plan.'],
      points: [['לוח סמסטרים — שיבוץ קורסים', 'Semester board — place courses'], ['מערכת שעות — בחירת קבוצות וימים פנויים', 'Timetable — groups and free days'], ['תכנון בידינג — ניקוד ומועדי מבחנים', 'Bidding — points and exam dates']] },
    { target: '#workspace-panel-journey', title: ['לוח הסמסטרים', 'The semester board'], body: ['כל שינוי נבדק מול דרישות הקדם וחוקי התואר, וההתקדמות בראש העמוד מתעדכנת.', 'Every change is checked against prerequisites and degree rules, and the progress at the top updates.'],
      points: [['גררו קורס בין סמסטרים או הסירו אותו', 'Drag a course between semesters or remove it'], ['בחרו שנים להצגה: א׳–ב׳, ג׳ ואילך או כל התואר', 'Pick the years to show: 1–2, 3+ or the whole degree'], ['"+" מוסיף סמסטר למי שמאריך את התואר', '"+" adds a semester if you extend your degree']] },
    { target: '[data-tour="saved-plans"]', title: ['חלופות ממוספרות', 'Numbered alternatives'], body: ['כל מספר הוא תוכנית שמורה משלה — לוח, מערכת ובידינג.', 'Each number is its own saved plan — board, timetable and bidding.'],
      points: [['"+" יוצר עותק של השילוב הנוכחי', '"+" copies the current combination'], ['"⋯" — הערות, שכפול, השוואה ומחיקה', '"⋯" — notes, duplicate, compare and delete']] },
    { target: '[data-tour="tools-toggle"]', prepare: () => setRailTab('courses'), title: ['מאגר הקורסים', 'The course catalog'], body: ['חיפוש וסינון לפי קטגוריה, סמסטר, הערכה וטווח ממוצעים.', 'Search and filter by category, semester, assessment and grade range.'],
      points: [['גררו קורס ללוח או "הוסף לסמסטר"', 'Drag a course to the board or use "Add to semester"'], ['בפרטי הקורס: ציונים, סילבוס והערות של סטודנטים', 'Course details: grades, syllabus and students\' notes'], ['שתפו הערה משלכם באופן אנונימי', 'Share a note of your own anonymously']] },
    { target: '#workspace-rail', prepare: () => setRailTab('agent'), title: ['עוזר ה־AI', 'The AI assistant'], body: ['ספרו מה חשוב לכם והעוזר יבנה הצעה. ההצעה מוצגת כאן, בצ׳אט, והלוח רק מציג תצוגה מקדימה.', 'Say what matters and the assistant builds a proposal. It appears here in the chat; the board only previews it.'],
      points: [['השוו בין חלופות לפני שמחליטים', 'Compare alternatives before you decide'], ['"החל תוכנית" שומר; "דחה" משאיר את הלוח כמו שהוא', '"Apply" saves; "Reject" leaves your board as it is'], ['העוזר מוסיף קורסים — הסרה תמיד דורשת אישור שלכם', 'The assistant adds courses — removing always needs your approval']] },
    { target: '#workspace-panel-weekly', prepare: () => { setRailTab(null); setMainTab('schedule') }, title: ['מערכת שעות', 'The timetable'], body: ['בונים שבוע נוח מהקבוצות של הקורסים בלוח.', 'Build a comfortable week from the groups of your board\'s courses.'],
      points: [['סמנו ימים פנויים ושעות חסומות', 'Mark free days and busy times'], ['"בחירת הקבוצות הטובות ביותר" בלחיצה', '"Best groups" in one click'], ['הזינו מבחנים וייצאו ליומן', 'Enter exams and export to your calendar']] },
    { target: '#workspace-panel-bidding', prepare: () => setMainTab('bidding'), title: ['תכנון בידינג', 'Bidding planner'], body: ['מכינים ניקוד להזנה באתר הרשמי ומתעדים תוצאות לכל מקצה.', 'Prepare points for the official site and record results per round.'],
      points: [['חלוקת תקציב לפי סדר עדיפויות', 'Split your budget by priority'], ['תרחיש "מה יקרה אם אדחה?"', '"What if I am rejected?" scenarios'], ['התנגשויות ומרווחים קצרים בין מבחנים', 'Exam collisions and short gaps']] },
    { target: '[data-tour="header-tools"]', prepare: () => setMainTab('board'), title: ['הפרופיל שלכם', 'Your profile'], body: ['כפתור הפרופיל פותח חלונית מתחתיו: חשבון, שנה בתואר וקורסים שהשלמתם.', 'The profile button opens a panel under it: account, degree year and completed courses.'],
      points: [['ש״ש מחוץ לרשימה ושער רוח נשמרים לכל התואר', 'Outside hours and Shaar Ruach save for the whole degree'], ['מצב יום/לילה, ניגודיות גבוהה ושפה', 'Day/night, high contrast and language']] },
  ]

  return (
    <CourseNotesContext.Provider value={notesLibrary?.scope === scopeKey ? notesLibrary.value : null}>
    <section
      role="region"
      aria-label={t('מרחב תכנון מאוחד', 'Unified planning workspace')}
      dir={dir}
      className="flex flex-col gap-5"
    >

      <h1 className="sr-only">{t('מרחב התכנון', 'Planning workspace')}</h1>
      {/* One toolbar: view, plan slot, years and the courses/assistant rail. Everything else lives in its view. */}
      <div className="planner-toolbar">
        <div role="tablist" aria-label={t('תצוגת תכנון', 'Planning view')} className="planner-main-tabs" data-tour="main-tabs">
          {MAIN_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`workspace-main-tab-${tab.id}`}
              aria-selected={mainTab === tab.id}
              aria-controls={MAIN_PANEL_ID[tab.id]}
              onClick={() => setMainTab(tab.id)}
              className="planner-rail-tab"
            >
              {t(tab.label, MAIN_TAB_EN[tab.id])}
            </button>
          ))}
        </div>
        {!authLoading && <StudentWorkspaceTools key={scopeKey} programId={boardId}
          snapshot={capturedBoard?.scope === scopeKey ? capturedBoard.value : null}
          weeklySchedule={capturedWeekly?.scope === scopeKey ? capturedWeekly.value : EMPTY_WEEKLY_SCHEDULE}
          prepareRestore={async () => {
            if (restorePreparer.current?.scope !== scopeKey) throw new Error('Planning context is still loading')
            await restorePreparer.current.prepare()
          }}
          onRestored={onPlanRestored} onWeeklyHydrated={onWeeklyHydrated} onSearchLibrary={onSearchLibrary} onNotesLibrary={onNotesLibrary} onStudiesStore={onStudiesStore}
          biddingTarget={biddingSlot} />}
        {mainTab === 'board' && hasBothWindows && (
          <label className="planner-years">
            <span className="sr-only">{t('שנים מוצגות', 'Years shown')}</span>
            <select value={yearsView === 'all' ? 'all' : semesterWindow} onChange={(e) => chooseYearsView(e.target.value as YearsView)}>
              {YEARS_VIEWS.map((view) => <option key={view.id} value={view.id}>{t(view.he, view.en)}</option>)}
            </select>
          </label>
        )}
        <button
          ref={toggleRef}
          type="button"
          aria-controls="workspace-rail"
          aria-expanded={railTab !== null}
          aria-label={railTab ? t('סגור כלי תכנון', 'Close planning tools') : t('פתח כלי תכנון', 'Open planning tools')}
          onClick={() => (railTab ? closeRail() : setRailTab(lastTab.current))}
          className="planner-drawer-toggle" data-tour="tools-toggle"
        >
          <span aria-hidden="true">☰</span>
          <span>{t('כלי תכנון', 'Planning tools')}</span>
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
          <section aria-label={t('הגדרה ראשונית', 'Initial setup')} className="planner-setup-card">
            <div>
              <h2 className="text-sm font-bold">{t('בואו נתחיל: איפה אתם בתואר?', 'Let’s start: where are you in your degree?')}</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => finishSetup('agent')} className="planner-setup-primary">{t('ספרו לעוזר', 'Tell the assistant')}</button>
              <button type="button" onClick={() => finishSetup('profile')} className="planner-setup-secondary">{t('סמנו קורסים שהשלמתי', 'Mark completed courses')}</button>
              <button type="button" onClick={() => { finishSetup(); startTour() }} className="planner-setup-secondary">{t('סיור באתר', 'Site tour')}</button>
              <button type="button" onClick={() => finishSetup()} className="planner-setup-dismiss">{t('לא עכשיו', 'Not now')}</button>
            </div>
          </section>
        )}
        <div
          id="workspace-panel-journey"
          role="region"
          hidden={mainTab !== 'board'}
          data-board-surface="persistent-drop-target"
          data-board-layout="stable"
          data-drop-surface="semester-table"
          aria-label={t('לוח סמסטרים פעיל', 'Active semester board')}
          className="planner-board-canvas planner-board-canvas-stable min-w-0"
        >
          <NativePlannerJourney
            degreeRules={degreeRules}
            degreeRequirements={degreeRequirements}
            degreeCatalog={degreeCatalog}
            key={`${boardId}:${owner.epoch}`}
            companion={companionBoardId
              ? { placement: companionPlacement, node: <CompanionWindowBoard key={`${companionBoardId}:${owner.epoch}`} boardId={companionBoardId} placement={companionPlacement} /> }
              : undefined}
            programId={boardId}
            degreeSemesterIds={degreeSemesterIds}
            onAcademicContextMissing={reloadForOwner}
            initializePlanningContext
            manualAddIntent={manualAddIntent}
            onManualAddSettled={() => setManualAddIntent(null)}
            onManualAddCancelled={() => setManualAddIntent(null)}
            onCommittedCourseIdsChange={setCommittedCourseIds}
            onSemestersChange={setSemesterCourses}
            onBoardSnapshot={onBoardSnapshot}
            onPrepareRestore={onPrepareRestore}
            agentOpen={railTab === 'agent'}
            agentPortalTarget={agentSlot}
            profilePortalTarget={profileSlot}
            completedStudies={completedStudies}
            currentDegreeYear={currentDegreeYear}
            onCurrentDegreeYearChange={setCurrentDegreeYear}
            activeDrag={activeDrag}
            onDragStateChange={setActiveDrag}
          />
        </div>

        {/* Kept mounted (hidden) so the chosen groups survive switching back to the board. */}
        <section
          id="workspace-panel-weekly"
          aria-label={t('מערכת שעות', 'Timetable')}
          hidden={mainTab !== 'schedule'}
          className="planner-weekly-panel w-full"
        >
          <WeeklyScheduleDrawer
            key={`${scopeKey}:${restoredWeekly?.scope === scopeKey ? restoredWeekly.epoch : 0}`}
            programId={programId}
            storageScope={ownerId ? `${programId}:account:${ownerId}` : ownerId === undefined ? `${programId}:pending` : programId}
            initialState={restoredWeekly?.scope === scopeKey ? restoredWeekly.value : undefined}
            onStateChange={onWeeklyState}
            currentDegreeYear={currentDegreeYear}
            semesterDestinations={scheduleSemesters.map((s) => ({ ...s, label: semesterLabel(s.id, s.label, locale) }))}
            semesterCourses={semesterCourses}
          />
        </section>

        {/* Bidding points/results and the plan's exam dates; content portaled from StudentWorkspaceTools. */}
        <section
          id="workspace-panel-bidding"
          ref={setBiddingSlot}
          aria-label={t('תכנון בידינג', 'Bidding planner')}
          hidden={mainTab !== 'bidding'}
          className="planner-weekly-panel w-full"
        />
        </div>

        <aside
          id="workspace-rail"
          aria-label={t('סרגל כלים', 'Tools panel')}
          data-open={railTab !== null}
          data-drag-pass-through={activeDrag ? 'true' : 'false'}
          aria-hidden={railTab === null}
          inert={railTab === null}
          className="planner-rail min-w-0"
        >
          <div className="planner-rail-header">
            <div role="tablist" aria-label={t('כלי תכנון', 'Planning tools')} className="flex gap-1">
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
                  {t(tab.label, tab.id === 'courses' ? 'Courses' : 'AI assistant')}
                </button>
              ))}
            </div>
            <button
              ref={railCloseRef}
              type="button"
              aria-label={t('סגור סרגל כלים', 'Close tools panel')}
              onClick={closeRail}
              className="planner-drawer-close"
            >
              × <span>{t('סגור', 'Close')}</span>
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
              key={scopeKey}
              repo={boardRepo}
              savedSearches={searchLibrary?.scope === scopeKey ? searchLibrary.value.searches : []}
              savedSearchesReady={!authLoading && searchLibrary?.scope === scopeKey && searchLibrary.value.ready}
              onSavedSearchesChange={searchLibrary?.scope === scopeKey ? searchLibrary.value.change : undefined}
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
        </aside>
      </div>

      {/* Profile popover: under the header avatar, above everything. */}
      <div
        id="workspace-panel-profile"
        ref={profileRef}
        role="dialog"
        aria-label={t('הפרופיל שלי', 'My profile')}
        hidden={!profileAnchor}
        style={profileAnchor ? { top: profileAnchor.top, insetInlineEnd: profileAnchor.end } : undefined}
        className="planner-profile-popover"
      >
        <h2 className="mb-3 text-base font-bold">{t('הפרופיל שלי', 'My profile')}</h2>
        <ProfileIdentityCard defaultDegree={[getProgram(programId)?.name, getProgram(programId)?.track].filter(Boolean).join(' · ') || undefined} />
        <section aria-label={t('החשבון שלי', 'My account')} className="mb-5 border-b border-[var(--border)] pb-4 text-sm">
          <AccountPanel showTour onDone={() => setProfileAnchor(null)} />
        </section>
        <div ref={setProfileSlot} />
      </div>

      <SiteTour steps={tourSteps} />

      {/* Phones: the four working views one thumb away (the tabs above and the toolbar are for larger screens). */}
      <nav aria-label={t('ניווט תכנון', 'Planning navigation')} className="planner-bottom-bar">
        {[
          { key: 'board', label: 'לוח', active: mainTab === 'board' && railTab === null, go: () => { setMainTab('board'); setRailTab(null) } },
          { key: 'schedule', label: 'מערכת', active: mainTab === 'schedule' && railTab === null, go: () => { setMainTab('schedule'); setRailTab(null) } },
          { key: 'courses', label: 'קורסים', active: railTab === 'courses', go: () => setRailTab('courses') },
          { key: 'agent', label: 'עוזר', active: railTab === 'agent', go: () => setRailTab('agent') },
          { key: 'bidding', label: 'בידינג', active: mainTab === 'bidding' && railTab === null, go: () => { setMainTab('bidding'); setRailTab(null) } },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            data-view={item.key}
            onClick={item.go}
            aria-current={item.active ? 'page' : undefined}
            className="planner-bottom-tab"
          >
            {t(item.label, ({ board: 'Board', schedule: 'Timetable', bidding: 'Bidding', courses: 'Courses', agent: 'Assistant' } as Record<string,string>)[item.key])}
          </button>
        ))}
      </nav>
    </section>
    </CourseNotesContext.Provider>
  )
}
