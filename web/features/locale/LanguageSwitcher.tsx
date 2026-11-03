'use client'

import { useLocale, useLocaleSyncStatus } from './LocaleProvider'

export default function LanguageSwitcher() {
  const { locale, setLocale, t } = useLocale()
  const status = useLocaleSyncStatus()
  const message = status === 'synced' ? t('השפה נשמרה בחשבון.', 'Language saved to your account.')
    : status === 'loading' ? t('טעינת השפה מהחשבון…', 'Loading your account language…')
      : status === 'saving' ? t('שמירת השפה בחשבון…', 'Saving your account language…')
        : status === 'error' ? t('לא ניתן לסנכרן כרגע. השפה נשמרה במכשיר הזה.', 'Could not sync right now; saved on this device.')
          : t('השפה נשמרת במכשיר הזה.', 'Language is saved on this device.')
  return (
    <div className="space-y-1.5 border-b border-[var(--border)] pb-3">
      <div role="group" aria-label={t('שפת הממשק', 'Interface language')} className="flex items-center gap-2">
        <span className="me-auto text-xs text-[var(--text-muted)]">{t('שפה', 'Language')}</span>
        {(['he', 'en'] as const).map((choice) => (
          <button key={choice} type="button" lang={choice} dir={choice === 'he' ? 'rtl' : 'ltr'}
            aria-pressed={locale === choice} onClick={() => setLocale(choice)}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)] ${locale === choice ? 'border-[var(--purple)] bg-[var(--purple)]/10 text-[var(--purple)]' : 'border-[var(--border)] text-[var(--text)] hover:border-[var(--purple)]/50'}`}>
            {choice === 'he' ? 'עברית' : 'English'}
          </button>
        ))}
      </div>
      <p role={status === 'error' ? 'status' : undefined} aria-live="polite" className="text-[10px] leading-relaxed text-[var(--text-muted)]">{message}</p>
    </div>
  )
}
