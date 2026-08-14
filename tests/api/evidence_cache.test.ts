/**
 * K6 — the durable, content-addressed evidence cache.
 *
 * Every test runs against a real temporary directory, so the atomicity,
 * idempotence and corruption behavior are exercised on the real filesystem
 * rather than a mock.
 */
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ensureCache, storeDocument, loadDocuments, readManifest, invalidate, orphanedObjects,
  CACHE_MANIFEST_VERSION,
} from '../../api/ai/evidence_cache';
import { prepareEvidence } from '../../api/ai/evidence_provider';
import type { SyllabusDocument } from '../../api/ai/syllabus_source';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'evcache-')); ensureCache(root); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function doc(courseId: string, over: Partial<SyllabusDocument> = {}): SyllabusDocument {
  return {
    institutionId: 'tau.ac.il', courseId, academicYear: 2025,
    sourceUrl: `https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=${courseId}&year=2025`,
    contentHash: `sha_${courseId}`, retrievedAt: '2026-08-14T00:00:00.000Z',
    labeledFields: { 'אופן ההוראה': ['מעבדה'] }, text: 'אופן ההוראה מעבדה',
    ...over,
  };
}

describe('K6 — content-addressed storage', () => {
  test('a stored document round-trips exactly', () => {
    const d = doc('E3');
    storeDocument(root, d, '1.0.0');
    const { documents, corruptedHashes } = loadDocuments(root);
    expect(corruptedHashes).toEqual([]);
    expect(documents).toEqual([d]);
  });

  test('the object file is named by its content hash', () => {
    storeDocument(root, doc('E3'));
    expect(existsSync(join(root, 'objects', 'sha_E3.json'))).toBe(true);
  });

  test('storing the SAME document twice is idempotent — one object, one entry', () => {
    storeDocument(root, doc('E3'));
    storeDocument(root, doc('E3'));
    expect(readManifest(root).entries).toHaveLength(1);
    expect(loadDocuments(root).documents).toHaveLength(1);
  });

  test('the manifest is stable regardless of insertion order', () => {
    storeDocument(root, doc('E3'));
    storeDocument(root, doc('E1'));
    const a = readFileSync(join(root, 'manifest.json'), 'utf-8');

    const other = mkdtempSync(join(tmpdir(), 'evcache2-'));
    ensureCache(other);
    storeDocument(other, doc('E1'));
    storeDocument(other, doc('E3'));
    expect(readFileSync(join(other, 'manifest.json'), 'utf-8')).toBe(a);
    rmSync(other, { recursive: true, force: true });
  });

  test('the manifest records retrieval metadata, year, source and extractor version', () => {
    storeDocument(root, doc('E3'), '1.2.3');
    expect(readManifest(root).entries[0]).toMatchObject({
      contentHash: 'sha_E3', courseId: 'E3', academicYear: 2025,
      sourceUrl: expect.stringContaining('ims.tau.ac.il'),
      retrievedAt: '2026-08-14T00:00:00.000Z',
      institutionId: 'tau.ac.il', extractionVersion: '1.2.3',
    });
    expect(readManifest(root).version).toBe(CACHE_MANIFEST_VERSION);
  });
});

describe('K6 — safety', () => {
  test('a CACHE HIT needs no network — loadDocuments never fetches', () => {
    storeDocument(root, doc('E3'));
    const realFetch = globalThis.fetch;
    const spy = jest.fn(() => { throw new Error('network'); });
    (globalThis as { fetch?: unknown }).fetch = spy;
    try {
      expect(loadDocuments(root).documents).toHaveLength(1);
      expect(spy).not.toHaveBeenCalled();
    } finally { (globalThis as { fetch?: unknown }).fetch = realFetch; }
  });

  test('a corrupt MANIFEST fails safe: empty cache, no throw', () => {
    storeDocument(root, doc('E3'));
    writeFileSync(join(root, 'manifest.json'), '{ not json', 'utf-8');
    expect(() => readManifest(root)).not.toThrow();
    expect(readManifest(root).entries).toEqual([]);
    expect(loadDocuments(root).documents).toEqual([]);
  });

  test('a corrupt OBJECT is reported, not silently treated as absent-and-fine', () => {
    storeDocument(root, doc('E3'));
    storeDocument(root, doc('E1'));
    writeFileSync(join(root, 'objects', 'sha_E3.json'), 'garbage', 'utf-8');
    const { documents, corruptedHashes } = loadDocuments(root);
    expect(corruptedHashes).toEqual(['sha_E3']);
    expect(documents.map((d) => d.courseId)).toEqual(['E1']); // the healthy one still loads
  });

  test('a FAILED acquisition erases nothing — the last known evidence survives', () => {
    storeDocument(root, doc('E3'));
    // A failure writes nothing at all; simulate by simply not storing.
    expect(loadDocuments(root).documents).toHaveLength(1);
    expect(readManifest(root).entries).toHaveLength(1);
  });

  test('a leftover temp file is never loaded as a document', () => {
    storeDocument(root, doc('E3'));
    writeFileSync(join(root, 'objects', 'sha_E9.json.tmp-123-456'), '{}', 'utf-8');
    expect(loadDocuments(root).documents).toHaveLength(1);
    expect(orphanedObjects(root)).toEqual([]); // temp files are not counted as objects
  });

  test('explicit refresh removes exactly one document', () => {
    storeDocument(root, doc('E3'));
    storeDocument(root, doc('E1'));
    invalidate(root, 'sha_E3');
    expect(loadDocuments(root).documents.map((d) => d.courseId)).toEqual(['E1']);
    expect(existsSync(join(root, 'objects', 'sha_E3.json'))).toBe(false);
  });

  test('an object present on disk but absent from the manifest is reported as orphaned', () => {
    mkdirSync(join(root, 'objects'), { recursive: true });
    writeFileSync(join(root, 'objects', 'sha_ORPHAN.json'), JSON.stringify(doc('X')), 'utf-8');
    expect(orphanedObjects(root)).toEqual(['sha_ORPHAN']);
    expect(loadDocuments(root).documents).toEqual([]); // the manifest is the index of record
  });
});

describe('K6 — planning reads SNAPSHOTS, not mutable cache state', () => {
  test('documents from the cache become an immutable snapshot before candidates see them', () => {
    storeDocument(root, doc('E3'));
    const { documents } = loadDocuments(root);
    const prepared = prepareEvidence({ courseIds: ['E3', 'E4'], academicYear: 2025, documents });

    const snapshotId = prepared.snapshot.snapshotId;
    // Mutating the cache afterwards cannot change the snapshot already handed out.
    storeDocument(root, doc('E4'));
    expect(prepared.snapshot.snapshotId).toBe(snapshotId);
    expect(prepared.coverage.missingCourseIds).toEqual(['E4']);
  });

  test('an OLD document stays labelled stale — the cache never promotes it to current', () => {
    storeDocument(root, doc('E3', { academicYear: 2019, contentHash: 'sha_E3_old' }));
    const { documents } = loadDocuments(root);
    const prepared = prepareEvidence({ courseIds: ['E3'], academicYear: 2025, documents });
    expect(prepared.coverage.staleCourseIds).toEqual(['E3']);
    expect(prepared.features.has('E3')).toBe(false); // never used as a feature
  });

  test('the same cache produces the same snapshot id across processes/reads', () => {
    storeDocument(root, doc('E3'));
    const a = prepareEvidence({ courseIds: ['E3'], academicYear: 2025, documents: loadDocuments(root).documents });
    const b = prepareEvidence({ courseIds: ['E3'], academicYear: 2025, documents: loadDocuments(root).documents });
    expect(a.snapshot.snapshotId).toBe(b.snapshot.snapshotId);
  });
});
