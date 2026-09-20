'use client'

import type { ReactNode } from 'react'

// Next App Router remounts this on every navigation, so a single CSS class
// gives every surface a subtle, fast route-entrance transition. Vertical-only
// motion keeps it RTL-safe; the global prefers-reduced-motion rule freezes it.
export default function Template({ children }: { children: ReactNode }) {
  return <div className="route-fade">{children}</div>
}
