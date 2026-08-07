/**
 * ENRICHMENT OPERATION — the explicit (not-per-Generate) step that turns authoritative
 * syllabus snapshots into validated, versioned course profiles:
 *
 *   snapshot → semantic provider (untrusted) → grounding validator → validated profile → cache
 *
 * Deterministic given a deterministic provider. Provider failure for a course preserves
 * the previous valid profile (fail-closed, never corrupts the cache). Generate never calls
 * this — it only reads the resulting committed cache.
 */
import { buildSyllabusSnapshot } from './syllabus_snapshot';
import {
  CAPABILITY_ONTOLOGY,
  runExtractionWithTimeout,
  type SemanticExtractionProvider,
} from './semantic_course_extraction';
import { validateExtraction } from './semantic_extraction_validator';
import {
  buildValidatedProfile,
  SCHEMA_VERSION,
  ONTOLOGY_VERSION,
  EXTRACTOR_VERSION,
  type ExtractorKind,
  type ProfileCache,
  type ValidatedProfile,
} from './course_profile_cache';

export interface EnrichOptions {
  courseIds: string[];
  /** Provenance of this enrichment run. 'live_semantic' = real model; 'captured' = reviewed fixture. */
  extractorKind: ExtractorKind;
  timeoutMs?: number;
  previous?: ProfileCache | null;
  now?: string;
}

export interface EnrichOutcome {
  cache: ProfileCache;
  perCourse: Array<{ courseId: string; status: 'enriched' | 'no_content' | 'provider_failed_kept_previous' | 'provider_failed_no_previous'; acceptedCount: number; rejectedCount: number }>;
}

function courseIndex(board: any): Map<string, any> {
  const idx = new Map<string, any>();
  for (const s of board?.semesters ?? []) for (const c of s?.courses ?? []) if (c?.course_id) idx.set(c.course_id, c);
  for (const c of board?.metadata?.program_repository_courses ?? []) if (c?.course_id) idx.set(c.course_id, c);
  return idx;
}

export async function enrichProgram(
  board: any,
  programOrCatalog: string,
  provider: SemanticExtractionProvider,
  opts: EnrichOptions,
): Promise<EnrichOutcome> {
  const idx = courseIndex(board);
  const profiles: Record<string, ValidatedProfile> = {};
  const perCourse: EnrichOutcome['perCourse'] = [];
  const now = opts.now ?? new Date().toISOString();

  for (const courseId of opts.courseIds) {
    const course = idx.get(courseId);
    if (!course) continue;
    const snapshot = buildSyllabusSnapshot(course, programOrCatalog);
    const prev = opts.previous?.profiles?.[courseId];

    if (snapshot.sourceType === 'none') {
      profiles[courseId] = buildValidatedProfile({
        snapshot, extractorName: provider.name, extractorKind: opts.extractorKind, evaluatedCapabilities: [...CAPABILITY_ONTOLOGY], accepted: [], quarantined: [], createdAt: now.slice(0, 10),
      });
      perCourse.push({ courseId, status: 'no_content', acceptedCount: 0, rejectedCount: 0 });
      continue;
    }

    let extraction;
    try {
      extraction = await runExtractionWithTimeout(provider, snapshot, CAPABILITY_ONTOLOGY, { timeoutMs: opts.timeoutMs });
    } catch {
      // Fail-closed: keep the previous valid profile if we have one (never corrupt the cache).
      if (prev) {
        profiles[courseId] = prev;
        perCourse.push({ courseId, status: 'provider_failed_kept_previous', acceptedCount: prev.evidence.length, rejectedCount: 0 });
      } else {
        perCourse.push({ courseId, status: 'provider_failed_no_previous', acceptedCount: 0, rejectedCount: 0 });
      }
      continue;
    }

    const { accepted, rejected } = validateExtraction(extraction, snapshot, { courseTitle: course.name_he });
    profiles[courseId] = buildValidatedProfile({
      snapshot, extractorName: provider.name, extractorKind: opts.extractorKind, evaluatedCapabilities: [...CAPABILITY_ONTOLOGY],
      accepted, quarantined: rejected.map((r) => ({ capability: r.capability, reason: r.reason })), createdAt: now.slice(0, 10),
    });
    perCourse.push({ courseId, status: 'enriched', acceptedCount: accepted.length, rejectedCount: rejected.length });
  }

  return {
    cache: {
      programOrCatalog, generatedAt: now, schemaVersion: SCHEMA_VERSION, ontologyVersion: ONTOLOGY_VERSION,
      extractorVersion: EXTRACTOR_VERSION, extractorName: provider.name, extractorKind: opts.extractorKind, profiles,
    },
    perCourse,
  };
}
