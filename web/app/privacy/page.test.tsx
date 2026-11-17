import { render, screen } from '@testing-library/react'
import PrivacyPage from './page'

jest.mock('../../features/shell/components/ShaderGradientBackground', () => () => null)

test('privacy page explains stored data and self-serve deletion', () => {
  render(<PrivacyPage />)
  expect(screen.getByRole('heading', { name: 'מדיניות פרטיות' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'מחיקת המידע' })).toBeInTheDocument()
  expect(screen.getByText(/מחיקת חשבון/)).toBeInTheDocument()
})

test('privacy page discloses stored planning-assistant sessions, their retention and deletion', () => {
  render(<PrivacyPage />)
  expect(screen.getByText(/שיחה עם עוזר התכנון/)).toBeInTheDocument()
  expect(screen.getByText(/90 ימים ללא פעילות/)).toBeInTheDocument()
  expect(screen.getByText(/לא נשמר העתק מלא של השיחה/)).toBeInTheDocument()
  expect(screen.getByText(/הסיכום השמור נשלחים לספק מודל ה-AI/)).toBeInTheDocument()
})

