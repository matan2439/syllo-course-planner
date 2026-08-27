import { fireEvent, render, screen } from '@testing-library/react'
import type { RepositoryVM } from '../../lib/repository'
import UnifiedPlannerWorkspace from './UnifiedPlannerWorkspace'

jest.mock('./NativePlannerJourney', () => ({
  __esModule: true,
  default: ({ programId, useAcademicDecisionAgent }: { programId: string; useAcademicDecisionAgent: boolean }) => (
    <div data-testid="agent-journey" data-program={programId} data-agent={String(useAcademicDecisionAgent)}>
      לוח ועוזר פעילים
    </div>
  ),
}))

jest.mock('./UnifiedCourseRepository', () => ({
  __esModule: true,
  default: () => <div data-testid="course-repository">מאגר פעיל</div>,
}))

const repo: RepositoryVM = { categories: [], totalCourses: 0 }

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

  test('offers keyboard-accessible mobile view switching without unmounting either region', () => {
    render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repo} />)

    const boardTab = screen.getByRole('tab', { name: 'לוח ועוזר' })
    const repoTab = screen.getByRole('tab', { name: 'מאגר קורסים' })
    expect(boardTab).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(repoTab)
    expect(repoTab).toHaveAttribute('aria-selected', 'true')
    expect(boardTab).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByTestId('agent-journey')).toBeInTheDocument()
    expect(screen.getByTestId('course-repository')).toBeInTheDocument()

    fireEvent.keyDown(repoTab, { key: 'ArrowRight' })
    expect(boardTab).toHaveFocus()
    expect(boardTab).toHaveAttribute('aria-selected', 'true')
  })
})
