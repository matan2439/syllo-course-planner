import { render, screen } from '@testing-library/react'
import PrivacyPage from './page'

jest.mock('../../features/shell/components/ShaderGradientBackground', () => () => null)

test('privacy page explains stored data and self-serve deletion', () => {
  render(<PrivacyPage />)
  expect(screen.getByRole('heading', { name: 'מדיניות פרטיות' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'מחיקת המידע' })).toBeInTheDocument()
  expect(screen.getByText(/מחיקת חשבון/)).toBeInTheDocument()
})
