'use client'

import { useEffect } from 'react'

type Theme = 'light' | 'dark'

function resolvedTheme(): Theme {
  const explicit = document.documentElement.dataset.theme
  if (explicit === 'dark' || explicit === 'light') return explicit
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function faviconFor(theme: Theme) {
  return theme === 'dark'
    ? '/brand/syllo-mark-dark.png'
    : '/brand/syllo-mark-light.png'
}

/** Keeps the browser tab icon in step with both automatic and manual themes. */
export default function ThemeAwareFavicon() {
  useEffect(() => {
    const icon = document.getElementById('syllo-favicon') as HTMLLinkElement | null
    if (!icon) return

    const sync = () => { icon.href = faviconFor(resolvedTheme()) }
    sync()

    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    media?.addEventListener('change', sync)
    return () => {
      observer.disconnect()
      media?.removeEventListener('change', sync)
    }
  }, [])

  return null
}
