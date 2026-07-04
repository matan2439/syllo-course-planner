import Link from 'next/link'
import type { ReactNode } from 'react'
import { programQuery } from '../../lib/programs'
import BrandLogo from './BrandLogo'
import ShaderGradientBackground from './ShaderGradientBackground'

const NAV_ITEMS = [
  { key: 'plan', href: '/plan', label: 'תכנון' },
  { key: 'board', href: '/board', label: 'לוח סמסטרים' },
  { key: 'repository', href: '/repository', label: 'מאגר קורסים' },
] as const

export type ShellSection = (typeof NAV_ITEMS)[number]['key']

/**
 * Shared product frame for planner-facing Next pages: gradient background,
 * brand header, section navigation, page container. Keeps /, /plan, /board
 * and /repository visually continuous.
 */
export default function ProductShell({
  active,
  title,
  subtitle,
  width = 'wide',
  programId,
  children,
}: {
  active?: ShellSection
  title: string
  subtitle?: string
  width?: 'wide' | 'narrow'
  /** Non-default selections are preserved across section navigation. */
  programId?: string
  children: ReactNode
}) {
  const query = programQuery(programId)
  return (
    <>
      <ShaderGradientBackground />

      <div
        className={`mx-auto flex min-h-screen flex-col px-4 sm:px-6 ${
          width === 'wide' ? 'max-w-6xl' : 'max-w-5xl'
        }`}
      >
        <header className="flex items-center justify-between gap-3 py-5">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--purple)]"
          >
            <BrandLogo size={26} />
            <span className="hidden text-sm font-semibold tracking-tight sm:inline">
              מתכנן לימודים
            </span>
          </Link>

          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.key}
                href={`${item.href}${query}`}
                aria-current={item.key === active ? 'page' : undefined}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)] ${
                  item.key === active
                    ? 'bg-purple-600/10 text-purple-700 dark:bg-purple-400/10 dark:text-purple-300'
                    : 'text-[var(--text-muted)] hover:text-[var(--purple)]'
                }`}
              >
                {item.label}
              </Link>
            ))}
            <Link
              href={`/ai-plan${query}`}
              className="ms-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 text-xs font-medium transition-colors duration-150 hover:border-purple-500/40 hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]"
            >
              תכנון עם AI
            </Link>
          </nav>
        </header>

        <main className="flex-1 pb-16">
          <div className="rise mb-6">
            <h1 className="text-xl font-bold tracking-tight">{title}</h1>
            {subtitle && (
              <p className="mt-1 text-sm text-[var(--text-muted)]">{subtitle}</p>
            )}
          </div>
          {children}
        </main>
      </div>
    </>
  )
}
