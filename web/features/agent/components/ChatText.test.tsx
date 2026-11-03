import { fireEvent, render, screen } from '@testing-library/react'
import ChatText from './ChatText'
import CourseClarificationAnswer from './CourseClarificationAnswer'

test('assistant text renders paragraphs, lists, bold and safe links only', () => {
  const { container } = render(<ChatText text={'בניתי לך תוכנית.\n\n**סמסטר א׳**\n- תכן ופרויקט (1)\n- מעבדת חום\n\nמקור: [מערכת השעות](https://www.tau.ac.il/x) <img src=x onerror=alert(1)> javascript:alert(1)'} />)
  expect(container.querySelectorAll('p')).toHaveLength(3)
  expect(screen.getByText('סמסטר א׳').tagName).toBe('STRONG')
  expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['תכן ופרויקט (1)', 'מעבדת חום'])
  expect(screen.getByRole('link', { name: 'מערכת השעות' })).toHaveAttribute('href', 'https://www.tau.ac.il/x')
  expect(container.querySelector('img')).toBeNull()
  expect(screen.getAllByRole('link')).toHaveLength(1)
})

test('a course question offers one-click scopes and select-all for a search', () => {
  const onConfirm = jest.fn()
  render(<CourseClarificationAnswer questionId="completed_courses" disabled={false} onConfirm={onConfirm}
    courseNameById={{ A1: 'תכן מכני (1)', A2: 'תכן מכני (2)', B1: 'חום' }}
    scopes={[{ id: 'board', label: 'הקורסים בלוח הנוכחי', courseIds: ['A1', 'B1'] }]} />)
  fireEvent.click(screen.getByRole('button', { name: 'כל הקורסים בלוח הנוכחי (2)' }))
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'תכן' } })
  fireEvent.click(screen.getByRole('button', { name: 'כל 2 התוצאות' }))
  fireEvent.click(screen.getByRole('button', { name: 'אישור 3 קורסים' }))
  expect(onConfirm).toHaveBeenCalledWith(['A1', 'B1', 'A2'], 'הקורסים שהשלמתי: תכן מכני (1), חום, תכן מכני (2)')
})
