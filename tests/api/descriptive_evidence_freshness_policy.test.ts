import { prepareEvidence } from '../../api/ai/evidence_provider';
import type { SyllabusDocument } from '../../api/ai/syllabus_source';

const COURSE = '0542-3792';

function officialSyllabus(academicYear: number, delivery = 'מעבדה'): SyllabusDocument {
  return {
    institutionId: 'tau.ac.il',
    courseId: COURSE,
    academicYear,
    sourceUrl: `https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0542379201&year=${academicYear}`,
    contentHash: `sha_${academicYear}_${delivery}`,
    retrievedAt: '2026-08-19T00:00:00.000Z',
    labeledFields: { 'מספר קורס': [COURSE], 'אופן ההוראה': [delivery] },
    text: `אופן ההוראה ${delivery}`,
  };
}

describe('descriptive evidence freshness policy', () => {
  test('an explicitly allowed two-year-old official syllabus grounds descriptive evidence and is disclosed as historical', () => {
    const prepared = prepareEvidence({
      courseIds: [COURSE],
      academicYear: 2027,
      documents: [officialSyllabus(2025)],
      descriptiveFreshnessPolicy: { maxPriorAcademicYears: 2 },
    });

    expect(prepared.features.get(COURSE)?.laboratory.value).toBe(true);
    expect(prepared.coverage.coveredCourseCount).toBe(1);
    expect(prepared.coverage.staleCourseIds).toEqual([]);
    expect(prepared.coverage.historicalCourseIds).toEqual([COURSE]);
    expect(prepared.coverage.academicYears).toEqual([2025]);
  });

  test('without the explicit policy, the same earlier-year syllabus remains inert', () => {
    const prepared = prepareEvidence({
      courseIds: [COURSE],
      academicYear: 2027,
      documents: [officialSyllabus(2025)],
    });

    expect(prepared.features.has(COURSE)).toBe(false);
    expect(prepared.coverage.staleCourseIds).toEqual([COURSE]);
  });

  test.each([
    ['too old', 2024],
    ['future', 2028],
  ])('%s evidence fails closed', (_case, sourceYear) => {
    const prepared = prepareEvidence({
      courseIds: [COURSE], academicYear: 2027,
      documents: [officialSyllabus(sourceYear)],
      descriptiveFreshnessPolicy: { maxPriorAcademicYears: 2 },
    });

    expect(prepared.features.has(COURSE)).toBe(false);
    expect(prepared.coverage.coveredCourseCount).toBe(0);
    expect(prepared.coverage.staleCourseIds).toEqual([COURSE]);
    expect(prepared.coverage.historicalCourseIds).toEqual([]);
  });

  test('missing source year fails closed', () => {
    const unversioned = { ...officialSyllabus(2025), academicYear: undefined } as unknown as SyllabusDocument;
    const prepared = prepareEvidence({
      courseIds: [COURSE], academicYear: 2027, documents: [unversioned],
      descriptiveFreshnessPolicy: { maxPriorAcademicYears: 2 },
    });

    expect(prepared.features.has(COURSE)).toBe(false);
    expect(prepared.coverage.historicalCourseIds).toEqual([]);
  });

  test('an exact-year syllabus wins over conflicting descriptive content from an allowed prior year', () => {
    const prepared = prepareEvidence({
      courseIds: [COURSE], academicYear: 2027,
      documents: [officialSyllabus(2025, 'מעבדה'), officialSyllabus(2027, 'שיעור')],
      descriptiveFreshnessPolicy: { maxPriorAcademicYears: 2 },
    });

    expect(prepared.features.get(COURSE)?.laboratory.value).toBe(false);
    expect(prepared.coverage.historicalCourseIds).toEqual([]);
    expect(prepared.coverage.academicYears).toEqual([2027]);
  });

  test('the newest eligible prior year is selected deterministically regardless of document order', () => {
    const documents = [officialSyllabus(2025, 'מעבדה'), officialSyllabus(2026, 'שיעור')];
    const run = (docs: SyllabusDocument[]) => prepareEvidence({
      courseIds: [COURSE], academicYear: 2027, documents: docs,
      descriptiveFreshnessPolicy: { maxPriorAcademicYears: 2 },
    });

    const forward = run(documents);
    const reversed = run([...documents].reverse());
    expect(forward.features.get(COURSE)?.laboratory.value).toBe(false);
    expect(reversed.features.get(COURSE)?.laboratory.value).toBe(false);
    expect(reversed.snapshot.snapshotId).toBe(forward.snapshot.snapshotId);
  });

  test('an unresolved authoritative conflict remains inert even inside the allowed window', () => {
    const prepared = prepareEvidence({
      courseIds: [COURSE], academicYear: 2027,
      documents: [officialSyllabus(2025)],
      conflictingCourseIds: [COURSE],
      descriptiveFreshnessPolicy: { maxPriorAcademicYears: 2 },
    });

    expect(prepared.features.has(COURSE)).toBe(false);
    expect(prepared.coverage.conflictingCourseIds).toEqual([COURSE]);
  });
});
