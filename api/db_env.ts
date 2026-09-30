/**
 * Database isolation guard: the production Supabase project is reachable ONLY
 * from VERCEL_ENV=production, and production reaches ONLY that project.
 *
 * Preview/Sandbox (and local dev) run on a separate Supabase project, so a
 * Paddle Sandbox purchase can never become spendable production credit. A
 * mismatched URL is treated as "not configured" ('' / null), which every caller
 * already handles by failing closed (503, metering unavailable, auth off).
 * Defense-in-depth next to the Paddle env guard in billing/paddle.ts.
 */

/** Public project ref (it is in every URL), not a secret. */
export const PRODUCTION_SUPABASE_REF = 'lxwtycowmqosuyfumcbo';

/** True when `url` may be used under this env. Empty urls are allowed (= unconfigured). */
export function dbIsolationOk(url: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!url) return true;
  return (env.VERCEL_ENV === 'production') === url.includes(PRODUCTION_SUPABASE_REF);
}

/** `url` if it may be used under this env, else '' (logged loudly). */
export function isolatedUrl(url: string | undefined, name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = (url ?? '').trim();
  if (dbIsolationOk(value, env)) return value;
  console.error(`[db-isolation] ${name} is refused on VERCEL_ENV=${env.VERCEL_ENV ?? 'unset'}: `
    + (env.VERCEL_ENV === 'production' ? 'production must use the production database' : 'only production may use the production database'));
  return '';
}

/** DATABASE_URL, or '' when unset or not allowed in this environment. */
export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return isolatedUrl(env.DATABASE_URL, 'DATABASE_URL', env);
}
