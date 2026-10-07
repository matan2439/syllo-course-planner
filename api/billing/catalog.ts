/**
 * catalog.ts — the ONLY source of what a Syllo Credit package is.
 *
 * Authoritative mapping: Paddle price id → package → credits granted.
 * The browser may name a package id; it can never name credits or a price.
 * Prices are NOT stored here: Paddle owns them (the UI shows Paddle's localized
 * price preview), so a Paddle price change can never desync Syllo.
 *
 * Price ids come from deployment env and must match the audited binding below.
 * Paddle uses the same pri_ prefix in both environments; a prefix check alone
 * cannot distinguish Live prices from Sandbox prices. These public identifiers
 * are validation bindings, never credentials or a fallback for missing env.
 * Production version 2 was explicitly approved on 2026-10-07. Sandbox version 1
 * stays unchanged. Existing payments retain their stored version and entitlement.
 */
import type { PaddleEnvironment } from './paddle';

export interface CreditPackage {
  id: string;
  version: number;
  nameHe: string;
  credits: number;
  paddlePriceId: string;
  active: boolean;
}

const PACKAGES = [
  { id: 'credits_small', nameHe: 'חבילה קטנה', priceEnv: 'PADDLE_PRICE_CREDITS_SMALL',
    sandbox: { version: 1, credits: 50, priceId: 'pri_01m3qasab7exbpj6dv3k70tjn9' },
    production: { version: 2, credits: 10, priceId: 'pri_01m4bf9ge86dj44by7a603nm50' } },
  { id: 'credits_medium', nameHe: 'חבילה בינונית', priceEnv: 'PADDLE_PRICE_CREDITS_MEDIUM',
    sandbox: { version: 1, credits: 150, priceId: 'pri_01m3qasant31p8d69jr7r90ky5' },
    production: { version: 2, credits: 15, priceId: 'pri_01m4bf9gy11s5cft1m7r28ahcf' } },
  { id: 'credits_large', nameHe: 'חבילה גדולה', priceEnv: 'PADDLE_PRICE_CREDITS_LARGE',
    sandbox: { version: 1, credits: 400, priceId: 'pri_01m3qasb0c3gcb343ccx7vat03' },
    production: { version: 2, credits: 20, priceId: 'pri_01m4bf9hagtt179xqzrqcee1wq' } },
];

/** No secret values appear in errors. Any mixed/ambiguous catalog disables billing. */
export function catalogConfigurationProblem(env: NodeJS.ProcessEnv): string | null {
  const environment = (env.PADDLE_ENV ?? '').trim();
  if (environment !== 'sandbox' && environment !== 'production') return 'Catalog requires PADDLE_ENV';
  if ((env.VERCEL_ENV === 'production') !== (environment === 'production')) return 'Catalog deployment environment mismatch';
  const seen = new Set<string>();
  for (const pkg of PACKAGES) {
    const priceId = (env[pkg.priceEnv] ?? '').trim();
    if (!priceId) {
      if (environment === 'production') return `Missing Production catalog price: ${pkg.priceEnv}`;
      continue;
    }
    if (seen.has(priceId)) return 'Duplicate Paddle catalog price';
    seen.add(priceId);
    if (priceId !== pkg[environment].priceId) return `Catalog price does not match ${environment} package: ${pkg.id}`;
  }
  return null;
}

/** Packages with a configured price id in this deployment. */
export function creditCatalog(env: NodeJS.ProcessEnv = process.env): CreditPackage[] {
  if (catalogConfigurationProblem(env)) return [];
  const environment = env.PADDLE_ENV!.trim() as PaddleEnvironment;
  return PACKAGES.flatMap(({ priceEnv, id, nameHe, ...bindings }) => {
    const paddlePriceId = (env[priceEnv] ?? '').trim();
    const { version, credits } = bindings[environment];
    return paddlePriceId ? [{ id, nameHe, version, credits, active: true, paddlePriceId }] : [];
  });
}

export function packageById(id: unknown, env?: NodeJS.ProcessEnv): CreditPackage | null {
  return creditCatalog(env).find((p) => p.id === id && p.active) ?? null;
}

/** Includes inactive packages: a purchase made before deactivation must still be honoured. */
export function packageByPriceId(priceId: unknown, env?: NodeJS.ProcessEnv): CreditPackage | null {
  return creditCatalog(env).find((p) => p.paddlePriceId === priceId) ?? null;
}

export type { PaddleEnvironment };
