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
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadDocuments } from './evidence_cache';
import { GROUP_UNIVERSE_NORMALIZER_VERSION } from './group_universe';
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

interface PreparedUniverseRow {
  courseId: string;
  academicYear: number | string;
  applicability: string;
  completeness: string;
  groupIds: string[];
  contentHash: string;
  sourceRef: string;
}

/**
 * Read the frozen, metadata-only output of the offline group-universe
 * normalizer. A universe is exposed only when it is complete, applicable and
 * belongs to the single evidence year currently prepared for that course.
 * Ambiguous/conflicting records fail closed and therefore cannot strengthen a
 * ranking claim.
 */
export function loadPreparedGroupUniverse(
  documents: SyllabusDocument[],
  reportPath = (process.env.AI_GROUP_UNIVERSE_REPORT ?? '').trim()
    || join(process.cwd(), 'data', 'import_reports', 'group_universe_report.json'),
): Record<string, string[]> {
  if (!existsSync(reportPath)) return {};
  try {
    const raw: unknown = JSON.parse(readFileSync(reportPath, 'utf8'));
    if (!raw || typeof raw !== 'object') return {};
    const report = raw as { normalizerVersion?: unknown; universes?: unknown };
    if (report.normalizerVersion !== GROUP_UNIVERSE_NORMALIZER_VERSION || !Array.isArray(report.universes)) return {};

    const documentYears = new Map<string, Set<string>>();
    for (const document of documents) {
      const years = documentYears.get(document.courseId) ?? new Set<string>();
      years.add(String(document.academicYear));
      documentYears.set(document.courseId, years);
    }

    const candidates = new Map<string, Set<string>>();
    const conflicting = new Set<string>();
    for (const value of report.universes) {
      if (!value || typeof value !== 'object') continue;
      const row = value as Partial<PreparedUniverseRow>;
      if (
        typeof row.courseId !== 'string'
        || (typeof row.academicYear !== 'string' && typeof row.academicYear !== 'number')
        || row.applicability !== 'applicable'
        || row.completeness !== 'complete'
        || !Array.isArray(row.groupIds)
        || typeof row.contentHash !== 'string'
        || row.contentHash.trim().length === 0
        || typeof row.sourceRef !== 'string'
        || row.sourceRef.trim().length === 0
      ) continue;
      const years = documentYears.get(row.courseId);
      if (!years || years.size !== 1 || !years.has(String(row.academicYear))) continue;
      const ids = [...new Set(row.groupIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map((id) => id.trim()))].sort();
      if (!ids.length) continue;
      const identity = `${row.courseId}\u0000${String(row.academicYear)}`;
      const existing = candidates.get(identity);
      if (existing && [...existing].join('\u0000') !== ids.join('\u0000')) conflicting.add(identity);
      else candidates.set(identity, new Set(ids));
    }

    const result: Record<string, string[]> = {};
    for (const [identity, ids] of candidates) {
      if (conflicting.has(identity)) continue;
      const courseId = identity.split('\u0000', 1)[0];
      result[courseId] = [...ids];
    }
    return result;
  } catch {
    return {};
  }
}
