import { adoptOwnerState } from '../../api/ai/postgres/adopt_owner';
import { ownerStorageKey } from '../../api/ai/owner_key';

function fakeSql() {
  const calls: Array<{ query: string; params: readonly unknown[] }> = [];
  const tx = { unsafe: async (query: string, params: readonly unknown[] = []) => { calls.push({ query, params }); return []; } };
  const sql = { ...tx, begin: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx) };
  return { sql, calls };
}

test('copies boards and academic contexts onto the account, account rows win', async () => {
  const { sql, calls } = fakeSql();
  await adoptOwnerState(sql, 'anon-owner', 'auth:user');
  expect(calls.map((c) => c.query.match(/INSERT INTO (\w+)/)?.[1])).toEqual(['planner_boards', 'planner_academic_contexts']);
  for (const call of calls) {
    expect(call.query).toMatch(/ON CONFLICT \(owner_hash, program_id\) DO NOTHING/);
    expect(call.query).not.toMatch(/DELETE/i);
    expect(call.params).toEqual([ownerStorageKey('anon-owner'), ownerStorageKey('auth:user')]);
  }
});

test('adopting onto the same owner is a no-op', async () => {
  const { sql, calls } = fakeSql();
  await adoptOwnerState(sql, 'same', 'same');
  expect(calls).toHaveLength(0);
});
