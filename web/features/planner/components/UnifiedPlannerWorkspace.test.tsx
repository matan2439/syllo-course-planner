import { fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { RepositoryVM } from '../../../lib/repository'
import UnifiedPlannerWorkspace from './UnifiedPlannerWorkspace'

jest.mock('./NativePlannerJourney', () => ({
  __esModule: true,
  default: ({ programId, manualAddIntent, onManualAddCancelled, onSemestersChange, agentPortalTarget, currentDegreeYear, onCurrentDegreeYearChange }: any) => {
    useEffect(() => {
      onSemestersChange?.([{ semesterId: 'year_3_semester_a', courseIds: ['0542-2400'] }])
    }, [onSemestersChange])
    const agent = <aside className="planner-agent-region" aria-label="עוזר אקדמי">עוזר פעיל</aside>
    return (
      <div data-testid="agent-journey" data-program={programId}
        data-manual-course={manualAddIntent?.courseId ?? ''} data-manual-semesters={(manualAddIntent?.semesterIds ?? []).join(',')}>
        <div className="planner-board-region">לוח פעיל</div>
        <select aria-label="השנה שלי בתואר" value={currentDegreeYear ?? ''} onChange={(e) => onCurrentDegreeYearChange(Number(e.target.value))}>
          <option value="" disabled>—</option>
          {[1, 2, 3, 4].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        {manualAddIntent && (
          <button type="button" aria-label="ביטול הוספת קורס" onClick={onManualAddCancelled}>ביטול</button>
        )}
        {agentPortalTarget ? createPortal(agent, agentPortalTarget) : null}
      </div>
    )
  },
}))

jest.mock('../../courses/components/UnifiedCourseRepository', () => ({
  __esModule: true,
  default: ({ onRequestAdd, onDragStateChange }: any) => <div data-testid="course-repository">מאגר פעיל
    <button type="button" draggable onDragStart={() => onDragStateChange?.({ kind: 'repository', courseId: 'C1', allowedSemesterIds: ['year_3_semester_a'] })} onDragEnd={() => onDragStateChange?.(null)}>גרירה לדוגמה</button>
    <button type="button" onClick={() => onRequestAdd('C1')}>בקש הוספה</button>
  </div>,
}))

jest.mock('../../schedule/components/WeeklyScheduleDrawer', () => ({
  __esModule: true,
  default: ({ semesterDestinations }: any) => (
    <div>
      <div role="tablist" aria-label="בחירת סמסטר">
        {semesterDestinations.map((d: any) => <button key={d.id} type="button" role="tab" data-semester-id={d.id}>{d.label}</button>)}
      </div>
    </div>
  ),
}))

const repo: RepositoryVM = { categories: [], totalCourses: 0 }
const repoWithCourse: RepositoryVM = { totalCourses: 1, categories: [{
  id: 'choice', title: 'בחירה', courses: [{
    id: 'C1', name: 'קורס', weeklyHours: 3, offered: ['A'], difficulty: null, syllabusUrl: null,
  }],
}] }

const renderWorkspace = (props: Partial<Parameters<typeof UnifiedPlannerWorkspace>[0]> = {}) =>
  render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repo} {...props} />)

beforeEach(() => localStorage.clear())

describe('UnifiedPlannerWorkspace', () => {
  test('has one opening control for the rail and returns focus on Escape', () => {
    renderWorkspace()
    expect(screen.queryByRole('tab', { name: 'עוזר אקדמי' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'פתח עוזר AI' })).toBeNull()
    const toggle = screen.getByRole('button', { name: 'פתח כלי תכנון' })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
  })

  test('renders one journey, one repository and one rail in one iframe-free RTL workspace', () => {
    const { container } = renderWorkspace()

    expect(screen.getAllByRole('heading', { name: 'מרחב התכנון' })).toHaveLength(1)
    expect(screen.getAllByTestId('agent-journey')).toHaveLength(1)
    expect(screen.getAllByTestId('course-repository')).toHaveLength(1)
    expect(container.querySelectorAll('.planner-rail')).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'מרחב תכנון מאוחד' })).toHaveAttribute('dir', 'rtl')
    expect(container.querySelector('iframe')).not.toBeInTheDocument()
  })

  test('opens one tool at a time in the same rail without hiding the board', () => {
    const { container } = renderWorkspace()
    const workbench = container.querySelector('.planner-workbench')
    const toggle = screen.getByRole('button', { name: 'פתח כלי תכנון' })
    expect(workbench).toHaveAttribute('data-rail-open', 'false')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(workbench).toHaveAttribute('data-rail-tab', 'courses')
    expect(screen.getByRole('tab', { name: 'קורסים' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('tab', { name: 'עוזר AI' }))
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(workbench).toHaveAttribute('data-rail-tab', 'agent')
    expect(screen.getByRole('complementary', { name: 'עוזר אקדמי' })).toBeInTheDocument()
    expect(screen.getAllByTestId('agent-journey')).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'לוח סמסטרים פעיל' })).toBeVisible()

    fireEvent.click(toggle)
    expect(workbench).toHaveAttribute('data-rail-open', 'false')
    // Reopening returns to the last tab used.
    fireEvent.click(toggle)
    expect(workbench).toHaveAttribute('data-rail-tab', 'agent')
  })

  test('tabs inside the rail switch tools', () => {
    renderWorkspace()
    fireEvent.click(screen.getByRole('button', { name: 'פתח כלי תכנון' }))

    fireEvent.click(screen.getByRole('tab', { name: 'עוזר AI' }))
    expect(screen.getByRole('tab', { name: 'עוזר AI' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('tab', { name: 'קורסים' }))
    expect(screen.getByRole('tab', { name: 'קורסים' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'סגור כלי תכנון' })).toBeInTheDocument()
  })

  test('keeps a stable board shell and active drop surface beside the open rail', () => {
    const { container } = renderWorkspace()

    fireEvent.click(screen.getByRole('button', { name: 'פתח כלי תכנון' }))

    const boardCanvas = container.querySelector('.planner-board-canvas')
    expect(boardCanvas).toHaveClass('planner-board-canvas-stable')
    expect(boardCanvas).toHaveAttribute('data-board-layout', 'stable')
    expect(boardCanvas).toHaveAttribute('data-board-surface', 'persistent-drop-target')
    expect(boardCanvas).toHaveAttribute('data-drop-surface', 'semester-table')
    expect(boardCanvas).toHaveAttribute('aria-label', 'לוח סמסטרים פעיל')
    expect(boardCanvas).not.toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('.planner-board-region')).toBeVisible()
  })

  test('explains that the visible board accepts a repository drag while courses are open', () => {
    renderWorkspace()

    fireEvent.click(screen.getByRole('button', { name: 'פתח כלי תכנון' }))

    expect(screen.getByRole('status')).toHaveTextContent('גררו קורס מהמאגר אל עמודת סמסטר')
    expect(screen.getByRole('status')).toHaveTextContent('לחלופין, השתמשו ב״הוסף לסמסטר״')
  })

  test('passes through a floating rail while a drag is heading for the board', () => {
    const { container } = renderWorkspace()
    fireEvent.click(screen.getByRole('button', { name: 'פתח כלי תכנון' }))

    const workbench = container.querySelector('.planner-workbench')
    expect(workbench).toHaveAttribute('data-drag-active', 'false')

    fireEvent.dragStart(screen.getByRole('button', { name: 'גרירה לדוגמה' }))

    expect(workbench).toHaveAttribute('data-drag-active', 'true')
    expect(container.querySelector('.planner-rail')).toHaveAttribute('data-drag-pass-through', 'true')

    fireEvent.dragEnd(screen.getByRole('button', { name: 'גרירה לדוגמה' }))
    expect(workbench).toHaveAttribute('data-drag-active', 'false')
  })

  test('closes from inside the rail and moves focus into it when it opens', () => {
    renderWorkspace()

    fireEvent.click(screen.getByRole('button', { name: 'פתח כלי תכנון' }))
    expect(screen.getByRole('button', { name: 'סגור סרגל כלים' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'סגור סרגל כלים' }))
    const toggle = screen.getByRole('button', { name: 'פתח כלי תכנון' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
  })

  test('closes with Escape without unmounting the board', () => {
    const { container } = renderWorkspace()

    fireEvent.click(screen.getByRole('button', { name: 'פתח כלי תכנון' }))
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.getByRole('button', { name: 'פתח כלי תכנון' })).toHaveAttribute('aria-expanded', 'false')
    expect(container.querySelector('.planner-board-region')).toBeVisible()
  })

  test('routes a repository add intent to the single journey with authoritative offered semesters', () => {
    renderWorkspace({ repo: repoWithCourse })
    fireEvent.click(screen.getByRole('button', { name: 'בקש הוספה', hidden: true }))
    expect(screen.getByTestId('agent-journey')).toHaveAttribute('data-manual-course', 'C1')
    expect(screen.getByTestId('agent-journey')).toHaveAttribute('data-manual-semesters', 'year_3_semester_a,year_4_semester_a')
  })

  test('clears a pending repository add intent when the student cancels it', () => {
    renderWorkspace({ repo: repoWithCourse })

    fireEvent.click(screen.getByRole('button', { name: 'בקש הוספה', hidden: true }))
    expect(screen.getByTestId('agent-journey')).toHaveAttribute('data-manual-course', 'C1')

    fireEvent.click(screen.getByRole('button', { name: 'ביטול הוספת קורס' }))
    expect(screen.getByTestId('agent-journey')).toHaveAttribute('data-manual-course', '')
  })

  test('routes add intent against the actual board semester destinations', () => {
    renderWorkspace({
      repo: repoWithCourse,
      semesterDestinations: [
        { id: 'year_1_semester_a', label: 'שנה א׳ — סמסטר א׳' },
        { id: 'year_3_semester_a', label: 'שנה ג׳ — סמסטר א׳' },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'בקש הוספה', hidden: true }))

    expect(screen.getByTestId('agent-journey')).toHaveAttribute(
      'data-manual-semesters', 'year_1_semester_a,year_3_semester_a',
    )
  })
})

describe('UnifiedPlannerWorkspace — semester window', () => {
  const scheduleTabs = () =>
    Array.from(document.querySelectorAll('#workspace-panel-weekly [role="tab"]')).map((tab) => [
      tab.getAttribute('data-semester-id'), tab.textContent,
    ])

  test('defaults to the late-degree window: the four Year 3/4 tabs, whatever columns the board has', () => {
    renderWorkspace({ semesterDestinations: [{ id: 'year_3_semester_a', label: 'שנה ג׳ — סמסטר א׳' }] })
    expect(scheduleTabs()).toEqual([
      ['year_3_semester_a', 'שנה ג׳ — סמסטר א׳'],
      ['year_3_semester_b', 'שנה ג׳ — סמסטר ב׳'],
      ['year_4_semester_a', 'שנה ד׳ — סמסטר א׳'],
      ['year_4_semester_b', 'שנה ד׳ — סמסטר ב׳'],
    ])
  })

  const EARLY = ['year_1_semester_a', 'year_1_semester_b', 'year_2_semester_a', 'year_2_semester_b']
  const LATE = ['year_3_semester_a', 'year_3_semester_b', 'year_4_semester_a', 'year_4_semester_b']
  const tabIds = () => scheduleTabs().map(([id]) => id)

  test.each([[1, EARLY], [2, EARLY], [3, LATE], [4, LATE]])(
    'a student in Year %i sees the matching two-year window', (year, expected) => {
      localStorage.setItem('syllo_current_degree_year', String(year))
      renderWorkspace()
      expect(tabIds()).toEqual(expected)
    })

  test('an unreadable stored year falls back to the default window', () => {
    localStorage.setItem('syllo_current_degree_year', '7')
    renderWorkspace()
    expect(tabIds()).toEqual(LATE)
  })

  test('changing the year in the profile switches early ↔ late and is remembered', () => {
    renderWorkspace()
    const year = screen.getByRole('combobox', { name: 'השנה שלי בתואר' })
    fireEvent.change(year, { target: { value: '1' } })
    expect(tabIds()).toEqual(EARLY)
    expect(localStorage.getItem('syllo_current_degree_year')).toBe('1')
    fireEvent.change(year, { target: { value: '2' } })
    expect(tabIds()).toEqual(EARLY)
    fireEvent.change(year, { target: { value: '4' } })
    expect(tabIds()).toEqual(LATE)
    expect(localStorage.getItem('syllo_current_degree_year')).toBe('4')
  })
})

describe('UnifiedPlannerWorkspace — weekly schedule tab', () => {
  test('the board is the default view and the schedule is one tab away', () => {
    renderWorkspace()
    expect(screen.getByRole('tab', { name: 'לוח סמסטרים' })).toHaveAttribute('aria-selected', 'true')
    expect(document.getElementById('workspace-panel-journey')).not.toHaveAttribute('hidden')
    expect(document.getElementById('workspace-panel-weekly')).toHaveAttribute('hidden')

    fireEvent.click(screen.getByRole('tab', { name: 'מערכת שעות' }))
    expect(screen.getByRole('tablist', { name: 'בחירת סמסטר' })).toBeVisible()
    expect(document.getElementById('workspace-panel-journey')).toHaveAttribute('hidden')
  })

  test('both views stay mounted so the journey state survives a tab switch', () => {
    renderWorkspace()
    fireEvent.click(screen.getByRole('tab', { name: 'מערכת שעות' }))
    expect(screen.getAllByTestId('agent-journey')).toHaveLength(1)
    fireEvent.click(screen.getByRole('tab', { name: 'לוח סמסטרים' }))
    expect(screen.getAllByTestId('agent-journey')).toHaveLength(1)
    // hidden, not unmounted: the timetable keeps its state (role queries skip hidden panels)
    expect(document.getElementById('workspace-panel-weekly')?.querySelector('[role="tablist"]')).not.toBeNull()
  })

  test('the tools rail can be open beside either view', () => {
    renderWorkspace()
    fireEvent.click(screen.getByRole('tab', { name: 'מערכת שעות' }))
fireEvent.click(screen.getByRole('button', { name: 'פתח כלי תכנון' }))
    fireEvent.click(screen.getByRole('tab', { name: 'עוזר AI' }))
    expect(screen.getByText('עוזר פעיל')).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'בחירת סמסטר' })).toBeVisible()
  })

  test('adding a course from the repository switches back to the board where the prompt lives', () => {
    renderWorkspace({ repo: repoWithCourse })
    fireEvent.click(screen.getByRole('tab', { name: 'מערכת שעות' }))
    fireEvent.click(screen.getByRole('button', { name: 'בקש הוספה', hidden: true }))
    expect(screen.getByRole('tab', { name: 'לוח סמסטרים' })).toHaveAttribute('aria-selected', 'true')
    expect(document.getElementById('workspace-panel-journey')).not.toHaveAttribute('hidden')
  })
})

describe('UnifiedPlannerWorkspace — first visit and phones', () => {
  test('remembers the program so the landing page can resume it', () => {
    renderWorkspace()
    expect(localStorage.getItem('syllo_last_program')).toBe('mechanical_engineering_2027')
  })

  test('a first visit shows the setup card; "ספרו לעוזר" opens the assistant and the card stays gone', () => {
    const { unmount } = renderWorkspace()
    const card = screen.getByRole('region', { name: 'הגדרה ראשונית' })
    expect(card).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ספרו לעוזר' }))
    expect(screen.queryByRole('region', { name: 'הגדרה ראשונית' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'עוזר AI' })).toHaveAttribute('aria-selected', 'true')

    unmount()
    renderWorkspace()
    expect(screen.queryByRole('region', { name: 'הגדרה ראשונית' })).toBeNull()
  })

  test('"סמנו קורסים שהשלמתי" opens the profile and "לא עכשיו" just dismisses', () => {
    const { unmount } = renderWorkspace()
    fireEvent.click(screen.getByRole('button', { name: 'סמנו קורסים שהשלמתי' }))
    expect(screen.getByRole('tab', { name: 'הפרופיל שלי' })).toHaveAttribute('aria-selected', 'true')
    unmount()

    localStorage.clear()
    const second = renderWorkspace()
    fireEvent.click(screen.getByRole('button', { name: 'לא עכשיו' }))
    expect(screen.queryByRole('region', { name: 'הגדרה ראשונית' })).toBeNull()
    expect(second.container.querySelector('.planner-workbench')).toHaveAttribute('data-rail-open', 'false')
  })

  test('the phone bottom bar reaches all four working views', () => {
    const { container } = renderWorkspace()
    const bar = screen.getByRole('navigation', { name: 'ניווט תכנון' })
    const workbench = container.querySelector('.planner-workbench')!
    const tab = (name: string) => Array.from(bar.querySelectorAll('button')).find((b) => b.textContent === name)!

    fireEvent.click(tab('עוזר'))
    expect(workbench).toHaveAttribute('data-rail-tab', 'agent')
    fireEvent.click(tab('קורסים'))
    expect(workbench).toHaveAttribute('data-rail-tab', 'courses')
    fireEvent.click(tab('מערכת'))
    expect(workbench).toHaveAttribute('data-rail-open', 'false')
    expect(document.getElementById('workspace-panel-weekly')).not.toHaveAttribute('hidden')
    expect(tab('מערכת')).toHaveAttribute('aria-current', 'page')
    fireEvent.click(tab('לוח'))
    expect(document.getElementById('workspace-panel-journey')).not.toHaveAttribute('hidden')
    expect(tab('לוח')).toHaveAttribute('aria-current', 'page')
  })
})
