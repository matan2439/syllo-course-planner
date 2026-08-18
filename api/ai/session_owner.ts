/**
 * session_owner.ts — the OWNERSHIP boundary (S0 decision C: anonymous
 * server-owned session).
 *
 * Everything durable this epic writes — proposals and committed boards — is
 * keyed by an owner id that the SERVER issues. That is the whole point: the
 * pre-existing `anonymous_sessions.session_token` is chosen by the client
 * (localStorage `tau_ai_session`), so a caller who picked someone else's token
 * would inherit their records. That token keeps its separate quota job and is
 * never an ownership key.
 *
 * The identifier is opaque and high-entropy (256 bits), carries no meaning, and
 * is returned only in a cookie — never in a response body, so it cannot leak
 * through a log, a screenshot or a copied URL.
 *
 * Cookie attributes and why:
 *   HttpOnly              script cannot read it, so an XSS cannot exfiltrate
 *                         the ownership key;
 *   SameSite=Lax          a cross-site POST cannot carry it;
 *   Secure (non-dev)      never sent over plaintext in Production;
 *   Path=/                both /api/ai/* and the app share one session;
 *   Max-Age               bounded lifetime; re-issued on expiry.
 *
 * CSRF: the mutating endpoint accepts `application/json` only and is not a
 * form-encodable content type, so a cross-site HTML form cannot invoke it; and
 * `vercel.json` sets `Access-Control-Allow-Origin: *` WITHOUT
 * `Allow-Credentials`, which means a browser refuses to attach this cookie to
 * any cross-origin request at all. SameSite=Lax is the third, independent
 * layer rather than the only one.
 *
 * This is deliberately NOT authentication. It identifies a browser, not a
 * person. Upgrading to authenticated ownership means adding a nullable user id
 * beside the owner id and preferring it when present — no change to the
 * repository boundary.
 */
import { randomBytes } from 'crypto';

/** The cookie the owner id travels in. */
export const SESSION_COOKIE = 'syllo_owner';
/** 30 days. Long enough to be useful, short enough to bound retention. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Opaque, 256-bit, URL-safe. Never derived from anything the client supplies. */
export function generateOwnerId(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * A syntactically plausible owner id. This is a cheap sanity filter on a value
 * that arrives from the network — NOT an authorization check. Ownership is
 * enforced by comparing this id against the id stored on a record, and an
 * unknown-but-well-formed id simply owns nothing.
 */
export function isWellFormedOwnerId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

/** Minimal request/response shapes — avoids coupling this module to Vercel's types. */
export interface OwnerRequestLike {
  headers?: Record<string, string | string[] | undefined>;
}
export interface OwnerResponseLike {
  setHeader(name: string, value: string | string[]): unknown;
  getHeader?(name: string): string | string[] | number | undefined;
}

/** Parse a Cookie header without pulling in a dependency for one line of work. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return undefined; // a malformed cookie is treated as absent, never as an owner
    }
  }
  return undefined;
}

export function serializeSessionCookie(ownerId: string, opts: { secure: boolean }): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(ownerId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export interface ResolvedOwner {
  ownerId: string;
  /** True when this request had no usable session and the server issued one. */
  issued: boolean;
}

export interface ResolveOwnerOptions {
  /** Deterministic id for tests. Runtime generation is never weakened by this. */
  generateId?: () => string;
  /** Omit `Secure` for plain-HTTP local development. Defaults to "not dev". */
  secure?: boolean;
}

/**
 * The single entry point: read the caller's session, or issue one.
 *
 * Always returns an owner id, and sets the cookie whenever it issued a new one,
 * so the very first request of a visit already has durable ownership — a
 * Generate can therefore store a proposal the following Apply can resolve.
 *
 * `Set-Cookie` is APPENDED rather than assigned, so this can never clobber a
 * cookie another layer already set on the same response.
 */
export function resolveOwner(
  req: OwnerRequestLike,
  res: OwnerResponseLike,
  options: ResolveOwnerOptions = {},
): ResolvedOwner {
  const rawCookie = req.headers?.cookie;
  const header = Array.isArray(rawCookie) ? rawCookie.join('; ') : rawCookie;
  const existing = readCookie(header, SESSION_COOKIE);
  if (isWellFormedOwnerId(existing)) return { ownerId: existing, issued: false };

  const ownerId = (options.generateId ?? generateOwnerId)();
  const secure = options.secure ?? process.env.AI_DEV_MODE !== 'true';
  const cookie = serializeSessionCookie(ownerId, { secure });

  const prior = res.getHeader?.('Set-Cookie');
  const merged = prior === undefined
    ? [cookie]
    : (Array.isArray(prior) ? [...prior.map(String), cookie] : [String(prior), cookie]);
  res.setHeader('Set-Cookie', merged);

  return { ownerId, issued: true };
}
