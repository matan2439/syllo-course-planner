import { createHash } from 'crypto';

/** One-way durable lookup key; the raw bearer cookie is never persisted. */
export function ownerStorageKey(ownerId: string): string {
  return `owner_${createHash('sha256').update(ownerId, 'utf8').digest('hex')}`;
}
