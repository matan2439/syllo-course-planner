import BoardPage from './board/page'
import RepositoryPage from './repository/page'

const redirect = jest.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`) })
const notFound = jest.fn(() => { throw new Error('NEXT_NOT_FOUND') })

jest.mock('next/navigation', () => ({
  redirect: (url: string) => redirect(url),
  notFound: () => notFound(),
}))

describe('retired read-only routes', () => {
  beforeEach(() => {
    redirect.mockClear()
    notFound.mockClear()
  })

  test.each([
    ['board', BoardPage],
    ['repository', RepositoryPage],
  ])('%s redirects to the planner and keeps a registered program', async (_name, Page) => {
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT:/planner')
    await expect(Page({
      searchParams: Promise.resolve({ program: 'mechanical_engineering_2025' }),
    })).rejects.toThrow('NEXT_REDIRECT:/planner?program=mechanical_engineering_2025')
  })

  test.each([
    ['board', BoardPage],
    ['repository', RepositoryPage],
  ])('%s fails closed for an explicitly requested unregistered program', async (_name, Page) => {
    await expect(Page({
      searchParams: Promise.resolve({ program: 'electrical_engineering_2027' }),
    })).rejects.toThrow('NEXT_NOT_FOUND')

    expect(redirect).not.toHaveBeenCalled()
  })
})
