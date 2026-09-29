/**
 * paddle.ts — Paddle Billing: environment config, webhook signature
 * verification, a minimal API client, and payload minimization.
 *
 * Server-only. No Paddle secret is ever read from a NEXT_PUBLIC_ variable.
 * Sandbox and production are separated by deployment: each Vercel environment
 * has its own PADDLE_ENV, API key, webhook secret and price ids, and the key
 * prefix must match PADDLE_ENV or billing refuses to run.
 */
import { createHmac, timingSafeEqual } from 'crypto';

export type PaddleEnvironment = 'sandbox' | 'production';

export interface PaddleConfig {
  environment: PaddleEnvironment;
  apiKey: string;
  webhookSecret: string;
  apiBase: string;
}

export class PaddleConfigError extends Error {}

/** Throws PaddleConfigError when billing is not (correctly) configured. */
export function paddleConfig(env: NodeJS.ProcessEnv = process.env): PaddleConfig {
  const environment = (env.PADDLE_ENV ?? '').trim();
  const apiKey = (env.PADDLE_API_KEY ?? '').trim();
  const webhookSecret = (env.PADDLE_WEBHOOK_SECRET ?? '').trim();
  if (environment !== 'sandbox' && environment !== 'production') throw new PaddleConfigError('PADDLE_ENV must be sandbox or production');
  if (!apiKey || !webhookSecret) throw new PaddleConfigError('PADDLE_API_KEY and PADDLE_WEBHOOK_SECRET are required');
  // Paddle API keys are prefixed per environment; a mismatch is a misconfiguration, not a warning.
  const expected = environment === 'sandbox' ? 'pdl_sdbx_' : 'pdl_live_';
  if (!apiKey.startsWith(expected)) throw new PaddleConfigError(`PADDLE_API_KEY is not a ${environment} key`);
  return {
    environment,
    apiKey,
    webhookSecret,
    apiBase: environment === 'sandbox' ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com',
  };
}

// ── webhook signature ───────────────────────────────────────────────────────
/**
 * Paddle-Signature: `ts=<unix>;h1=<hex>[;h1=<hex>…]` — HMAC-SHA256 of `${ts}:${rawBody}`.
 * Several h1 values appear while a secret is being rotated; any match passes.
 * The tolerance bounds replays of an old delivery; duplicates are additionally
 * absorbed by event_id idempotency.
 */
export function verifyPaddleSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  nowMs: number = Date.now(),
  toleranceSec = 300,
): boolean {
  if (!header || !secret) return false;
  let ts = '';
  const signatures: string[] = [];
  for (const part of header.split(';')) {
    const [key, value] = part.split('=', 2).map((s) => s?.trim());
    if (key === 'ts') ts = value ?? '';
    else if (key === 'h1' && value) signatures.push(value);
  }
  if (!/^\d+$/.test(ts) || signatures.length === 0) return false;
  if (Math.abs(nowMs / 1000 - Number(ts)) > toleranceSec) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${ts}:${rawBody}`, 'utf8').digest('hex'));
  return signatures.some((sig) => {
    const given = Buffer.from(sig);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Sign a body like Paddle does (tests and the local fixture script only). */
export function signPaddleBody(rawBody: string, secret: string, tsSec = Math.floor(Date.now() / 1000)): string {
  return `ts=${tsSec};h1=${createHmac('sha256', secret).update(`${tsSec}:${rawBody}`, 'utf8').digest('hex')}`;
}

// ── payloads ────────────────────────────────────────────────────────────────
export interface PaddleEvent {
  event_id: string;
  event_type: string;
  occurred_at: string;
  data: Record<string, any>;
}

/**
 * Keep only what Syllo uses. Transaction payloads carry payment-method details
 * (card brand/last4/cardholder name), addresses and checkout URLs — none of that
 * is persisted.
 */
export function minimizeEntity(eventType: string, data: Record<string, any>): Record<string, unknown> {
  if (eventType.startsWith('transaction.')) {
    return {
      id: data.id,
      status: data.status,
      customer_id: data.customer_id ?? null,
      currency_code: data.currency_code ?? data.details?.totals?.currency_code ?? null,
      custom_data: data.custom_data ?? null,
      items: (data.items ?? []).map((item: any) => ({ price_id: item.price?.id ?? item.price_id ?? null, quantity: item.quantity ?? null })),
      totals: data.details?.totals ?? null,
      billed_at: data.billed_at ?? null,
      created_at: data.created_at ?? null,
      updated_at: data.updated_at ?? null,
    };
  }
  if (eventType.startsWith('adjustment.')) {
    return {
      id: data.id,
      action: data.action,
      type: data.type ?? null,
      status: data.status,
      transaction_id: data.transaction_id,
      customer_id: data.customer_id ?? null,
      reason: data.reason ?? null,
      currency_code: data.currency_code ?? data.totals?.currency_code ?? null,
      totals: data.totals ?? null,
      created_at: data.created_at ?? null,
      updated_at: data.updated_at ?? null,
    };
  }
  return { id: data?.id ?? null };
}

// ── API client (only the calls Syllo needs) ─────────────────────────────────
export interface PaddleApi {
  createTransaction(input: { priceId: string; customData: Record<string, string> }): Promise<{ id: string; status: string }>;
  getTransaction(id: string): Promise<Record<string, any>>;
  listAdjustments(transactionId: string): Promise<Array<Record<string, any>>>;
}

export class PaddleApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function paddleApi(config: PaddleConfig, fetchImpl: typeof fetch = fetch): PaddleApi {
  const call = async (path: string, init?: { method: string; body: unknown }) => {
    const res = await fetchImpl(`${config.apiBase}${path}`, {
      method: init?.method ?? 'GET',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      ...(init ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json().catch(() => ({})) as { data?: any; error?: { code?: string } };
    if (!res.ok) throw new PaddleApiError(`paddle ${path}: ${res.status} ${json.error?.code ?? ''}`.trim(), res.status);
    return json.data;
  };
  return {
    createTransaction: async ({ priceId, customData }) => {
      const data = await call('/transactions', { method: 'POST', body: { items: [{ price_id: priceId, quantity: 1 }], custom_data: customData } });
      return { id: data.id, status: data.status };
    },
    getTransaction: (id) => call(`/transactions/${encodeURIComponent(id)}`),
    listAdjustments: async (transactionId) => (await call(`/adjustments?transaction_id=${encodeURIComponent(transactionId)}&per_page=50`)) ?? [],
  };
}
