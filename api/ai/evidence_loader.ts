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
import type { SyllabusDocument } from './syllabus_source';

/**
 * Prepared official documents for a program. Returns an empty list by default —
 * the durable cache (K6) replaces this body without changing any caller.
 */
export function loadPreparedEvidenceDocuments(_programId?: string): SyllabusDocument[] {
  return [];
}
