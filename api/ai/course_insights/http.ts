/** The one network boundary of course insights; tests inject their own fetcher. */
import type { HttpFetcher, HttpResponse } from '../syllabus_source';

export type { HttpFetcher, HttpResponse };

/** Read-only GET with a timeout. No credentials or cookies are ever sent. */
export function createHttpFetcher(userAgent: string): HttpFetcher {
  return async (url, opts) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': userAgent, Accept: 'application/json, text/html;q=0.9' },
      });
      return {
        status: res.status,
        finalUrl: res.url || url,
        contentType: res.headers.get('content-type') ?? '',
        body: await res.text(),
      } satisfies HttpResponse;
    } finally {
      clearTimeout(timer);
    }
  };
}

/** A tiny TTL cache of in-flight/settled promises; a rejected entry is dropped so the next call retries. */
export class TtlCache<V> {
  private readonly entries = new Map<string, { expires: number; value: Promise<V> }>();

  constructor(private readonly now: () => number = Date.now) {}

  get(key: string, ttlSeconds: number, load: () => Promise<V>): Promise<V> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) return hit.value;
    const value = load();
    this.entries.set(key, { expires: this.now() + ttlSeconds * 1000, value });
    value.catch(() => { if (this.entries.get(key)?.value === value) this.entries.delete(key); });
    return value;
  }
}
