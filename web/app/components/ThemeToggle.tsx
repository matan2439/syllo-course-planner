'use client'

import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

function currentTheme(): Theme {
  if (typeof document !== 'undefined' && (document.documentElement.dataset.theme === 'dark' || document.documentElement.dataset.theme === 'light')) {
    return document.documentElement.dataset.theme as Theme
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'light'
}

export default function ThemeToggle() {
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
      aria-label={dark ? 'מעבר למצב יום' : 'מעבר למצב לילה'}
      title={dark ? 'מצב יום' : 'מצב לילה'}
      className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] shadow-sm transition-colors hover:border-[var(--purple)]/50 hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]"
    >
      {dark ? '☀ יום' : '☾ לילה'}
    </button>
  )
}
