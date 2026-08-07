/**
 * VERSIONED VALIDATED-PROFILE CACHE. Cache identity is tied to the authoritative
 * source version (snapshot contentHash) AND the schema/ontology/extractor versions —
 * not courseId alone. A cached profile is reused only when the snapshot still matches
 * and versions are compatible; otherwise the caller must refresh (re-enrich). Planning
 * consumes these validated profiles and never invokes the model.
 *
 * Storage is a committed JSON file (data/enriched_profiles/<program>.json) — the
 * narrowest repository-compatible versioned storage; no DB migration. Persistent
 * production storage is a documented deferred gap.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { EXTRACTION_SCHEMA_VERSION, ONTOLOGY_VERSION as ONT_VER } from './semantic_course_extraction';
import type { SyllabusSnapshot } from './syllabus_snapshot';
import type { CourseCapabilityEvidence } from './course_capability_evidence';

export const SCHEMA_VERSION = EXTRACTION_SCHEMA_VERSION;
export const ONTOLOGY_VERSION = ONT_VER;
export const EXTRACTOR_VERSION = '1';

/** Provenance of the evidence — the real application must be able to tell these apart. */
export type ExtractorKind = 'live_semantic' | 'captured' | 'legacy';

export interface ValidatedProfile {
  courseId: string;
  snapshotHash: string;
  schemaVersion: string;
  ontologyVersion: string;
  extractorVersion: string;
  extractorName: string;
  /** live_semantic = real model + validator; captured = reviewed fixture; legacy = pattern extractor. */
  extractorKind: ExtractorKind;
  /** capabilities that were actually EVALUATED for this course (so a real absence ≠ "never checked"). */
  evaluatedCapabilities: string[];
  evidence: CourseCapabilityEvidence[];
  quarantined: Array<{ capability: string; reason: string }>;
  createdAt: string;
}

export interface ProfileCache {
  programOrCatalog: string;
  generatedAt: string;
  schemaVersion: string;
  ontologyVersion: string;
  extractorVersion: string;
  extractorName: string;
  extractorKind: ExtractorKind;
  profiles: Record<string, ValidatedProfile>;
}

export type LookupStatus =
  | 'hit'
  | 'refresh_required'
  | 'stale'
  | 'insufficient_evidence'
  | 'quarantined';

export interface LookupResult {
  status: LookupStatus;
  profile?: ValidatedProfile;
  evidence?: CourseCapabilityEvidence;
}

function versionsCompatible(p: ValidatedProfile): boolean {
  return p.schemaVersion === SCHEMA_VERSION && p.ontologyVersion === ONTOLOGY_VERSION && p.extractorVersion === EXTRACTOR_VERSION;
}

/**
 * Look up validated evidence for (course, capability) at a specific snapshot version.
 * Distinguishes hit / stale / refresh_required / insufficient_evidence / quarantined.
 */
export function lookupProfile(cache: ProfileCache, snapshot: SyllabusSnapshot, capability: string): LookupResult {
  const p = cache.profiles[snapshot.courseId];
  if (!p) return { status: 'refresh_required' };
  if (!versionsCompatible(p)) return { status: 'refresh_required', profile: p };
  if (p.snapshotHash !== snapshot.contentHash) return { status: 'stale', profile: p };
  if (p.quarantined.some((q) => q.capability === capability)) return { status: 'quarantined', profile: p };
  if (!p.evaluatedCapabilities.includes(capability)) return { status: 'refresh_required', profile: p };
  const evidence = p.evidence.find((e) => e.capability === capability && e.strength > 0);
  if (!evidence) return { status: 'insufficient_evidence', profile: p };
  return { status: 'hit', profile: p, evidence };
}

const PROFILES_DIR = join(__dirname, '..', '..', 'data', 'enriched_profiles');

/** Load the committed validated-profile cache for a program (null when absent). Read-only at plan time. */
export function loadEnrichedProfileCache(programOrCatalog: string): ProfileCache | null {
  try {
    return JSON.parse(readFileSync(join(PROFILES_DIR, `${programOrCatalog}.json`), 'utf8'));
  } catch {
    return null;
  }
}

export function buildValidatedProfile(input: {
  snapshot: SyllabusSnapshot;
  extractorName: string;
  extractorKind: ExtractorKind;
  evaluatedCapabilities: string[];
  accepted: CourseCapabilityEvidence[];
  quarantined: Array<{ capability: string; reason: string }>;
  createdAt?: string;
}): ValidatedProfile {
  return {
    courseId: input.snapshot.courseId,
    snapshotHash: input.snapshot.contentHash,
    schemaVersion: SCHEMA_VERSION,
    ontologyVersion: ONTOLOGY_VERSION,
    extractorVersion: EXTRACTOR_VERSION,
    extractorName: input.extractorName,
    extractorKind: input.extractorKind,
    evaluatedCapabilities: [...input.evaluatedCapabilities],
    evidence: input.accepted,
    quarantined: input.quarantined,
    createdAt: input.createdAt ?? new Date().toISOString().slice(0, 10),
  };
}
