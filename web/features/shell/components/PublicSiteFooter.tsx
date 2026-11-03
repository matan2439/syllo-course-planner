'use client'

import Link from 'next/link'
import { useLocale } from '../../locale/LocaleProvider'

const LINKS = [
  { href: '/product', label: 'המוצר / Product', en: 'Product' },
  { href: '/pricing', label: 'חבילות ומחירים / Pricing', en: 'Plans and pricing' },
  { href: '/terms', label: 'תנאי שימוש / Terms', en: 'Terms of use' },
  { href: '/privacy', label: 'מדיניות פרטיות / Privacy', en: 'Privacy policy' },
  { href: '/refund-policy', label: 'מדיניות החזרים / Refunds', en: 'Refund policy' },
  { href: '/contact', label: 'יצירת קשר', en: 'Contact' },
] as const

export default function PublicSiteFooter() {
  const { t } = useLocale()
  return (
    <footer className="mt-auto border-t border-[var(--border)] px-2 py-6 text-center text-xs text-[var(--text-muted)]">
      <nav aria-label={t('מידע על השירות', 'Service information')} className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
        {LINKS.map(({ href, label, en }) => (
          <Link key={href} href={href} className="text-[var(--text)] underline underline-offset-4 hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--purple)]">
            {t(label, en)}
          </Link>
        ))}
      </nav>
      <p className="mt-4">{t('Syllo — כלי עצמאי לתכנון לימודים, ללא זיקה רשמית לאוניברסיטת תל אביב.', 'Syllo — an independent academic planning tool, with no official affiliation with Tel Aviv University.')}</p>
    </footer>
  )
}
