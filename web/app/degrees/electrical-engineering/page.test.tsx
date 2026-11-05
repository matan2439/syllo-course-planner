import { render, screen } from '@testing-library/react'
import Page from './page'

jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
jest.mock('../../../features/degrees/ElectricalEngineeringExplorer', () => ({
  __esModule: true, default: () => <div>EE course explorer</div>,
}))
jest.mock('../../../features/shell/components/ProductShell', () => ({
  __esModule: true, default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const original = process.env.ENABLE_EE_EXPLORER
afterEach(() => {
  if (original === undefined) delete process.env.ENABLE_EE_EXPLORER
  else process.env.ENABLE_EE_EXPLORER = original
})

test('the production route stays unavailable until the explorer release flag is enabled', async () => {
  delete process.env.ENABLE_EE_EXPLORER
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('NOT_FOUND')
})

test('an enabled release serves the course explorer within the site shell', async () => {
  process.env.ENABLE_EE_EXPLORER = '1'
  render(await Page({ searchParams: Promise.resolve({}) }))
  expect(screen.getByText('EE course explorer')).toBeInTheDocument()
})
