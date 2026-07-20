/**
 * Tests for api/ai/plan_persistence.ts — the first real (non-no-op)
 * PersistenceCapability: a bounded, in-memory PlanRunStore that actually
 * records each decided AgentResult, retrievable later by id or as a list.
 *
 * Mirrors plan_simulation.ts's convention for this track: a standalone,
 * additive, fully-testable implementation, injectable via
 * AcademicDecisionDeps.persistence / academic_decision_factory.ts's
 * overrides.persistence — NOT wired in as the new factory default (stays
 * NoOpPersistenceCapability there, per the same "narrowest safe increment"
 * discipline every prior epic in this track has followed).
 */

import {
  InMemoryPlanRunStore,
  InMemoryPersistenceCapability,
  type PersistedPlanRecord,
} from '../../api/ai/plan_persistence';
import type { AgentResult } from '../../api/ai/planner_agent';
import { emptyState } from '../../api/ai/planner_types';
import type { PersistenceCapability } from '../../api/ai/academic_decision_types';

const SEMS = ['year_3_semester_a', 'year_3_semester_b'];

function agentResult(over: Partial<AgentResult> = {}): AgentResult {
  return { finalState: emptyState(SEMS), trace: [], gaps: [], ...over };
}

describe('InMemoryPlanRunStore', () => {
  test('record() then list() returns entries oldest-first', async () => {
    const store = new InMemoryPlanRunStore();
    const a: PersistedPlanRecord = { id: 'a', persistedAt: 1, result: agentResult() };
    const b: PersistedPlanRecord = { id: 'b', persistedAt: 2, result: agentResult() };

    await store.record(a);
    await store.record(b);

    expect(await store.list()).toEqual([a, b]);
  });

  test('get() finds a record by id, undefined when absent', async () => {
    const store = new InMemoryPlanRunStore();
    const a: PersistedPlanRecord = { id: 'a', persistedAt: 1, result: agentResult() };
    await store.record(a);

    expect(await store.get('a')).toEqual(a);
    expect(await store.get('missing')).toBeUndefined();
  });

  test('list() returns a defensive copy of the array — popping from it does not affect the store', async () => {
    const store = new InMemoryPlanRunStore();
    await store.record({ id: 'a', persistedAt: 1, result: agentResult() });

    const first = await store.list();
    first.pop();

    expect(await store.list()).toHaveLength(1);
  });

  test('list() and get() return independent deep copies — mutating a returned record does not corrupt the store or other reads', async () => {
    const store = new InMemoryPlanRunStore();
    await store.record({ id: 'a', persistedAt: 1, result: agentResult() });

    const viaList = await store.list();
    viaList[0].result.finalState.semesters['year_3_semester_a'] = ['leaked'];
    const viaGet = await store.get('a');
    viaGet!.result.trace.push({ type: 'STOP' });

    const fresh = await store.get('a');
    expect(fresh?.result.finalState.semesters['year_3_semester_a']).toEqual([]);
    expect(fresh?.result.trace).toEqual([]);
  });

  test('record() never overwrites — a duplicate id produces two entries; get() returns the first-added match', async () => {
    const store = new InMemoryPlanRunStore();
    const first = agentResult({ rationale_he: 'first' });
    const second = agentResult({ rationale_he: 'second' });
    await store.record({ id: 'dup', persistedAt: 1, result: first });
    await store.record({ id: 'dup', persistedAt: 2, result: second });

    const entries = await store.list();
    expect(entries).toHaveLength(2);
    expect(entries.map((e: PersistedPlanRecord) => e.result.rationale_he)).toEqual(['first', 'second']);
    expect((await store.get('dup'))?.result.rationale_he).toBe('first');
  });

  test('evicts the oldest entry once maxEntries is exceeded (bounded ring buffer)', async () => {
    const store = new InMemoryPlanRunStore({ maxEntries: 2 });
    await store.record({ id: 'a', persistedAt: 1, result: agentResult() });
    await store.record({ id: 'b', persistedAt: 2, result: agentResult() });
    await store.record({ id: 'c', persistedAt: 3, result: agentResult() });

    const ids = (await store.list()).map((e: PersistedPlanRecord) => e.id);
    expect(ids).toEqual(['b', 'c']);
  });

  test('default maxEntries is 100', async () => {
    const store = new InMemoryPlanRunStore();
    for (let i = 0; i < 101; i++) {
      await store.record({ id: `r${i}`, persistedAt: i, result: agentResult() });
    }

    const entries = await store.list();
    expect(entries).toHaveLength(100);
    expect(entries[0].id).toBe('r1');
    expect(entries[99].id).toBe('r100');
  });

  test('clear() empties the store', async () => {
    const store = new InMemoryPlanRunStore();
    await store.record({ id: 'a', persistedAt: 1, result: agentResult() });
    store.clear();

    expect(await store.list()).toEqual([]);
  });
});

describe('InMemoryPersistenceCapability', () => {
  test('implements PersistenceCapability', async () => {
    const cap: PersistenceCapability = new InMemoryPersistenceCapability();
    const result = agentResult();
    await expect(cap.persist(result)).resolves.toBeUndefined();
  });

  test('persist() writes a record into the store with an id and timestamp from injected deps', async () => {
    const store = new InMemoryPlanRunStore();
    const cap = new InMemoryPersistenceCapability({
      store,
      clock: () => 12345,
      idGenerator: () => 'fixed-id',
    });
    const result = agentResult();

    await cap.persist(result);

    expect(await store.list()).toEqual([{ id: 'fixed-id', persistedAt: 12345, result }]);
  });

  test('persist() stores a deep, independent copy — mutating the original AgentResult afterward does not corrupt the stored record', async () => {
    const store = new InMemoryPlanRunStore();
    const cap = new InMemoryPersistenceCapability({ store, idGenerator: () => 'x' });
    const result = agentResult();
    result.finalState.semesters['year_3_semester_a'] = ['before'];

    await cap.persist(result);
    result.finalState.semesters['year_3_semester_a'].push('mutated-after-persist');
    result.trace.push({ type: 'STOP' });

    const record = await store.get('x');
    expect(record?.result).not.toBe(result);
    expect(record?.result.finalState.semesters['year_3_semester_a']).toEqual(['before']);
    expect(record?.result.trace).toEqual([]);
  });

  test('defaults to its own InMemoryPlanRunStore when none is injected — getStore() exposes it', async () => {
    const cap = new InMemoryPersistenceCapability({ idGenerator: () => 'y' });
    const result = agentResult();

    await cap.persist(result);

    expect(await cap.getStore().get('y')).toMatchObject({ id: 'y', result });
  });

  test('two calls without an injected idGenerator produce two distinct ids', async () => {
    const cap = new InMemoryPersistenceCapability();
    await cap.persist(agentResult());
    await cap.persist(agentResult());

    const entries = await cap.getStore().list();
    expect(entries).toHaveLength(2);
    expect(entries[0].id).not.toBe(entries[1].id);
  });

  test('without an injected clock, persistedAt is a real timestamp (close to now)', async () => {
    const cap = new InMemoryPersistenceCapability({ idGenerator: () => 'z' });
    const before = Date.now();

    await cap.persist(agentResult());

    const after = Date.now();
    const record = await cap.getStore().get('z');
    expect(record?.persistedAt).toBeGreaterThanOrEqual(before);
    expect(record?.persistedAt).toBeLessThanOrEqual(after);
  });
});
