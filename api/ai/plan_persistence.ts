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
 *
 * Id semantics: `record()` is append-only and never overwrites — a caller
 * that supplies (or whose idGenerator produces) a duplicate id gets two
 * distinct entries in `list()`; `get(id)` returns the first-added match.
 * Id uniqueness is the caller's responsibility (the default
 * InMemoryPersistenceCapability idGenerator, crypto.randomUUID, satisfies
 * this in practice).
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

/**
 * Deep-clones every entry in and out (structuredClone — AgentResult and its
 * nested fields are plain JSON-safe data, no functions/class instances) so
 * the store owns an independent copy: mutating the AgentResult a caller
 * passed to `record()` after the call, or mutating a record obtained from
 * `list()`/`get()`, can never corrupt the store's history or leak between
 * reads.
 *
 * Backed by a plain in-process array with no internal `await` in any method
 * body, so each call runs to completion synchronously within Node's
 * single-threaded event loop before yielding — concurrent in-flight
 * `persist()` calls from multiple requests sharing one store instance cannot
 * interleave or tear a write. `clear()` is test/dev-only (deliberately not
 * on the PlanRunStore interface) and is not meant to be called concurrently
 * with in-flight reads/writes on a shared instance.
 */
export class InMemoryPlanRunStore implements PlanRunStore {
  private entries: PersistedPlanRecord[] = [];
  private readonly maxEntries: number;

  constructor(options: InMemoryPlanRunStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 100;
  }

  async record(entry: PersistedPlanRecord): Promise<void> {
    this.entries.push(structuredClone(entry));
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
  }

  async list(): Promise<PersistedPlanRecord[]> {
    return this.entries.map((e) => structuredClone(e));
  }

  async get(id: string): Promise<PersistedPlanRecord | undefined> {
    const found = this.entries.find((e) => e.id === id);
    return found ? structuredClone(found) : undefined;
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

/** Real in-memory persistence — swap `store` for a DB-backed PlanRunStore when that epic ships. */
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
