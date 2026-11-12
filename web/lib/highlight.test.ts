import { highlightElement, HIGHLIGHT_MS } from './highlight'
import { HIGHLIGHT_EVENT } from '../../shared/planner/ui-highlight'

beforeEach(() => { jest.useFakeTimers(); document.body.innerHTML = '' })
afterEach(() => { jest.useRealTimers() })

/** jsdom lays nothing out: report the element as visible. */
const visible = (element: HTMLElement) => { element.getClientRects = () => [{}] as unknown as DOMRectList; return element }

test('scrolls the target into view, marks it for a moment, then clears the mark', async () => {
  document.body.innerHTML = '<div data-highlight-id="course:0509-1234">card</div>'
  const card = visible(document.querySelector<HTMLElement>('[data-highlight-id]')!)
  card.scrollIntoView = jest.fn()
  const found = highlightElement('course:0509-1234')
  jest.advanceTimersByTime(1)
  await expect(found).resolves.toBe(true)
  expect(card.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }))
  expect(card).toHaveAttribute('data-highlighted', 'true')
  jest.advanceTimersByTime(HIGHLIGHT_MS)
  expect(card).not.toHaveAttribute('data-highlighted')
})

test('announces the target first, so its owner can reveal a hidden element before it is looked up', async () => {
  const reveal = jest.fn((event: Event) => {
    expect((event as CustomEvent).detail).toEqual({ target: 'filter:grade' })
    document.body.innerHTML = '<details data-highlight-id="filter:grade"><summary>ממוצע</summary></details>'
    visible(document.querySelector<HTMLElement>('[data-highlight-id]')!).scrollIntoView = jest.fn()
  })
  window.addEventListener(HIGHLIGHT_EVENT, reveal)
  const found = highlightElement('filter:grade')
  jest.advanceTimersByTime(1)
  await expect(found).resolves.toBe(true)
  window.removeEventListener(HIGHLIGHT_EVENT, reveal)
  expect(reveal).toHaveBeenCalledTimes(1)
  expect(document.querySelector('details')).toHaveAttribute('open') // a collapsed section is opened
})

test('an element that never appears resolves false and marks nothing', async () => {
  const found = highlightElement('course:missing')
  jest.advanceTimersByTime(2000)
  await expect(found).resolves.toBe(false)
  expect(document.querySelector('[data-highlighted]')).toBeNull()
})