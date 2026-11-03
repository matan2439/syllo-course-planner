import { act, fireEvent, render, screen } from '@testing-library/react'
import CourseNotesSection, { CourseNotesContext, type CourseNotesLibrary } from './CourseNotesSection'
import * as client from '../../planner/lib/student-workspace-client'
import * as auth from '../../auth/AuthProvider'
import { programWorkspaceSchema } from '../../../../shared/planner/student-workspace'
import { validateAvatarFile, initialsOf } from '../../auth/profile-identity'

const signedIn = (on: boolean) => jest.spyOn(auth, 'useAuth').mockReturnValue({ user: on ? { id: 'u1' } : null } as ReturnType<typeof auth.useAuth>)
const shared = { id: '11111111-1111-4111-8111-111111111111', courseId: 'C1', kind: 'tip' as const, lecturer: 'ד״ר לוי', body: 'Shared tip', updatedAt: 3, mine: false, reported: false }
beforeEach(() => { jest.spyOn(client, 'fetchCommunityNotes').mockResolvedValue([]); signedIn(false) })
afterEach(() => jest.restoreAllMocks())

const note = { id: 'note_00000001', courseId: 'C1', kind: 'tip' as const, body: 'Start early', visibility: 'private' as const, createdAt: 1, updatedAt: 2 }

test('notes show only for their course, add with an optional lecturer, edit and delete', async () => {
  const library: CourseNotesLibrary = { notes: [note, { ...note, id: 'note_00000002', courseId: 'C2', body: 'Other course' }], ready: true, save: jest.fn(), remove: jest.fn() }
  render(<CourseNotesContext.Provider value={library}><CourseNotesSection courseId="C1" /></CourseNotesContext.Provider>)
  expect(screen.getByText('Start early')).toBeInTheDocument()
  expect(screen.queryByText('Other course')).toBeNull()
  await act(async () => {})

  fireEvent.click(screen.getByRole('button', { name: 'הוספת הערה' }))
  fireEvent.change(screen.getByLabelText('מרצה (לא חובה)'), { target: { value: 'ד״ר כהן' } })
  fireEvent.change(screen.getByLabelText('ההערה'), { target: { value: 'Great lectures' } })
  fireEvent.click(screen.getByRole('button', { name: 'שמירה' }))
  expect(library.save).toHaveBeenCalledWith({ id: undefined, courseId: 'C1', kind: 'experience', body: 'Great lectures', lecturer: 'ד״ר כהן', visibility: 'private' })

  fireEvent.click(screen.getByRole('button', { name: 'מחיקה' }))
  expect(library.remove).toHaveBeenCalledWith('note_00000001')
})

test('shared notes from others show without an author; signed-in students can share and report', async () => {
  jest.spyOn(client, 'fetchCommunityNotes').mockResolvedValue([shared, { ...shared, id: '22222222-2222-4222-8222-222222222222', body: 'Mine', mine: true }])
  const reportSpy = jest.spyOn(client, 'reportCommunityNote').mockResolvedValue()
  signedIn(true)
  const library: CourseNotesLibrary = { notes: [], ready: true, save: jest.fn(), remove: jest.fn() }
  render(<CourseNotesContext.Provider value={library}><CourseNotesSection courseId="C1" /></CourseNotesContext.Provider>)
  expect(await screen.findByText('Shared tip')).toBeInTheDocument()
  expect(screen.getByText('טיפ · מרצה: ד״ר לוי')).toBeInTheDocument()
  expect(screen.queryByText('Mine')).toBeNull() // your own shared note is listed under "My notes"
  fireEvent.click(screen.getByRole('button', { name: 'דיווח על תוכן לא הולם' }))
  expect(reportSpy).toHaveBeenCalledWith(shared.id)
  expect(screen.getByText('דיווחת על ההערה')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'הוספת הערה' }))
  fireEvent.change(screen.getByLabelText('ההערה'), { target: { value: 'Worth it' } })
  fireEvent.click(screen.getByLabelText('לשתף באופן אנונימי עם סטודנטים אחרים'))
  fireEvent.click(screen.getByRole('button', { name: 'שמירה' }))
  expect(library.save).toHaveBeenCalledWith(expect.objectContaining({ body: 'Worth it', visibility: 'community' }))
})

test('signed out: shared notes are readable, but sharing and reporting need an account', async () => {
  jest.spyOn(client, 'fetchCommunityNotes').mockResolvedValue([shared])
  render(<CourseNotesSection courseId="C1" />) // outside the planner: no private notes
  expect(await screen.findByText('Shared tip')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'דיווח על תוכן לא הולם' })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'ההערות שלי' })).toBeNull()
})

test('the workspace document accepts private and shared notes and rejects unknown visibility or duplicates', () => {
  expect(programWorkspaceSchema.safeParse({ courseNotes: [note] }).success).toBe(true)
  expect(programWorkspaceSchema.safeParse({ courseNotes: [{ ...note, visibility: 'community' }] }).success).toBe(true)
  expect(programWorkspaceSchema.safeParse({ courseNotes: [{ ...note, visibility: 'public' }] }).success).toBe(false)
  expect(programWorkspaceSchema.safeParse({ courseNotes: [note, note] }).success).toBe(false)
})

test('avatar validation accepts small JPEG/PNG/WebP only; initials fallback', () => {
  expect(validateAvatarFile({ type: 'image/png', size: 1000 })).toBeNull()
  expect(validateAvatarFile({ type: 'image/gif', size: 1000 })).toBe('type')
  expect(validateAvatarFile({ type: 'image/svg+xml', size: 1000 })).toBe('type')
  expect(validateAvatarFile({ type: 'image/jpeg', size: 6 * 1024 * 1024 })).toBe('size')
  expect(initialsOf('מתן אהרון')).toBe('מא')
  expect(initialsOf('  ', '?')).toBe('?')
})
