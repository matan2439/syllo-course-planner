import { render, screen } from '@testing-library/react'

const notFound = jest.fn(() => { throw new Error('NEXT_NOT_FOUND') })
jest.mock('next/navigation', () => ({ notFound: () => notFound() }))

jest.mock('../../../components/ProductShell', () => ({
  __esModule: true,
  default: ({ children, preferLightweightBackground }: { children: React.ReactNode; preferLightweightBackground?: boolean }) => (
    <div data-testid="product-shell" data-lightweight={String(preferLightweightBackground)}>{children}</div>
  ),
}))

jest.mock('../../../components/UnifiedPlannerWorkspace', () => ({
  __esModule: true,
  default: ({ programId, repo }: { programId: string; repo: unknown }) => (
    <div data-testid="unified-workspace">{programId}:{JSON.stringify(repo)}</div>
  ),
}))

const readBoardForProgramId = jest.fn(async (_programId: string) => ({
  metadata: {
    program_repository_courses: [
      { course_id: 'E1', name_he: 'קורס fixture', weekly_hours: 4, is_mandatory: false },
    ],
  },
  semesters: [
    { semester_id: 'year_3_semester_a', courses: [] },
    { semester_id: 'year_3_semester_b', courses: [] },
  ],
}))
jest.mock('../../../../lib/board-data', () => ({
  readBoardForProgram: jest.fn(async () => ({
    metadata: {
      program_repository_courses: [
        { course_id: 'MECH', name_he: 'קורס מתוכנית ברירת המחדל', weekly_hours: 4, is_mandatory: false },
      ],
    },
    semesters: [],
  })),
  readBoardForProgramId: (programId: string) => readBoardForProgramId(programId),
}))

import AgentPreviewPage from './page'

describe('unified Agent Preview route', () => {
  const previous = process.env.ENABLE_ACADEMIC_AGENT_PREVIEW

  afterEach(() => {
    if (previous === undefined) delete process.env.ENABLE_ACADEMIC_AGENT_PREVIEW
    else process.env.ENABLE_ACADEMIC_AGENT_PREVIEW = previous
    jest.clearAllMocks()
  })

  test('fails closed when the explicit Preview flag is absent', async () => {
    delete process.env.ENABLE_ACADEMIC_AGENT_PREVIEW
    await expect(AgentPreviewPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalledTimes(1)
  })

  test('renders the unified workspace on the animated purple shell when enabled', async () => {
    process.env.ENABLE_ACADEMIC_AGENT_PREVIEW = '1'
    render(await AgentPreviewPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByTestId('product-shell')).toHaveAttribute('data-lightweight', 'false')
    expect(screen.getByTestId('unified-workspace')).toHaveTextContent('mechanical_engineering_2027')
  })

  test('a fixture program renders the repository from the same authoritative snapshot', async () => {
    process.env.ENABLE_ACADEMIC_AGENT_PREVIEW = '1'
    render(await AgentPreviewPage({
      searchParams: Promise.resolve({ program: 'test_program_grounded_preview_2027' }),
    }))

    expect(readBoardForProgramId).toHaveBeenCalledWith('test_program_grounded_preview_2027')
    expect(screen.getByTestId('unified-workspace')).toHaveTextContent('E1')
    expect(screen.getByTestId('unified-workspace')).not.toHaveTextContent('MECH')
  })
})
