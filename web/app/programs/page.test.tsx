import { render, screen } from '@testing-library/react'
import ProgramsPage from './page'

jest.mock('../components/ProductShell', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const SHIPPED = new Set(['mechanical_engineering_2027'])
jest.mock('../../lib/board-data', () => ({
  readBoardForProgramId: jest.fn(async (id: string) => (SHIPPED.has(id) ? {} : null)),
}))

describe('/programs', () => {
  it('offers only programs whose board ships, linking to the planner', async () => {
    render(await ProgramsPage({ searchParams: Promise.resolve({}) }))

    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(links).toEqual(['/planner'])
    // The 2025 archive version and the biomedical track have no board here.
    expect(screen.queryByText(/גרסה קודמת/)).toBeNull()
    expect(screen.queryByText(/ביו-רפואית/)).toBeNull()
  })
})
