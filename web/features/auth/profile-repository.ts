import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CURRENT_DEGREE_YEAR_KEY, DEGREE_YEARS } from '../../lib/planner/semester-window'
import { LAST_PROGRAM_KEY } from '../shell/last-program'

/** public.profiles — the student profile (RLS: a user reads/edits only their own row). */
export const profileSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  role: z.enum(['user', 'developer']),
  program_id: z.string().nullable(),
  current_degree_year: z.number().int().min(1).max(4).nullable(),
  /** Server-set entitlement: AI use is not charged in Syllo Credits. */
  billing_exempt: z.boolean().default(false),
  created_at: z.string(),
  updated_at: z.string(),
})
export type Profile = z.infer<typeof profileSchema>

/** The only columns a client may write (mirrors the column GRANT in the migration). */
export type ProfilePatch = Partial<Pick<Profile, 'program_id' | 'current_degree_year'>>

export async function fetchProfile(client: SupabaseClient, userId: string): Promise<Profile | null> {
  const { data, error } = await client.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) throw error
  return data ? profileSchema.parse(data) : null
}

export async function saveProfile(client: SupabaseClient, userId: string, patch: ProfilePatch): Promise<Profile> {
  const { data, error } = await client.from('profiles').update(patch).eq('id', userId).select('*').single()
  if (error) throw error
  return profileSchema.parse(data)
}

/**
 * The signed-in user's Syllo Credits balance (RLS: own row only, read-only).
 * No account row yet → 0. Unavailable (e.g. migration not applied) → null, so the UI hides it.
 */
export async function fetchCreditBalance(client: SupabaseClient, userId: string): Promise<number | null> {
  const { data, error } = await client.from('credit_accounts').select('balance').eq('user_id', userId).maybeSingle()
  if (error) return null
  return data ? Number(data.balance) : 0
}

/**
 * Local → server migration, per field, deterministic:
 *   server has a value → SERVER WINS (and refreshes the local cache);
 *   server empty, device has one → the DEVICE value is uploaded.
 * Local storage is never cleared; it stays the signed-out cache.
 */
export function reconcileProfile(server: Profile, local: LocalProfile): { upload: ProfilePatch; cache: LocalProfile } {
  const upload: ProfilePatch = {}
  if (server.program_id == null && local.program_id) upload.program_id = local.program_id
  if (server.current_degree_year == null && local.current_degree_year != null) {
    upload.current_degree_year = local.current_degree_year
  }
  return {
    upload,
    cache: {
      program_id: server.program_id ?? local.program_id,
      current_degree_year: server.current_degree_year ?? local.current_degree_year,
    },
  }
}

type LocalProfile = { program_id: string | null; current_degree_year: number | null }

/** The signed-out device cache (localStorage) of the profile fields. */
export function readLocalProfile(): LocalProfile {
  try {
    const year = Number(localStorage.getItem(CURRENT_DEGREE_YEAR_KEY))
    return {
      program_id: localStorage.getItem(LAST_PROGRAM_KEY) || null,
      current_degree_year: (DEGREE_YEARS as readonly number[]).includes(year) ? year : null,
    }
  } catch {
    return { program_id: null, current_degree_year: null }
  }
}

export function writeLocalProfile(cache: LocalProfile): void {
  try {
    if (cache.program_id) localStorage.setItem(LAST_PROGRAM_KEY, cache.program_id)
    if (cache.current_degree_year != null) localStorage.setItem(CURRENT_DEGREE_YEAR_KEY, String(cache.current_degree_year))
  } catch { /* storage unavailable: the account copy still holds it */ }
}
