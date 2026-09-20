/** Anonymous quota session token (UUID), persisted like the legacy planner. Shared by every AI surface so quota tracking stays unified. */

/** RFC-4122 v4 UUID with graceful fallback (older/embedded runtimes lack crypto.randomUUID). */
export function uuidv4(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.randomUUID) return c.randomUUID()
  const b = new Uint8Array(16)
  if (c?.getRandomValues) c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'))
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h.slice(10).join('')}`
}

export function getAiSessionToken(): string {
  const KEY = 'tau_ai_session'
  try {
    let t = localStorage.getItem(KEY)
    if (!t) { t = uuidv4(); localStorage.setItem(KEY, t) }
    return t
  } catch {
    return uuidv4()
  }
}
