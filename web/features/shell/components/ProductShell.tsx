import Link from 'next/link'
import type { ReactNode } from 'react'
import { getProgram, programQuery } from '../../../lib/programs'
import BrandLogo from './BrandLogo'
import ShaderGradientBackground from './ShaderGradientBackground'
import ThemeToggle from './ThemeToggle'

/**
 * Shared product frame for planner-facing Next pages: gradient background,
 * brand header, section navigation, page container. Keeps /, /planner and
 * /programs visually continuous.
 */
export default function ProductShell({
  title,
  subtitle,
  width = 'wide',
  programId,
  progress,
  preferLightweightBackground,
  children,
}: {
  title?: string
  subtitle?: string
  width?: 'wide' | 'narrow' | 'full'
  /** Shows the program chip (links to /programs to switch). */
  programId?: string
  /** Slot next to the program chip, e.g. the requirements progress strip. */
  progress?: ReactNode
  /** Force the cheap CSS-only background (no WebGL shader). Off by default; a route whose content
   *  covers the background can opt in to save the GPU. */
  preferLightweightBackground?: boolean
  children: ReactNode
}) {
  const query = programQuery(programId)
  const program = programId ? getProgram(programId) : null
  const programLabel = program
    ? [program.name, program.track, program.year].filter(Boolean).join(' · ')
    : ''
  const lightweightBg = preferLightweightBackground ?? false
  return (
    <>
      <ShaderGradientBackground lightweight={lightweightBg} />

      <div
        className={`mx-auto flex min-h-screen flex-col px-4 sm:px-6 ${
          width === 'full' ? 'max-w-[1680px]' : width === 'wide' ? 'max-w-6xl' : 'max-w-5xl'
        }`}
      >
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 py-5">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--purple)]"
          >
            <BrandLogo size={26} />
          </Link>

          <nav className="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:flex-nowrap">
            {programId && (
              <Link
                href={`/programs${query}`}
                aria-label={`תוכנית: ${programLabel}. החלפת תוכנית`}
                className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]"
              >
                {programLabel} <span aria-hidden="true">▾</span>
              </Link>
            )}
            {progress}
            <ThemeToggle />
          </nav>
        </header>

        <main className="flex-1 pb-16">
          {title && (
            <div className="rise mb-6">
              <h1 className="text-xl font-bold tracking-tight">{title}</h1>
              {subtitle && (
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  {subtitle}
                </p>
              )}
            </div>
          )}
          {children}
        </main>
      </div>
    </>
  )
}
