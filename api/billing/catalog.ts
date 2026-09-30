/**
 * catalog.ts — the ONLY source of what a Syllo Credit package is.
 *
 * Authoritative mapping: Paddle price id → package → credits granted.
 * The browser may name a package id; it can never name credits or a price.
 * Prices are NOT stored here: Paddle owns them (the UI shows Paddle's localized
 * price preview), so a Paddle price change can never desync Syllo.
 *
 * Price ids come from env (PADDLE_PRICE_<PACKAGE>) per deployment, so a sandbox
 * deployment only ever knows sandbox prices and vice versa.
 *
 * ⚠ REQUIRES PRODUCT DECISION: package ids / credit amounts below are sandbox
 * placeholders, not final production offers.
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

const PACKAGES: Array<Omit<CreditPackage, 'paddlePriceId'> & { priceEnv: string }> = [
  { id: 'credits_small', version: 1, nameHe: 'חבילה קטנה', credits: 50, priceEnv: 'PADDLE_PRICE_CREDITS_SMALL', active: true },
  { id: 'credits_medium', version: 1, nameHe: 'חבילה בינונית', credits: 150, priceEnv: 'PADDLE_PRICE_CREDITS_MEDIUM', active: true },
  { id: 'credits_large', version: 1, nameHe: 'חבילה גדולה', credits: 400, priceEnv: 'PADDLE_PRICE_CREDITS_LARGE', active: true },
];

const PRICE_ID = /^pri_[a-z0-9]{10,}$/;

/** Packages with a configured price id in this deployment. */
export function creditCatalog(env: NodeJS.ProcessEnv = process.env): CreditPackage[] {
  return PACKAGES.flatMap(({ priceEnv, ...pkg }) => {
    const paddlePriceId = (env[priceEnv] ?? '').trim();
    return PRICE_ID.test(paddlePriceId) ? [{ ...pkg, paddlePriceId }] : [];
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
