/**
 * auth_session.ts — who is signed in (Supabase Auth), verified on the server.
 *
 * The browser keeps its Supabase session in cookies (`@supabase/ssr`), so every
 * same-origin API call already carries it. We never trust the cookie's contents:
 * `auth.getClaims()` verifies the access token's signature (JWKS for asymmetric
 * keys, Auth server round-trip otherwise) and only then yields a user id.
 *
 * Only the PUBLISHABLE (anon) key is used here — no service-role secret exists in
 * this codebase. When the env is not configured, auth is simply off and every
 * caller falls back to the anonymous owner cookie.
 */
import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import { adoptAnonymousPlannerState } from './apply_runtime';
import {
  appendSetCookie,
  clearSessionCookie,
  readAnonymousOwner,
  resolveOwner,
  type OwnerRequestLike,
  type OwnerResponseLike,
  type ResolvedOwner,
} from './session_owner';

export interface SupabaseAuthConfig {
  url: string;
  anonKey: string;
}

export function supabaseAuthConfig(env: NodeJS.ProcessEnv = process.env): SupabaseAuthConfig | null {
  const url = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const anonKey = (env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
  return url && anonKey ? { url, anonKey } : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The verified Supabase user id for this request, or null (signed out, invalid, or auth off). */
export async function verifiedUserId(
  req: OwnerRequestLike,
  res: OwnerResponseLike,
  config: SupabaseAuthConfig | null = supabaseAuthConfig(),
): Promise<string | null> {
  if (!config) return null;
  const rawCookie = req.headers?.cookie;
  const header = Array.isArray(rawCookie) ? rawCookie.join('; ') : rawCookie ?? '';
  // No Supabase auth cookie at all → signed out; skip building a client.
  if (!/(^|;\s*)sb-[^=]*-auth-token/.test(header)) return null;

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => parseCookieHeader(header).map(({ name, value }) => ({ name, value: value ?? '' })),
      // A token refresh rotates the session cookies; hand them back to the browser.
      setAll: (cookies, headers) => {
        for (const { name, value, options } of cookies) appendSetCookie(res, serializeCookieHeader(name, value, options));
        for (const [key, value] of Object.entries(headers ?? {})) res.setHeader(key, value);
      },
    },
  });
  try {
    const { data, error } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub;
    return !error && typeof sub === 'string' && UUID.test(sub) ? sub : null;
  } catch {
    return null; // an unverifiable session is treated as signed out, never as a user
  }
}

/**
 * The owner id of a signed-in account. The `:` can never pass
 * `isWellFormedOwnerId`, so no anonymous cookie can ever claim an account's records.
 */
export function accountOwnerId(userId: string): string {
  return `auth:${userId}`;
}

export interface ResolveRequestOwnerDeps {
  verifyUser?: (req: OwnerRequestLike, res: OwnerResponseLike) => Promise<string | null>;
  adopt?: (fromOwnerId: string, toOwnerId: string) => Promise<boolean>;
}

/**
 * The single ownership entry point for durable planner endpoints.
 *
 * Signed in → the account owns the records, on every device. The first signed-in
 * request from a browser that still carries an anonymous owner cookie adopts that
 * browser's boards/academic contexts (account wins per program — see
 * adopt_owner.ts) and then expires the cookie so adoption runs once per device.
 * If adoption fails the cookie is kept and it is retried on the next request.
 *
 * Signed out → exactly the anonymous cookie flow of `resolveOwner`.
 */
export async function resolveRequestOwner(
  req: OwnerRequestLike,
  res: OwnerResponseLike,
  deps: ResolveRequestOwnerDeps = {},
): Promise<ResolvedOwner> {
  const userId = await (deps.verifyUser ?? verifiedUserId)(req, res);
  if (!userId) return resolveOwner(req, res);

  const ownerId = accountOwnerId(userId);
  const anonymous = readAnonymousOwner(req);
  if (anonymous) {
    try {
      if (await (deps.adopt ?? adoptAnonymousPlannerState)(anonymous, ownerId)) clearSessionCookie(res);
    } catch {
      console.error('[auth] adopting anonymous planner state failed; will retry');
    }
  }
  return { ownerId, issued: false };
}
