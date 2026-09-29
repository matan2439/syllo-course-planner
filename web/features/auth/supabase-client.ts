import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null | undefined

/**
 * The browser Supabase client, or null when auth is not configured (the app then
 * behaves exactly as before accounts existed). Only the PUBLISHABLE key is ever
 * shipped here; authorization is enforced by RLS and by the API verifying the JWT.
 * The session lives in cookies, so same-origin API calls carry it automatically.
 */
export function getBrowserSupabase(): SupabaseClient | null {
  if (client !== undefined) return client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  client = url && anonKey && typeof window !== 'undefined' ? createBrowserClient(url, anonKey) : null
  return client
}
