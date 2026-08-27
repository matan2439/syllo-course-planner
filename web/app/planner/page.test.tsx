import { render, screen } from '@testing-library/react'

const notFound = jest.fn(() => { throw new Error('NEXT_NOT_FOUND') })
jest.mock('next/navigation', () => ({ notFound: () => notFound() }))

jest.mock('../components/ProductShell', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="product-shell">{children}</div>
  ),
}))

jest.mock('../components/LegacyPlannerFrame', () => ({
  __esModule: true,
  default: () => <iframe title="legacy-planner" />,
}))

jest.mock('../components/UnifiedPlannerWorkspace', () => ({
  __esModule: true,
  default: ({ programId, repo }: { programId: string; repo: unknown }) => (
    <div data-testid="unified-workspace">{programId}:{JSON.stringify(repo)}</div>
  ),
}))

type FixtureBoard = {
  metadata: {
    program_repository_courses: Array<{
      course_id: string
      name_he: string
      weekly_hours: number
      is_mandatory: boolean
    }>
  }
  semesters: never[]
}

const readBoardForProgramId = jest.fn<Promise<FixtureBoard | null>, [string]>(async (_programId: string) => ({
  metadata: {
    program_repository_courses: [
      { course_id: 'MECH-1', name_he: 'קורס מכונות', weekly_hours: 4, is_mandatory: false },
    ],
  },
  semesters: [],
}))

jest.mock('../../lib/board-data', () => ({
  readBoardForProgramId: (programId: string) => readBoardForProgramId(programId),
  programSubtitle: () => 'הנדסת מכונות',
}))

import PlannerPage from './page'

describe('canonical public planner route', () => {
  beforeEach(() => {
    readBoardForProgramId.mockClear()
    notFound.mockClear()
  })

  test('renders the unified React workspace and keeps the legacy iframe out of the public surface', async () => {
    const { container } = render(await PlannerPage({
      searchParams: Promise.resolve({ program: 'mechanical_engineering_2027' }),
    }))

    expect(readBoardForProgramId).toHaveBeenCalledWith('mechanical_engineering_2027')
    expect(screen.getByTestId('unified-workspace')).toHaveTextContent('MECH-1')
    expect(container.querySelector('iframe')).not.toBeInTheDocument()
  })

  test('fails closed before rendering when a registered archive has no authoritative snapshot', async () => {
    readBoardForProgramId.mockResolvedValueOnce(null)

    await expect(PlannerPage({
      searchParams: Promise.resolve({ program: 'mechanical_engineering_2025' }),
    })).rejects.toThrow('NEXT_NOT_FOUND')

    expect(notFound).toHaveBeenCalledTimes(1)
  })
})
