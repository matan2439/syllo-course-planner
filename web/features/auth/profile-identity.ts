'use client'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './AuthProvider'

export type ProfileIdentity = { display_name: string | null; faculty: string | null; degree: string | null; avatar_data_url: string | null }
const EMPTY: ProfileIdentity = { display_name: null, faculty: null, degree: null, avatar_data_url: null }
/** Device cache: the signed-out copy, and the fallback until auth/003 is applied on the server. */
export const IDENTITY_KEY = 'syllo_profile_identity'
const CHANGED = 'syllo:identity-changed'

export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const AVATAR_MAX_INPUT_BYTES = 5 * 1024 * 1024
export const AVATAR_SIZE = 256
export const AVATAR_MAX_DATA_URL = 200_000

export type AvatarError = 'type' | 'size'
/** Rejects anything but a reasonably sized JPEG/PNG/WebP before decoding it. */
export function validateAvatarFile(file: Pick<File, 'type' | 'size'>): AvatarError | null {
  if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) return 'type'
  if (file.size > AVATAR_MAX_INPUT_BYTES) return 'size'
  return null
}

/** Center-crops to a square and re-encodes as a 256×256 JPEG data URL (drops EXIF/metadata on the way). */
export async function resizeAvatar(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = AVATAR_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('decode')
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
  bitmap.close?.()
  for (const quality of [0.85, 0.7, 0.5]) {
    const url = canvas.toDataURL('image/jpeg', quality)
    if (url.length <= AVATAR_MAX_DATA_URL) return url
  }
  throw new Error('size')
}

function readLocal(): ProfileIdentity {
  try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(IDENTITY_KEY) ?? '{}') } } catch { return EMPTY }
}

/** Server copy wins field by field when present (same rule as the rest of the profile); the device fills gaps. */
export function useProfileIdentity() {
  const { profile, user, updateProfile } = useAuth()
  const [local, setLocal] = useState<ProfileIdentity>(EMPTY)
  useEffect(() => {
    setLocal(readLocal())
    const sync = () => setLocal(readLocal())
    window.addEventListener(CHANGED, sync)
    return () => window.removeEventListener(CHANGED, sync)
  }, [])
  const identity: ProfileIdentity = {
    display_name: profile?.display_name ?? local.display_name,
    faculty: profile?.faculty ?? local.faculty,
    degree: profile?.degree ?? local.degree,
    avatar_data_url: profile?.avatar_data_url ?? local.avatar_data_url,
  }
  const save = useCallback(async (patch: Partial<ProfileIdentity>) => {
    const next = { ...readLocal(), ...patch }
    try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(next)) } catch { /* storage full/blocked: server copy only */ }
    window.dispatchEvent(new Event(CHANGED))
    if (user) await updateProfile(patch)
  }, [user, updateProfile])
  return { identity, save }
}

export function initialsOf(name: string | null | undefined, fallback = '?'): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return parts.length ? parts.slice(0, 2).map((p) => p[0]).join('') : fallback
}
