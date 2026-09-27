import { act, fireEvent, render, screen } from '@testing-library/react'
import CourseAiChat, { type CourseAskRequest } from './CourseAiChat'
import type { CourseDetailsVM } from '../../../lib/course-details'

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

test('suggestion chips come from the course data, and a chip asks with course, program and student context', async () => {
  const studentContext = { plan_context: { semesters: [] }, preferences: { max_weekly_hours: 18 } }
  const askFn = jest.fn(async (_request: CourseAskRequest, onChunk: (chunk: string) => void) => {
    onChunk('חלק ')
    onChunk('ראשון')
  })
  render(
    <CourseAiChat
      programId="mechanical_engineering_2027"
      course={course}
      suggestions={['מה אומרים הציונים בבקרה מודרנית (ממוצע 81.2)?']}
      getStudentContext={() => studentContext}
      askFn={askFn}
    />,
  )

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /ממוצע 81.2/ })) })

  expect(askFn).toHaveBeenCalledTimes(1)
  expect(askFn.mock.calls[0][0]).toEqual({
    question: 'מה אומרים הציונים בבקרה מודרנית (ממוצע 81.2)?',
    course,
    programId: 'mechanical_engineering_2027',
    history: [],
    studentContext,
  })
  expect(await screen.findByText('חלק ראשון')).toBeInTheDocument()
  // An asked chip is not offered again.
  expect(screen.queryByRole('button', { name: /ממוצע 81.2/ })).not.toBeInTheDocument()
})

test('a follow-up question carries the earlier turns as history', async () => {
  const askFn = jest.fn(async (request: CourseAskRequest, onChunk: (chunk: string) => void) => {
    onChunk(`תשובה ${request.history.length}`)
  })
  render(<CourseAiChat programId="p" course={course} suggestions={[]} askFn={askFn} />)

  fireEvent.change(screen.getByLabelText('שאלה על הקורס'), { target: { value: 'מה לומדים?' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'שלח ›' })) })
  expect(await screen.findByText('תשובה 0')).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('שאלה על הקורס'), { target: { value: 'ומה עם המבחן?' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'שלח ›' })) })
  expect(await screen.findByText('תשובה 2')).toBeInTheDocument()
  expect(askFn.mock.calls[1][0].history).toEqual([
    { role: 'user', content: 'מה לומדים?' },
    { role: 'assistant', content: 'תשובה 0' },
  ])
})

test('no chips while suggestions load — nothing generic is shown in their place', () => {
  render(<CourseAiChat programId="p" course={course} suggestions={null} askFn={jest.fn()} />)
  expect(screen.queryAllByRole('button', { name: /💬/ })).toHaveLength(0)
})

test('a failed request shows a Hebrew error and leaves no half-turn in the history', async () => {
  const askFn = jest.fn().mockRejectedValueOnce(new Error('שליחת השאלה נכשלה. נסה שוב.'))
  render(<CourseAiChat programId="p" course={course} suggestions={[]} askFn={askFn} />)

  fireEvent.change(screen.getByLabelText('שאלה על הקורס'), { target: { value: 'מה לומדים בקורס?' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'שלח ›' })) })

  expect(await screen.findByRole('alert')).toHaveTextContent('שליחת השאלה נכשלה. נסה שוב.')
  askFn.mockImplementationOnce(async (_request: CourseAskRequest, onChunk: (chunk: string) => void) => onChunk('בסדר'))
  fireEvent.change(screen.getByLabelText('שאלה על הקורס'), { target: { value: 'שוב' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'שלח ›' })) })
  expect(await screen.findByText('בסדר')).toBeInTheDocument()
  expect(askFn.mock.calls[1][0].history).toEqual([])
})
