/**
 * K6 — the durable, deterministic evidence cache behind the K9B provider seam.
 *
 * File-backed and content-addressed, suitable for development today and for a
 * persistence adapter later. NOT Supabase, and deliberately not a database: the
 * unit of truth is an immutable document keyed by its own content hash, which is
 * exactly what makes a snapshot reproducible across processes.
 *
 * Layout under `root`:
 *   objects/<contentHash>.json   one immutable acquired document
 *   manifest.json                { version, entries: [...] } — the index
 *
 * Guarantees:
 *   - content-addressed: an object file is named by its content hash, so the
 *     same document is stored once and never rewritten in place;
 *   - atomic writes: every write goes to a temp file and is renamed, so a reader
 *     sees either the old file or the new one, never a half-written one, and a
 *     crash cannot leave a partial manifest;
 *   - failure preserves the last known evidence: a failed acquisition writes
 *     nothing, so the previous manifest and objects remain intact and usable;
 *   - corruption fails safely: an unreadable manifest or object is reported and
 *     skipped, never silently treated as absent-and-fine, and never throws into
 *     the planner;
 *   - stale stays labelled: the cache records each document's academic year, and
 *     the provider (evidence_provider.ts) decides applicability — the cache
 *     never promotes an old document to current;
 *   - planning reads SNAPSHOTS, not mutable cache state: `loadDocuments` returns
 *     a plain array which `prepareEvidence` freezes into a snapshot before any
 *     candidate sees it.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { SyllabusDocument } from './syllabus_source';

export const CACHE_MANIFEST_VERSION = 1;

export interface CacheEntry {
  contentHash: string;
  courseId: string;
  academicYear: number;
  sourceUrl: string;
  retrievedAt: string;
  institutionId: string;
  programId?: string;
  /** The extractor version current when this document was stored, for auditing. */
  extractionVersion?: string;
}

export interface CacheManifest {
  version: number;
  entries: CacheEntry[];
}

export interface CacheReadResult {
  documents: SyllabusDocument[];
  /** Entries whose object file is missing or unreadable — reported, never silently dropped. */
  corruptedHashes: string[];
}

const MANIFEST = 'manifest.json';
const OBJECTS = 'objects';

function objectsDir(root: string): string {
  return join(root, OBJECTS);
}

/** Write via temp + rename so a reader never observes a partial file. */
function atomicWrite(path: string, contents: string): void {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, contents, 'utf-8');
  renameSync(tmp, path);
}

export function ensureCache(root: string): void {
  mkdirSync(objectsDir(root), { recursive: true });
  if (!existsSync(join(root, MANIFEST))) {
    atomicWrite(join(root, MANIFEST), JSON.stringify({ version: CACHE_MANIFEST_VERSION, entries: [] }, null, 2));
  }
}

/** Read the manifest. A corrupt manifest yields an EMPTY one rather than throwing. */
export function readManifest(root: string): CacheManifest {
  const path = join(root, MANIFEST);
  if (!existsSync(path)) return { version: CACHE_MANIFEST_VERSION, entries: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as CacheManifest;
    if (!parsed || !Array.isArray(parsed.entries)) throw new Error('malformed manifest');
    return parsed;
  } catch {
    // Fail safe: an unreadable manifest means "no usable cache", never a crash
    // inside a Generate request.
    return { version: CACHE_MANIFEST_VERSION, entries: [] };
  }
}

/**
 * Store a document. Content-addressed and idempotent: storing the same document
 * twice writes the object once and leaves exactly one manifest entry, so a
 * repeated acquisition cannot grow the cache or duplicate the index.
 */
export function storeDocument(root: string, doc: SyllabusDocument, extractionVersion?: string): void {
  ensureCache(root);
  const objectPath = join(objectsDir(root), `${doc.contentHash}.json`);
  if (!existsSync(objectPath)) atomicWrite(objectPath, JSON.stringify(doc, null, 2));

  const manifest = readManifest(root);
  const entries = manifest.entries.filter((e) => e.contentHash !== doc.contentHash);
  entries.push({
    contentHash: doc.contentHash,
    courseId: doc.courseId,
    academicYear: doc.academicYear,
    sourceUrl: doc.sourceUrl,
    retrievedAt: doc.retrievedAt,
    institutionId: doc.institutionId,
    ...(doc.programId !== undefined ? { programId: doc.programId } : {}),
    ...(extractionVersion !== undefined ? { extractionVersion } : {}),
  });
  // Sorted so the manifest is stable byte-for-byte regardless of insertion order.
  entries.sort((a, b) =>
    a.courseId < b.courseId ? -1 : a.courseId > b.courseId ? 1 :
    a.academicYear - b.academicYear || (a.contentHash < b.contentHash ? -1 : 1),
  );
  atomicWrite(join(root, MANIFEST), JSON.stringify({ version: CACHE_MANIFEST_VERSION, entries }, null, 2));
}

/**
 * Load every cached document. This is a CACHE HIT path: it performs no network
 * access whatsoever, which is what lets a Generate request be served entirely
 * from local evidence.
 */
export function loadDocuments(root: string): CacheReadResult {
  const manifest = readManifest(root);
  const documents: SyllabusDocument[] = [];
  const corruptedHashes: string[] = [];

  for (const entry of manifest.entries) {
    const path = join(objectsDir(root), `${entry.contentHash}.json`);
    try {
      const doc = JSON.parse(readFileSync(path, 'utf-8')) as SyllabusDocument;
      if (!doc || typeof doc.courseId !== 'string' || !doc.labeledFields) throw new Error('malformed object');
      documents.push(doc);
    } catch {
      corruptedHashes.push(entry.contentHash); // reported, never silently "fine"
    }
  }
  // Deterministic order, independent of filesystem enumeration.
  documents.sort((a, b) =>
    a.courseId < b.courseId ? -1 : a.courseId > b.courseId ? 1 : a.contentHash < b.contentHash ? -1 : 1,
  );
  return { documents, corruptedHashes };
}

/** Explicit refresh: drop one document so the next acquisition re-fetches it. */
export function invalidate(root: string, contentHash: string): void {
  const manifest = readManifest(root);
  const entries = manifest.entries.filter((e) => e.contentHash !== contentHash);
  atomicWrite(join(root, MANIFEST), JSON.stringify({ version: CACHE_MANIFEST_VERSION, entries }, null, 2));
  const path = join(objectsDir(root), `${contentHash}.json`);
  if (existsSync(path)) unlinkSync(path);
}

/** Orphaned object files (present on disk, absent from the manifest). */
export function orphanedObjects(root: string): string[] {
  const dir = objectsDir(root);
  if (!existsSync(dir)) return [];
  const known = new Set(readManifest(root).entries.map((e) => e.contentHash));
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.includes('.tmp-'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((h) => !known.has(h))
    .sort();
}
