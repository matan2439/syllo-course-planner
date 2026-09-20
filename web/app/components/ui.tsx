/**
 * Minimal design primitives for the Next frontend. Tokens live in
 * globals.css (:root); keep variants limited to what's actually used.
 */
import type { ReactNode } from 'react'

export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-xl border border-[var(--border)] bg-[var(--surface)] backdrop-blur-sm ${className}`}
    >
      {children}
    </div>
  )
}

const BADGE_VARIANTS = {
  neutral: 'bg-black/[.04] text-[var(--text-muted)] dark:bg-white/[.06]',
  purple: 'bg-purple-600/10 text-purple-700 dark:bg-purple-400/10 dark:text-purple-300',
  warn: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  success: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
} as const

export function Badge({
  variant = 'neutral',
  children,
}: {
  variant?: keyof typeof BADGE_VARIANTS
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 ${BADGE_VARIANTS[variant]}`}
    >
      {children}
    </span>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
      {children}
    </div>
  )
}
