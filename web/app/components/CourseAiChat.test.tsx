import { fireEvent, render, screen } from '@testing-library/react'
import CourseAiChat from './CourseAiChat'
import type { CourseDetailsVM } from '../../lib/course-details'

const course: CourseDetailsVM = {
  id: '0542-4241',
  name: 'בקרה מודרנית',
  weeklyHours: 3,
  credits: 3,
  category: 'בקרה ורובוטיקה',
  offered: ['A'],
  prerequisites: [{ id: '0542-2280', name: 'אותות ומערכות' }],
  syllabusUrl: null,
}

test('sending a suggested prompt asks with course context and streams the answer', async () => {
  let onChunk!: (chunk: string) => void
  const askFn = jest.fn((question, askedCourse, programId, chunkHandler) => {
    onChunk = chunkHandler
    expect(programId).toBe('mechanical_engineering_2027')
    expect(askedCourse).toBe(course)
    return new Promise<void>((resolve) => {
      onChunk('חלק ')
      onChunk('ראשון')
      resolve()
    })
  })
  render(<CourseAiChat programId="mechanical_engineering_2027" course={course} askFn={askFn} />)

  fireEvent.click(screen.getByRole('button', { name: /האם הקורס מתאים למי שמעדיף עומס קל/ }))

  expect(askFn).toHaveBeenCalledTimes(1)
  expect(askFn.mock.calls[0][0]).toBe('האם הקורס מתאים למי שמעדיף עומס קל?')
  expect(await screen.findByText('חלק ראשון')).toBeInTheDocument()
})

test('a failed request shows a Hebrew error instead of the answer', async () => {
  const askFn = jest.fn().mockRejectedValue(new Error('שליחת השאלה נכשלה. נסה שוב.'))
  render(<CourseAiChat programId="mechanical_engineering_2027" course={course} askFn={askFn} />)

  fireEvent.change(screen.getByLabelText('שאלה על הקורס'), { target: { value: 'מה לומדים בקורס?' } })
  fireEvent.click(screen.getByRole('button', { name: 'שלח ›' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('שליחת השאלה נכשלה. נסה שוב.')
})
