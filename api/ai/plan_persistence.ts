/**
 * api/ai/plan_persistence.ts — the first real (non-no-op) PersistenceCapability
 * for the AcademicDecisionAgent track: a bounded, in-memory PlanRunStore that
 * actually records each decided AgentResult, retrievable later by id or as a
 * list, instead of discarding it (NoOpPersistenceCapability's behavior).
 *
 * Mirrors plan_simulation.ts's convention for this track: a standalone,
 * additive module with its own tests. NOT wired into
 * academic_decision_factory.ts's default composition — that stays
 * NoOpPersistenceCapability, per the same "narrowest safe increment"
 * discipline every prior epic in this track has followed. A caller wanting
 * real persistence supplies `overrides.persistence: new
 * InMemoryPersistenceCapability()` explicitly.
 *
 * Deliberately in-memory, not Supabase/DB-backed: this epic is infra-only,
 * per the track's "Direction change" note (no production wiring, no DB/env
 * knowledge). A durable, DB-backed PlanRunStore is a natural future
 * implementation of the same PlanRunStore interface, swapped in without
 * touching InMemoryPersistenceCapability's callers.
 */

import { randomUUID } from 'crypto';
import type { AgentResult } from './planner_agent';
import type { PersistenceCapability } from './academic_decision_types';

export interface PersistedPlanRecord {
  id: string;
  /** Epoch milliseconds, from the injected clock (defaults to Date.now). */
  persistedAt: number;
  result: AgentResult;
}

/**
 * Storage abstraction for persisted plan runs. Async throughout so a future
 * DB-backed implementation is a drop-in replacement for InMemoryPlanRunStore.
 */
export interface PlanRunStore {
  record(entry: PersistedPlanRecord): Promise<void>;
  /** Oldest-first. */
  list(): Promise<PersistedPlanRecord[]>;
  get(id: string): Promise<PersistedPlanRecord | undefined>;
}

export interface InMemoryPlanRunStoreOptions {
  /** Bounded ring buffer size; oldest entries evicted first once exceeded. Default 100. */
  maxEntries?: number;
}

export class InMemoryPlanRunStore implements PlanRunStore {
  private entries: PersistedPlanRecord[] = [];
  private readonly maxEntries: number;

  constructor(options: InMemoryPlanRunStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 100;
  }

  async record(entry: PersistedPlanRecord): Promise<void> {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
  }

  async list(): Promise<PersistedPlanRecord[]> {
    return this.entries.slice();
  }

  async get(id: string): Promise<PersistedPlanRecord | undefined> {
    return this.entries.find((e) => e.id === id);
  }

  /** Test/dev convenience — not part of the PlanRunStore interface. */
  clear(): void {
    this.entries = [];
  }
}

export interface InMemoryPersistenceCapabilityOptions {
  store?: PlanRunStore;
  /** Defaults to Date.now — inject a fixed function for deterministic tests. */
  clock?: () => number;
  /** Defaults to crypto.randomUUID — inject for deterministic tests. */
  idGenerator?: () => string;
}

/** ponytail: real in-memory persistence — swap `store` for a DB-backed PlanRunStore when that epic ships */
export class InMemoryPersistenceCapability implements PersistenceCapability {
  private readonly store: PlanRunStore;
  private readonly clock: () => number;
  private readonly idGenerator: () => string;

  constructor(options: InMemoryPersistenceCapabilityOptions = {}) {
    this.store = options.store ?? new InMemoryPlanRunStore();
    this.clock = options.clock ?? Date.now;
    this.idGenerator = options.idGenerator ?? (() => randomUUID());
  }

  async persist(result: AgentResult): Promise<void> {
    await this.store.record({
      id: this.idGenerator(),
      persistedAt: this.clock(),
      result,
    });
  }

  /** Exposes the underlying store for read-back (e.g. a future inspectPlanHistory read tool). */
  getStore(): PlanRunStore {
    return this.store;
  }
}
