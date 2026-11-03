'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '../../locale/LocaleProvider'

type Theme = 'light' | 'dark'

function currentTheme(): Theme {
  if (typeof document !== 'undefined' && (document.documentElement.dataset.theme === 'dark' || document.documentElement.dataset.theme === 'light')) {
    return document.documentElement.dataset.theme as Theme
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'light'
}

export default function ThemeToggle() {
  const { t } = useLocale()
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => setTheme(currentTheme()), [])

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('tau_theme', next) } catch { /* private browsing can reject storage */ }
    setTheme(next)
  }

  const dark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? t('מעבר למצב יום', 'Switch to light mode') : t('מעבר למצב לילה', 'Switch to dark mode')}
      title={dark ? t('מצב יום', 'Light mode') : t('מצב לילה', 'Dark mode')}
      className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] shadow-sm transition-colors hover:border-[var(--purple)]/50 hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]"
    >
      {dark ? t('☀ יום', '☀ Light') : t('☾ לילה', '☾ Dark')}
    </button>
  )
}

/** High-contrast palette, layered over light or dark (tau_contrast → data-contrast, seeded before paint in layout). */
export function ContrastToggle() {
  const { t } = useLocale()
  const [high, setHigh] = useState(false)
  useEffect(() => setHigh(document.documentElement.dataset.contrast === 'high'), [])
  const toggle = () => {
    const next = !high
    if (next) document.documentElement.dataset.contrast = 'high'
    else delete document.documentElement.dataset.contrast
    try { localStorage.setItem('tau_contrast', next ? 'high' : 'normal') } catch { /* private browsing can reject storage */ }
    setHigh(next)
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={high}
      aria-label={t('ניגודיות גבוהה', 'High contrast')}
      title={t('ניגודיות גבוהה', 'High contrast')}
      className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] shadow-sm transition-colors hover:border-[var(--purple)]/50 hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]"
    >
      <span aria-hidden="true">◐</span>
    </button>
  )
}
