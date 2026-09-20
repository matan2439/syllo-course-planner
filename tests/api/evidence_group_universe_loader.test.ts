import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadPreparedGroupUniverse } from '../../api/ai/evidence_loader';
import type { SyllabusDocument } from '../../api/ai/syllabus_source';

const doc = (courseId: string, academicYear: number): SyllabusDocument => ({
  institutionId: 'tau.ac.il',
  courseId,
  academicYear,
  sourceUrl: `recorded:${courseId}:${academicYear}`,
  contentHash: `sha_doc_${courseId}_${academicYear}`,
  retrievedAt: '2026-08-14T00:00:00.000Z',
  labeledFields: { 'מספר קורס': [`${courseId}-01`] },
  text: 'fixture',
});

describe('prepared authoritative group-universe loader', () => {
  let root: string;

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'group-universe-loader-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  const writeReport = (universes: unknown[], normalizerVersion = 'group-universe/1.0.0') => {
    const path = join(root, 'report.json');
    writeFileSync(path, JSON.stringify({ normalizerVersion, universes }));
    return path;
  };

  test('returns only complete applicable groups matching the prepared document year', () => {
    const path = writeReport([
      { courseId: 'E3', academicYear: 2025, applicability: 'applicable', completeness: 'complete', groupIds: ['05', '01', '01'], contentHash: 'sha_e3', sourceRef: 'recorded:e3' },
      { courseId: 'E4', academicYear: 2025, applicability: 'applicable', completeness: 'incomplete', groupIds: ['01'], contentHash: 'sha_e4', sourceRef: 'recorded:e4' },
      { courseId: 'E5', academicYear: 2024, applicability: 'applicable', completeness: 'complete', groupIds: ['01'], contentHash: 'sha_e5', sourceRef: 'recorded:e5' },
    ]);

    expect(loadPreparedGroupUniverse([doc('E3', 2025), doc('E4', 2025), doc('E5', 2025)], path)).toEqual({
      E3: ['01', '05'],
    });
  });

  test('fails safe on malformed, version-mismatched, or conflicting same-offering records', () => {
    const conflicting = writeReport([
      { courseId: 'E3', academicYear: 2025, applicability: 'applicable', completeness: 'complete', groupIds: ['01'], contentHash: 'sha_a', sourceRef: 'recorded:a' },
      { courseId: 'E3', academicYear: 2025, applicability: 'applicable', completeness: 'complete', groupIds: ['02'], contentHash: 'sha_b', sourceRef: 'recorded:b' },
    ]);
    expect(loadPreparedGroupUniverse([doc('E3', 2025)], conflicting)).toEqual({});

    const wrongVersion = writeReport([
      { courseId: 'E3', academicYear: 2025, applicability: 'applicable', completeness: 'complete', groupIds: ['01'], contentHash: 'sha_e3', sourceRef: 'recorded:e3' },
    ], 'unknown/9');
    expect(loadPreparedGroupUniverse([doc('E3', 2025)], wrongVersion)).toEqual({});

    writeFileSync(wrongVersion, '{not-json');
    expect(loadPreparedGroupUniverse([doc('E3', 2025)], wrongVersion)).toEqual({});
  });

  test('rejects a complete-looking row that lacks authoritative provenance', () => {
    const path = writeReport([
      { courseId: 'E3', academicYear: 2025, applicability: 'applicable', completeness: 'complete', groupIds: ['01'] },
    ]);
    expect(loadPreparedGroupUniverse([doc('E3', 2025)], path)).toEqual({});
  });

  test('does not apply one year universe when the cache has ambiguous years for a course', () => {
    const path = writeReport([
      { courseId: 'E3', academicYear: 2025, applicability: 'applicable', completeness: 'complete', groupIds: ['01'], contentHash: 'sha_e3', sourceRef: 'recorded:e3' },
    ]);
    expect(loadPreparedGroupUniverse([doc('E3', 2025), doc('E3', 2026)], path)).toEqual({});
  });
});
