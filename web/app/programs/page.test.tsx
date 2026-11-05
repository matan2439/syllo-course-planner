import { render, screen } from '@testing-library/react'
import ProgramsPage from './page'

jest.mock('../../features/shell/components/ProductShell', () => ({
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
    expect(links).toEqual(['/universities', '/planner']) // change university, then the one shipped program
    // The 2025 archive version and the biomedical track have no board here.
    expect(screen.queryByText(/גרסה קודמת/)).toBeNull()
    expect(screen.queryByText(/ביו-רפואית/)).toBeNull()
  })

  it('offers the EE explorer separately from student planning only when enabled', async () => {
    const previous = process.env.ENABLE_EE_EXPLORER
    process.env.ENABLE_EE_EXPLORER = '1'
    try {
      render(await ProgramsPage({ searchParams: Promise.resolve({}) }))
      expect(screen.getByRole('link', { name: /הנדסת חשמל/ })).toHaveAttribute('href', '/degrees/electrical-engineering')
      expect(screen.queryByRole('link', { name: /הנדסת חשמל/ })?.getAttribute('href')).not.toContain('/planner')
    } finally {
      if (previous === undefined) delete process.env.ENABLE_EE_EXPLORER
      else process.env.ENABLE_EE_EXPLORER = previous
    }
  })
})
