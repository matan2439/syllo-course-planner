'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'

/**
 * Syllo animated gradient background.
 *
 * Two layers, one box:
 *  - The `.syllo-bg` CSS gradient (globals.css) is ALWAYS rendered. It is the
 *    instant first paint, the prefers-reduced-motion freeze, the WebGL-absent
 *    fallback, and the lightweight background used behind the fullBleed
 *    embedded planner. `.syllo-bg` is also the fixed, viewport-exact, clipped
 *    box that prevents phantom scroll (see shader_background_viewport_safety).
 *  - The real WebGL ShaderGradient (ShaderScene) mounts INSIDE that clip box,
 *    above the CSS layer, only when appropriate.
 *
 * Canonical ShaderGradient editor config lives in ShaderScene.tsx.
 *
 * `lightweight` (set by ProductShell for fullBleed /planner) skips WebGL
 * entirely and shows only the CSS gradient — the iframe covers the background
 * there anyway, so running three.js behind it just wastes GPU.
 */

// Client-only: three.js / @react-three/fiber need window + a WebGL context, so
// this must never render on the server.
const ShaderScene = dynamic(() => import('./ShaderScene'), { ssr: false })

function useEffectiveTheme(): 'dark' | 'light' {
  const [theme, setTheme] = useState<'dark' | 'light'>('light')
  useEffect(() => {
    // Resolve the shell theme the same way layout/LegacyPlannerFrame do:
    // explicit data-theme (seeded from tau_theme) → tau_theme → OS preference.
    const read = (): 'dark' | 'light' => {
      const attr = document.documentElement.dataset.theme
      if (attr === 'dark' || attr === 'light') return attr
      try {
        const stored = localStorage.getItem('tau_theme')
        if (stored === 'dark' || stored === 'light') return stored
      } catch {
        /* ignore */
      }
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    setTheme(read())
    // Re-read when the in-app toggle flips data-theme, or the OS theme changes.
    const observer = new MutationObserver(() => setTheme(read()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onMq = () => setTheme(read())
    mq.addEventListener('change', onMq)
    return () => {
      observer.disconnect()
      mq.removeEventListener('change', onMq)
    }
  }, [])
  return theme
}

export default function ShaderGradientBackground({
  lightweight = false,
}: {
  /** Skip WebGL and render only the CSS gradient (e.g. behind /planner). */
  lightweight?: boolean
}) {
  const [mounted, setMounted] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  useEffect(() => {
    setMounted(true)
    setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  }, [])
  const theme = useEffectiveTheme()

  const showShader = mounted && !lightweight && !reducedMotion

  return (
    <div aria-hidden className="syllo-bg">
      {showShader && <ShaderScene theme={theme} />}
    </div>
  )
}
