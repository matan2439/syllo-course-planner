/**
 * Canonical planner contracts — single source of truth shared by api/ (root)
 * and web/ (Next). Runtime-neutral (no React/Next/browser/server imports).
 *
 * Layers (kept distinct):
 *   - model.ts    canonical models + half-hour units + revisions + ContractError
 *   - wire.ts     zod runtime schemas for network + persisted payloads
 *   - adapters.ts wire → model mapping
 *   - api-client.ts runtime-neutral transport (injected fetch)
 */
export * from './model';
export * from './wire';
export * from './adapters';
export * from './api-client';
