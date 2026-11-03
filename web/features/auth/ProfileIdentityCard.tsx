'use client'
import { useRef, useState, type FocusEvent } from 'react'
import { useLocale } from '../locale/LocaleProvider'
import { initialsOf, resizeAvatar, useProfileIdentity, validateAvatarFile } from './profile-identity'

const FIELD = 'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text)]'

/** Round avatar: the student's picture, else their initials, else a person glyph. */
export function Avatar({ src, name, size = 30 }: { src?: string | null; name?: string | null; size?: number }) {
  if (src) return <img src={src} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />
  return (
    <span aria-hidden="true" className="flex items-center justify-center rounded-full bg-[var(--purple)]/20 font-bold text-[var(--purple-strong)]"
      style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {name?.trim() ? initialsOf(name) : (
        <svg viewBox="0 0 24 24" width={size * 0.55} height={size * 0.55} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
        </svg>
      )}
    </span>
  )
}

/** Picture + display name, faculty, degree. The year in the degree is the existing profile control below. */
export default function ProfileIdentityCard({ defaultDegree }: { defaultDegree?: string }) {
  const { t } = useLocale()
  const { identity, save } = useProfileIdentity()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const text = (key: 'display_name' | 'faculty' | 'degree', max: number) => ({
    defaultValue: identity[key] ?? (key === 'degree' ? defaultDegree ?? '' : ''),
    maxLength: max,
    onBlur: (e: FocusEvent<HTMLInputElement>) => {
      const value = e.target.value.trim() || null
      if (value !== identity[key]) void save({ [key]: value })
    },
  })
  const pick = async (file: File | undefined) => {
    if (!file) return
    const invalid = validateAvatarFile(file)
    if (invalid) {
      setError(invalid === 'type' ? t('אפשר להעלות JPG, PNG או WebP בלבד.', 'Upload a JPG, PNG or WebP image.') : t('התמונה גדולה מ־5MB.', 'The image is larger than 5 MB.'))
      return
    }
    setBusy(true); setError(null)
    try { await save({ avatar_data_url: await resizeAvatar(file) }) }
    catch { setError(t('לא הצלחנו לקרוא את התמונה. נסו קובץ אחר.', 'Could not read that image. Try another file.')) }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }
  return (
    <section aria-label={t('פרטים אישיים', 'Personal details')} className="mb-5 flex flex-col gap-3 text-xs">
      <div className="flex items-center gap-3">
        <Avatar src={identity.avatar_data_url} name={identity.display_name} size={56} />
        <div className="flex flex-col items-start gap-1">
          <label className="cursor-pointer text-[var(--purple-strong)] underline">
            {busy ? t('מעבד…', 'Processing…') : t('העלאת תמונה', 'Upload picture')}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy}
              aria-label={t('תמונת פרופיל', 'Profile picture')} onChange={(e) => void pick(e.target.files?.[0])} />
          </label>
          {identity.avatar_data_url && <button type="button" className="text-[var(--text-muted)] underline" onClick={() => void save({ avatar_data_url: null })}>{t('הסרת תמונה', 'Remove picture')}</button>}
        </div>
      </div>
      {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
      {/* Remount on a server value change so a late profile load fills the fields. */}
      <label className="flex flex-col gap-1">{t('שם לתצוגה', 'Display name')}<input key={`n:${identity.display_name}`} className={FIELD} {...text('display_name', 60)} /></label>
      <label className="flex flex-col gap-1">{t('פקולטה', 'Faculty')}<input key={`f:${identity.faculty}`} className={FIELD} {...text('faculty', 80)} /></label>
      <label className="flex flex-col gap-1">{t('תואר', 'Degree')}<input key={`d:${identity.degree}`} className={FIELD} {...text('degree', 80)} /></label>
    </section>
  )
}
