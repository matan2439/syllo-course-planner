import { fireEvent, render, screen } from '@testing-library/react'
import CourseNotesSection, { CourseNotesContext, type CourseNotesLibrary } from './CourseNotesSection'
import { programWorkspaceSchema } from '../../../../shared/planner/student-workspace'
import { validateAvatarFile, initialsOf } from '../../auth/profile-identity'

const note = { id: 'note_00000001', courseId: 'C1', kind: 'tip' as const, body: 'Start early', visibility: 'private' as const, createdAt: 1, updatedAt: 2 }

test('notes show only for their course, add with an optional lecturer, edit and delete', () => {
  const library: CourseNotesLibrary = { notes: [note, { ...note, id: 'note_00000002', courseId: 'C2', body: 'Other course' }], ready: true, save: jest.fn(), remove: jest.fn() }
  render(<CourseNotesContext.Provider value={library}><CourseNotesSection courseId="C1" /></CourseNotesContext.Provider>)
  expect(screen.getByText('Start early')).toBeInTheDocument()
  expect(screen.queryByText('Other course')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'הוספת הערה' }))
  fireEvent.change(screen.getByLabelText('מרצה (לא חובה)'), { target: { value: 'ד״ר כהן' } })
  fireEvent.change(screen.getByLabelText('ההערה'), { target: { value: 'Great lectures' } })
  fireEvent.click(screen.getByRole('button', { name: 'שמירה' }))
  expect(library.save).toHaveBeenCalledWith({ id: undefined, courseId: 'C1', kind: 'experience', body: 'Great lectures', lecturer: 'ד״ר כהן' })

  fireEvent.click(screen.getByRole('button', { name: 'מחיקה' }))
  expect(library.remove).toHaveBeenCalledWith('note_00000001')
})

test('outside the planner (no library) the section renders nothing', () => {
  const { container } = render(<CourseNotesSection courseId="C1" />)
  expect(container).toBeEmptyDOMElement()
})

test('the workspace document accepts private notes and rejects public ones or duplicates', () => {
  expect(programWorkspaceSchema.safeParse({ courseNotes: [note] }).success).toBe(true)
  expect(programWorkspaceSchema.safeParse({ courseNotes: [{ ...note, visibility: 'community' }] }).success).toBe(false)
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
