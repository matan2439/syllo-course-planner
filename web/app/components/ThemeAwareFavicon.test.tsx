import { render, waitFor } from '@testing-library/react'
import ThemeAwareFavicon from './ThemeAwareFavicon'

function faviconHref() {
  return document.getElementById('syllo-favicon')?.getAttribute('href')
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'dark'
  document.head.innerHTML = '<link id="syllo-favicon" rel="icon" type="image/png" href="/brand/syllo-mark-light.png">'
})

afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
  document.head.innerHTML = ''
})

test('keeps the browser icon aligned with explicit theme changes', async () => {
  render(<ThemeAwareFavicon />)

  await waitFor(() => expect(faviconHref()).toBe('/brand/syllo-mark-dark.png'))

  document.documentElement.dataset.theme = 'light'
  await waitFor(() => expect(faviconHref()).toBe('/brand/syllo-mark-light.png'))
})
