import BoardPage from './board/page'
import RepositoryPage from './repository/page'
import { readBoardForProgram } from '../lib/board-data'

const notFound = jest.fn(() => { throw new Error('NEXT_NOT_FOUND') })

jest.mock('next/navigation', () => ({ notFound: () => notFound() }))
jest.mock('../lib/board-data', () => ({
  readBoardForProgram: jest.fn(async () => null),
  programSubtitle: jest.fn(() => 'תוכנית'),
}))

describe('legacy read-only program routes', () => {
  beforeEach(() => {
    notFound.mockClear()
    jest.mocked(readBoardForProgram).mockClear()
  })

  test.each([
    ['board', BoardPage],
    ['repository', RepositoryPage],
  ])('%s fails closed for an explicitly requested unregistered program', async (_name, Page) => {
    await expect(Page({
      searchParams: Promise.resolve({ program: 'electrical_engineering_2027' }),
    })).rejects.toThrow('NEXT_NOT_FOUND')

    expect(notFound).toHaveBeenCalledTimes(1)
    expect(readBoardForProgram).not.toHaveBeenCalled()
  })
})
