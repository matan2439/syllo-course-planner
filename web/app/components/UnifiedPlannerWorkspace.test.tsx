import { fireEvent, render, screen } from '@testing-library/react'
import type { RepositoryVM } from '../../lib/repository'
import UnifiedPlannerWorkspace from './UnifiedPlannerWorkspace'

jest.mock('./NativePlannerJourney', () => ({
  __esModule: true,
  default: ({ programId, useAcademicDecisionAgent, manualAddIntent, onCloseAgent, onManualAddCancelled, agentCloseRef }: any) => (
    <div data-testid="agent-journey" data-program={programId} data-agent={String(useAcademicDecisionAgent)}
      data-manual-course={manualAddIntent?.courseId ?? ''} data-manual-semesters={(manualAddIntent?.semesterIds ?? []).join(',')}>
      <div className="planner-board-region">לוח פעיל</div>
      {manualAddIntent && (
        <button type="button" aria-label="ביטול הוספת קורס" onClick={onManualAddCancelled}>ביטול</button>
      )}
      <aside className="planner-agent-region" aria-label="עוזר אקדמי">
        <button ref={agentCloseRef} type="button" aria-label="סגור סרגל עוזר AI" onClick={onCloseAgent}>סגור עוזר</button>
        עוזר פעיל
      </aside>
    </div>
  ),
}))

jest.mock('./UnifiedCourseRepository', () => ({
  __esModule: true,
  default: ({ onRequestAdd }: any) => <div data-testid="course-repository">מאגר פעיל
    <button type="button" onClick={() => onRequestAdd('C1')}>בקש הוספה</button>
  </div>,
}))

const repo: RepositoryVM = { categories: [], totalCourses: 0 }
const repoWithCourse: RepositoryVM = { totalCourses: 1, categories: [{
  id: 'choice', title: 'בחירה', courses: [{
    id: 'C1', name: 'קורס', weeklyHours: 3, offered: ['A'], difficulty: null, syllabusUrl: null,
  }],
}] }

describe('UnifiedPlannerWorkspace', () => {
  test('renders one Agent and one repository in one iframe-free RTL workspace', () => {
    const { container } = render(
      <UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repo} />,
    )

    expect(screen.getAllByRole('heading', { name: 'מרחב התכנון' })).toHaveLength(1)
    expect(screen.getAllByTestId('agent-journey')).toHaveLength(1)
    expect(screen.getByTestId('agent-journey')).toHaveAttribute('data-agent', 'true')
    expect(screen.getAllByTestId('course-repository')).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'מרחב תכנון מאוחד' })).toHaveAttribute('dir', 'rtl')
    expect(container.querySelector('iframe')).not.toBeInTheDocument()
  })

  test('offers three keyboard-accessible mobile views without duplicating journey state', () => {
    render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repo} />)

    const boardTab = screen.getByRole('tab', { name: 'לוח סמסטרים' })
    const repoTab = screen.getByRole('tab', { name: 'מאגר קורסים' })
    const agentTab = screen.getByRole('tab', { name: 'עוזר אקדמי' })
    expect(boardTab).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(repoTab)
    expect(repoTab).toHaveAttribute('aria-selected', 'true')
    expect(boardTab).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByTestId('agent-journey')).toBeInTheDocument()
    expect(screen.getByTestId('course-repository')).toBeInTheDocument()
    expect(screen.getAllByTestId('agent-journey')).toHaveLength(1)

    fireEvent.click(agentTab)
    expect(agentTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('complementary', { name: 'עוזר אקדמי' })).toBeInTheDocument()

    fireEvent.keyDown(agentTab, { key: 'End' })
    expect(agentTab).toHaveFocus()
    fireEvent.keyDown(agentTab, { key: 'Home' })
    expect(boardTab).toHaveFocus()
    expect(boardTab).toHaveAttribute('aria-selected', 'true')
  })

  test('marks the desktop repository rail and shared journey surfaces structurally', () => {
    const { container } = render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repo} />)
    expect(container.querySelector('.planner-workbench')).not.toBeNull()
    expect(container.querySelector('.planner-repository-rail')).not.toBeNull()
    expect(container.querySelector('.planner-agent-drawer')).not.toBeNull()
  })

  test('keeps the semester board central while course and AI drawers open independently', () => {
    const { container } = render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repo} />)

    const repositoryToggle = screen.getByRole('button', { name: 'פתח מאגר קורסים' })
    const agentToggle = screen.getByRole('button', { name: 'פתח עוזר AI' })
    expect(container.querySelector('.planner-board-canvas')).not.toBeNull()
    expect(container.querySelector('.planner-board-region')).toBeVisible()
    expect(repositoryToggle).toHaveAttribute('aria-expanded', 'false')
    expect(agentToggle).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById('workspace-panel-repository')).toHaveAttribute('aria-hidden', 'true')

    fireEvent.click(repositoryToggle)
    expect(repositoryToggle).toHaveAttribute('aria-expanded', 'true')
    expect(container.querySelector('.planner-workbench')).toHaveAttribute('data-repository-open', 'true')
    expect(container.querySelector('.planner-workbench')).toHaveAttribute('data-layout', 'drawer-split')
    expect(document.getElementById('workspace-panel-repository')).toHaveAttribute('aria-hidden', 'false')
    expect(container.querySelector('.planner-board-region')).toBeVisible()

    expect(container.querySelector('.planner-board-canvas')).not.toHaveClass('hidden')

    fireEvent.click(agentToggle)
    expect(agentToggle).toHaveAttribute('aria-expanded', 'true')
    expect(container.querySelector('.planner-workbench')).toHaveAttribute('data-agent-open', 'true')
    expect(container.querySelector('.planner-board-region')).toBeVisible()

    fireEvent.click(repositoryToggle)
    expect(document.getElementById('workspace-panel-repository')).toHaveAttribute('aria-hidden', 'true')
  })

  test('reserves a clear interaction layer between drawer surfaces and toolbar controls', () => {
    const { container } = render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repo} />)

    expect(container.querySelector('.planner-workbench')).toHaveAttribute(
      'data-drawer-interaction', 'below-toolbar',
    )
  })

  test('keeps the board drop target mounted when the repository drawer is open', () => {
    const { container } = render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repo} />)

    fireEvent.click(screen.getByRole('button', { name: 'פתח מאגר קורסים' }))

    const boardCanvas = container.querySelector('.planner-board-canvas')
    expect(boardCanvas).toBeInTheDocument()
    expect(boardCanvas).not.toHaveClass('hidden')
    expect(boardCanvas).toHaveAttribute('data-board-surface', 'persistent-drop-target')
    expect(boardCanvas).toHaveAttribute('aria-label', 'לוח סמסטרים פעיל')
    expect(container.querySelector('.planner-board-region')).toBeVisible()
  })

  test('keeps a stable board shell and active drop surface beside the open repository', () => {
    const { container } = render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repo} />)

    fireEvent.click(screen.getByRole('button', { name: 'פתח מאגר קורסים' }))

    const boardCanvas = container.querySelector('.planner-board-canvas')
    expect(boardCanvas).toHaveClass('planner-board-canvas-stable')
    expect(boardCanvas).toHaveAttribute('data-board-layout', 'stable')
    expect(boardCanvas).toHaveAttribute('data-drop-surface', 'semester-table')
    expect(boardCanvas).not.toHaveAttribute('aria-hidden', 'true')
  })

  test('explains that the visible board accepts a repository drag while the drawer is open', () => {
    render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repo} />)

    fireEvent.click(screen.getByRole('button', { name: 'פתח מאגר קורסים' }))

    expect(screen.getByRole('status')).toHaveTextContent('גררו קורס מהמאגר אל עמודת סמסטר')
    expect(screen.getByRole('status')).toHaveTextContent('לחלופין, השתמשו ב״הוסף לסמסטר״')
  })

  test('lets each open drawer close from inside its own surface', () => {
    render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repo} />)

    fireEvent.click(screen.getByRole('button', { name: 'פתח מאגר קורסים' }))
    fireEvent.click(screen.getByRole('button', { name: 'סגור סרגל מאגר קורסים' }))
    expect(screen.getByRole('button', { name: 'פתח מאגר קורסים' })).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'פתח עוזר AI' }))
    fireEvent.click(screen.getByRole('button', { name: 'סגור סרגל עוזר AI' }))
    expect(screen.getByRole('button', { name: 'פתח עוזר AI' })).toHaveAttribute('aria-expanded', 'false')
  })

  test('closes the active drawer with Escape without unmounting the board', () => {
    const { container } = render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repo} />)

    fireEvent.click(screen.getByRole('button', { name: 'פתח מאגר קורסים' }))
    expect(screen.getByRole('button', { name: 'סגור מאגר קורסים' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    const repositoryToggle = screen.getByRole('button', { name: 'פתח מאגר קורסים' })
    expect(repositoryToggle).toHaveAttribute('aria-expanded', 'false')
    expect(repositoryToggle).toHaveFocus()
    expect(container.querySelector('.planner-board-region')).toBeVisible()
  })

  test('moves focus into the repository drawer when it opens', () => {
    render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repo} />)

    fireEvent.click(screen.getByRole('button', { name: 'פתח מאגר קורסים' }))

    expect(screen.getByRole('button', { name: 'סגור סרגל מאגר קורסים' })).toHaveFocus()
  })

  test('moves focus into the academic assistant drawer when it opens', () => {
    render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repo} />)

    fireEvent.click(screen.getByRole('button', { name: 'פתח עוזר AI' }))

    expect(screen.getByRole('button', { name: 'סגור סרגל עוזר AI' })).toHaveFocus()
  })

  test('tracks the active drawer surface so narrow layouts never show two rails over the board', () => {
    const { container } = render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repo} />)
    const workbench = container.querySelector('.planner-workbench')

    fireEvent.click(screen.getByRole('button', { name: 'פתח מאגר קורסים' }))
    expect(workbench).toHaveAttribute('data-mobile-surface', 'repository')

    fireEvent.click(screen.getByRole('button', { name: 'פתח עוזר AI' }))
    expect(workbench).toHaveAttribute('data-mobile-surface', 'agent')
  })

  test('routes a repository add intent to the single journey with authoritative offered semesters', () => {
    render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repoWithCourse} />)
    fireEvent.click(screen.getByRole('button', { name: 'בקש הוספה', hidden: true }))
    expect(screen.getByTestId('agent-journey')).toHaveAttribute('data-manual-course', 'C1')
    expect(screen.getByTestId('agent-journey')).toHaveAttribute('data-manual-semesters', 'year_3_semester_a,year_4_semester_a')
  })

  test('clears a pending repository add intent when the student cancels it', () => {
    render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repoWithCourse} />)

    fireEvent.click(screen.getByRole('button', { name: 'בקש הוספה', hidden: true }))
    expect(screen.getByTestId('agent-journey')).toHaveAttribute('data-manual-course', 'C1')

    fireEvent.click(screen.getByRole('button', { name: 'ביטול הוספת קורס' }))
    expect(screen.getByTestId('agent-journey')).toHaveAttribute('data-manual-course', '')
  })

  test('routes add intent against the actual board semester destinations', () => {
    render(
      <UnifiedPlannerWorkspace
        programId="mechanical_engineering_2027"
        repo={repoWithCourse}
        semesterDestinations={[
          { id: 'year_1_semester_a', label: 'שנה א׳ — סמסטר א׳' },
          { id: 'year_3_semester_a', label: 'שנה ג׳ — סמסטר א׳' },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'בקש הוספה', hidden: true }))

    expect(screen.getByTestId('agent-journey')).toHaveAttribute(
      'data-manual-semesters', 'year_1_semester_a,year_3_semester_a',
    )
  })
})
