import { ownerStorageKey } from '../../api/ai/owner_key';

describe('durable owner storage key', () => {
  test('is deterministic, one-way, and owner-specific', () => {
    const firstOwner = 'A'.repeat(43);
    const secondOwner = 'B'.repeat(43);

    expect(ownerStorageKey(firstOwner)).toMatch(/^owner_[a-f0-9]{64}$/);
    expect(ownerStorageKey(firstOwner)).toBe(ownerStorageKey(firstOwner));
    expect(ownerStorageKey(firstOwner)).not.toBe(ownerStorageKey(secondOwner));
    expect(ownerStorageKey(firstOwner)).not.toContain('AAAA');
  });
});
