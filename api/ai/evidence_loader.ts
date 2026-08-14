/**
 * K9B — the seam through which already-acquired official documents reach a
 * Generate request.
 *
 * Deliberately a separate, tiny module for the same reason `board_loader.ts` is
 * one: it is the single mockable/replaceable point, so the handler itself never
 * grows knowledge of where evidence is stored. K6 backs this with the durable
 * content-addressed cache; K7 populates that cache out-of-band.
 *
 * It performs NO network access. By construction there is no code path from a
 * Generate request to an HTTP call: acquisition lives in `syllabus_source.ts`
 * behind an injected transport, and nothing here imports it.
 *
 * Default: no documents. The grounded objective is then inert and the request
 * behaves exactly as before the feature existed.
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { loadDocuments } from './evidence_cache';
import type { SyllabusDocument } from './syllabus_source';

/**
 * Where the durable evidence cache (K6) lives. Overridable so a deployment or a
 * test can point elsewhere; absent directory ⇒ no evidence, which is inert.
 */
export function evidenceCacheRoot(): string {
  return (process.env.AI_EVIDENCE_CACHE_DIR ?? '').trim() || join(process.cwd(), 'data', 'evidence_cache');
}

/**
 * Prepared official documents for a program, read from the durable cache.
 *
 * Cache-only by construction: this reads the local content-addressed store and
 * has no transport of any kind, so a Generate request can never trigger an
 * acquisition. A missing or corrupt cache yields an empty list (the cache itself
 * fails safe), leaving the grounded objective inert rather than failing a plan.
 */
export function loadPreparedEvidenceDocuments(_programId?: string): SyllabusDocument[] {
  const root = evidenceCacheRoot();
  if (!existsSync(root)) return [];
  try {
    return loadDocuments(root).documents;
  } catch {
    return []; // never let an evidence problem break plan generation
  }
}
