import { fireEvent, render, screen } from '@testing-library/react'
import type { RepositoryVM } from '../../lib/repository'
import RepositoryExplorer from './RepositoryExplorer'

const repo: RepositoryVM = {
  totalCourses: 2,
  categories: [{
    id: 'design',
    title: 'תכן',
    courses: [
      { id: '0542-4101', name: 'תכן מכני', weeklyHours: 3, offered: ['A'], difficulty: null, syllabusUrl: null },
      { id: '0542-4102', name: 'פרויקט תכן', weeklyHours: 4, offered: ['B'], difficulty: null, syllabusUrl: null },
    ],
  }],
}

test('standalone repository keeps its existing search and details behavior', () => {
  render(<RepositoryExplorer repo={repo} />)

  fireEvent.change(screen.getByRole('searchbox', { name: 'חיפוש קורס' }), {
    target: { value: 'פרויקט' },
  })
  expect(screen.getByText('פרויקט תכן')).toBeInTheDocument()
  expect(screen.queryByText('תכן מכני')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: /פרויקט תכן/ }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})
