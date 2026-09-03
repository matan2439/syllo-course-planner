const redirect = jest.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`) })
const notFound = jest.fn(() => { throw new Error('NEXT_NOT_FOUND') })

jest.mock('next/navigation', () => ({
  redirect: (url: string) => redirect(url),
  notFound: () => notFound(),
}))
jest.mock('../lib/board-data', () => ({
  readBoardForProgram: jest.fn(async () => null),
  programSubtitle: jest.fn(() => 'תוכנית'),
}))

import AiPlanPage from './ai-plan/page'
import PlanPage from './plan/page'
import NativePlannerPage from './planner/native/page'

describe('canonical planner entry routes', () => {
  beforeEach(() => {
    redirect.mockClear()
    notFound.mockClear()
  })

  test.each([
    ['plan', PlanPage],
    ['ai-plan', AiPlanPage],
    ['planner/native', NativePlannerPage],
  ])('%s redirects to the canonical planner', async (_name, Page) => {
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_REDIRECT:/planner',
    )
    expect(redirect).toHaveBeenCalledWith('/planner')
  })

  test.each([
    ['plan', PlanPage],
    ['ai-plan', AiPlanPage],
    ['planner/native', NativePlannerPage],
  ])('%s preserves a registered program selection', async (_name, Page) => {
    await expect(Page({
      searchParams: Promise.resolve({ program: 'mechanical_engineering_2025' }),
    })).rejects.toThrow('NEXT_REDIRECT:/planner?program=mechanical_engineering_2025')
    expect(redirect).toHaveBeenCalledWith(
      '/planner?program=mechanical_engineering_2025',
    )
  })

  test.each([
    ['plan', PlanPage],
    ['ai-plan', AiPlanPage],
    ['planner/native', NativePlannerPage],
  ])('%s fails closed for an explicitly requested unregistered program', async (_name, Page) => {
    await expect(Page({
      searchParams: Promise.resolve({ program: 'electrical_engineering_2027' }),
    })).rejects.toThrow('NEXT_NOT_FOUND')

    expect(notFound).toHaveBeenCalledTimes(1)
    expect(redirect).not.toHaveBeenCalled()
  })
})
