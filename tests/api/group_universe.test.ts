/**
 * T1 — the AUTHORITATIVE offering/group universe normalizer.
 *
 * K7.5 established that section-level evidence may only be aggregated to a
 * course-level `true`/`false` when the COMPLETE group universe is known from an
 * authoritative source. Until now no such source was normalized, so every
 * multi-section course stayed `unknown` — safe, but permanently uninformative.
 *
 * The official course-details page enumerates the groups. This suite pins the
 * contract of turning that page into a typed universe, and — the part that
 * actually matters — that a universe can never make aggregation *less* careful
 * than K7.5 already is.
 *
 * The fixtures are minimal structural skeletons in the official page's shape:
 * field labels and ids only, no course prose.
 */
import {
  normalizeOfferingGroupUniverse,
  authoritativeGroupIds,
  groupUniverseIndex,
  GROUP_UNIVERSE_NORMALIZER_VERSION,
} from '../../api/ai/group_universe';
import { aggregateCourseLevelFeature } from '../../api/ai/feature_applicability';
import { prepareEvidence } from '../../api/ai/evidence_provider';
import type { SyllabusDocument } from '../../api/ai/syllabus_source';

const INSTITUTION = 'tau.ac.il';
const COURSE = '0542-3791';
const YEAR = 2025;
const SOURCE = 'https://www.ims.tau.ac.il/tal/kr/Search_L.aspx?kurs=05423791&kv=&year=2025';

// ── fixture builders, in the official page's real shape ──────────────────────

interface GroupSpec { group: string; type?: string; semester?: string }

/** One group block: the `קב':` anchor row, the column header row, one meeting row. */
function groupBlock({ group, type = 'מעבדה', semester = "א'" }: GroupSpec): string {
  return (
    `<tr class='listtds kotcol'><th>מספר קורס</th><th colspan=7>שם קורס</th></tr>` +
    `<tr class='listtdbld'><td> ${COURSE}&nbsp;&nbsp;&nbsp;<span class='kotcol'>קב':</span> ${group}</td>` +
    `<td colspan='7'>&nbsp;</td></tr>` +
    `<tr class='listtd kotcol'><th colspan='2'>שם מרצה</th><th>אופן&nbsp;הוראה</th><th>בניין</th>` +
    `<th>חדר</th><th>יום</th><th>שעה</th><th>סמסטר</th></tr>` +
    `<tr><td colspan='2'>&nbsp;</td><td>${type}</td><td>&nbsp;</td><td>010</td><td>ב</td>` +
    `<td>14:00-19:00</td><td> ${semester} </td></tr>`
  );
}

function detailsPage(groups: GroupSpec[], opts: { year?: string; body?: string } = {}): string {
  const year = opts.year ?? '(2025/2026)';
  return (
    `<html><body><table dir=rtl>` +
    `<tr><td colspan=4>שנה"ל תשפ"ו&nbsp;${year}</td></tr>` +
    groups.map(groupBlock).join('') +
    (opts.body ?? '') +
    `</table></body></html>`
  );
}

/** The real "no results" shell: the year chrome renders, no course row does. */
const EMPTY_PAGE = `<html><body><table dir=rtl><tr><td colspan=4>שנה"ל תשפ"ו&nbsp;(2025/2026)</td></tr></table></body></html>`;

function normalize(content: string, over: { courseId?: string; academicYear?: number | string } = {}) {
  return normalizeOfferingGroupUniverse({
    institutionId: INSTITUTION,
    courseId: over.courseId ?? COURSE,
    academicYear: over.academicYear ?? YEAR,
    sourceRef: SOURCE,
    content,
  });
}

// ── the universe contract ────────────────────────────────────────────────────

describe('T1 — the normalized universe carries every required field', () => {
  const u = normalize(detailsPage([{ group: '01' }, { group: '02', semester: "ב'" }]));

  test('institution, course, year and provenance are preserved', () => {
    expect(u.institutionId).toBe(INSTITUTION);
    expect(u.courseId).toBe(COURSE);
    expect(u.academicYear).toBe(YEAR);
    expect(u.sourceRef).toBe(SOURCE);
    expect(u.normalizerVersion).toBe(GROUP_UNIVERSE_NORMALIZER_VERSION);
  });

  test('every enumerated group id is parsed from the official content', () => {
    expect(u.groups.map((g) => g.groupId)).toEqual(['01', '02']);
  });

  test('group type and semester are read from the official columns, by label', () => {
    expect(u.groups[0].groupType).toBe('מעבדה');
    expect(u.groups[0].semester).toBe("א'");
    expect(u.groups[1].semester).toBe("ב'");
    expect(u.semesters).toEqual(["א'", "ב'"]);
  });

  test('each group carries the evidence id of the document it came from', () => {
    for (const g of u.groups) expect(g.evidenceIds).toEqual([u.contentHash]);
  });

  test('the content hash is stable for identical content and changes with it', () => {
    expect(normalize(detailsPage([{ group: '01' }, { group: '02', semester: "ב'" }])).contentHash).toBe(u.contentHash);
    expect(normalize(detailsPage([{ group: '01' }])).contentHash).not.toBe(u.contentHash);
  });

  test('a fully enumerated applicable page is COMPLETE', () => {
    expect(u.applicability).toBe('applicable');
    expect(u.completeness).toBe('complete');
    expect(u.anomalies).toEqual([]);
  });

  test('a real 10-group enumeration is parsed in full, deduplicated and ordered', () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ group: String(i + 1).padStart(2, '0') }));
    const parsed = normalize(detailsPage(ten.slice().reverse()));
    expect(parsed.groups.map((g) => g.groupId)).toEqual(ten.map((g) => g.group));
    expect(parsed.completeness).toBe('complete');
  });
});

// ── identity validation ──────────────────────────────────────────────────────

describe('T1 — course/year identity is validated, never assumed', () => {
  test('a page enumerating a DIFFERENT course is rejected', () => {
    const u = normalize(detailsPage([{ group: '01' }]), { courseId: '0542-9999' });
    expect(u.applicability).toBe('course_mismatch');
    expect(authoritativeGroupIds(u)).toBeUndefined();
  });

  test('a page for a DIFFERENT academic year is rejected', () => {
    const u = normalize(detailsPage([{ group: '01' }]), { academicYear: 2019 });
    expect(u.applicability).toBe('year_mismatch');
    expect(authoritativeGroupIds(u)).toBeUndefined();
  });

  test('the "no results" shell is UNKNOWN, never an empty COMPLETE universe', () => {
    const u = normalize(EMPTY_PAGE);
    expect(u.groups).toEqual([]);
    expect(u.completeness).toBe('unknown');
    expect(u.applicability).toBe('unidentified');
    expect(authoritativeGroupIds(u)).toBeUndefined();
  });

  test('a page carrying MORE THAN ONE course id is conflicting, not merged', () => {
    const u = normalize(
      detailsPage([{ group: '01' }]) .replace('</table>', `<tr class='listtdbld'><td> 0542-4010&nbsp;<span class='kotcol'>קב':</span> 07</td></tr></table>`),
    );
    expect(u.completeness).toBe('conflicting');
    expect(u.anomalies.map((a) => a.kind)).toContain('multiple_course_ids');
    expect(authoritativeGroupIds(u)).toBeUndefined();
  });
});

// ── malformed / duplicate / conflicting entries ──────────────────────────────

describe('T1 — malformed, duplicate and conflicting entries are detected', () => {
  test('an identical repeated group is deduplicated without an anomaly', () => {
    const u = normalize(detailsPage([{ group: '01' }, { group: '01' }, { group: '02' }]));
    expect(u.groups.map((g) => g.groupId)).toEqual(['01', '02']);
    expect(u.anomalies).toEqual([]);
    expect(u.completeness).toBe('complete');
  });

  test('the same group id published with a DIFFERENT type is conflicting', () => {
    const u = normalize(detailsPage([{ group: '01', type: 'מעבדה' }, { group: '01', type: 'פרוייקט' }]));
    expect(u.completeness).toBe('conflicting');
    expect(u.anomalies.map((a) => a.kind)).toContain('conflicting_group');
    expect(authoritativeGroupIds(u)).toBeUndefined();
  });

  test('an anchor with no readable group id makes the universe INCOMPLETE', () => {
    const u = normalize(
      detailsPage([{ group: '01' }]).replace(
        '</table>',
        `<tr class='listtdbld'><td> ${COURSE}&nbsp;<span class='kotcol'>קב':</span> </td></tr></table>`,
      ),
    );
    expect(u.groups.map((g) => g.groupId)).toEqual(['01']);
    expect(u.completeness).toBe('incomplete');
    expect(u.anomalies.map((a) => a.kind)).toContain('malformed_group_id');
    expect(authoritativeGroupIds(u)).toBeUndefined();
  });

  test('a group with no meeting row keeps its identity but has no type or semester', () => {
    const bare = `<tr class='listtdbld'><td> ${COURSE}&nbsp;<span class='kotcol'>קב':</span> 03</td></tr>`;
    const u = normalize(detailsPage([{ group: '01' }], { body: bare }));
    const g3 = u.groups.find((g) => g.groupId === '03')!;
    expect(g3.groupType).toBeUndefined();
    expect(g3.semester).toBeUndefined();
    expect(u.completeness).toBe('complete');
  });
});

// ── the safe adapter into K7.5 aggregation ───────────────────────────────────

describe('T1 — the universe feeds aggregation, and only when it is authoritative', () => {
  const complete = normalize(detailsPage([{ group: '01' }, { group: '05' }]));

  test('only a COMPLETE, APPLICABLE universe yields group ids', () => {
    expect(authoritativeGroupIds(complete)).toEqual(['01', '05']);
  });

  test('completeness is NOT inferred from successfully downloaded syllabi', () => {
    // One group's syllabus downloaded, but the universe says there are two.
    const r = aggregateCourseLevelFeature({
      observations: [{ groupId: '01', value: true }],
      groupUniverse: authoritativeGroupIds(complete),
    });
    expect(r.value).toBe('unknown');
    expect(r.reason).toBe('incomplete_coverage');
  });

  test('complete all-TRUE coverage aggregates to true', () => {
    const r = aggregateCourseLevelFeature({
      observations: [{ groupId: '01', value: true }, { groupId: '05', value: true }],
      groupUniverse: authoritativeGroupIds(complete),
    });
    expect(r).toMatchObject({ value: true, reason: 'complete_coverage', universeKnown: true });
  });

  test('complete all-FALSE coverage aggregates to false', () => {
    const r = aggregateCourseLevelFeature({
      observations: [{ groupId: '01', value: false }, { groupId: '05', value: false }],
      groupUniverse: authoritativeGroupIds(complete),
    });
    expect(r).toMatchObject({ value: false, reason: 'complete_coverage' });
  });

  test('mixed groups stay varies_by_section even with a complete universe', () => {
    const r = aggregateCourseLevelFeature({
      observations: [{ groupId: '01', value: true }, { groupId: '05', value: false }],
      groupUniverse: authoritativeGroupIds(complete),
    });
    expect(r).toMatchObject({ value: 'varies_by_section', reason: 'mixed_sections' });
  });

  test('group ORDER cannot change the aggregate', () => {
    const ids = authoritativeGroupIds(complete);
    const forward = aggregateCourseLevelFeature({
      observations: [{ groupId: '01', value: true }, { groupId: '05', value: true }], groupUniverse: ids,
    });
    const reverse = aggregateCourseLevelFeature({
      observations: [{ groupId: '05', value: true }, { groupId: '01', value: true }],
      groupUniverse: ids!.slice().reverse(),
    });
    expect(reverse).toEqual({ ...forward, observedGroups: forward.observedGroups });
  });

  test('a NON-authoritative universe leaves aggregation exactly as unknown as before', () => {
    const conflicting = normalize(detailsPage([{ group: '01', type: 'מעבדה' }, { group: '01', type: 'פרוייקט' }]));
    const r = aggregateCourseLevelFeature({
      observations: [{ groupId: '01', value: true }],
      groupUniverse: authoritativeGroupIds(conflicting),
    });
    expect(r).toMatchObject({ value: 'unknown', reason: 'unknown_group_universe', universeKnown: false });
  });

  test('the index maps course id → authoritative groups, skipping non-authoritative universes', () => {
    const other = normalize(EMPTY_PAGE, { courseId: '0542-4010' });
    expect(groupUniverseIndex([complete, other])).toEqual({ [COURSE]: ['01', '05'] });
  });
});

// ── end to end through the real evidence boundary ────────────────────────────

describe('T1 — course-level features through prepareEvidence with a real universe', () => {
  const doc = (group: string, delivery: string): SyllabusDocument => ({
    institutionId: INSTITUTION, courseId: COURSE, academicYear: YEAR,
    sourceUrl: `https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=054237910${group}&year=${YEAR}`,
    contentHash: `sha_${group}_${delivery}`, retrievedAt: '2026-08-14T00:00:00.000Z',
    labeledFields: { 'מספר קורס': [`0542-3791-${group}`], 'אופן ההוראה': [delivery] },
    text: `אופן ההוראה ${delivery}`,
  });
  const universe = normalize(detailsPage([{ group: '01' }, { group: '05' }]));
  const index = groupUniverseIndex([universe]);

  test('ONE downloaded group cannot label the whole course', () => {
    const p = prepareEvidence({
      courseIds: [COURSE], academicYear: YEAR, documents: [doc('01', 'מעבדה')], groupUniverse: index,
    });
    expect(p.features.get(COURSE)!.laboratory.value).toBe('unknown');
    expect(p.features.get(COURSE)!.laboratory.evidence).toEqual([]);
  });

  test('the COMPLETE universe finally lets both groups establish a course-level fact', () => {
    const p = prepareEvidence({
      courseIds: [COURSE], academicYear: YEAR,
      documents: [doc('01', 'מעבדה'), doc('05', 'מעבדה')], groupUniverse: index,
    });
    expect(p.features.get(COURSE)!.laboratory.value).toBe(true);
    expect(p.features.get(COURSE)!.projectDelivery.value).toBe(false);
    expect(p.coverage.variesBySectionCourseIds).toEqual([]);
  });

  test('mixed sections stay varies_by_section, universe or no universe', () => {
    const p = prepareEvidence({
      courseIds: [COURSE], academicYear: YEAR,
      documents: [doc('01', 'מעבדה'), doc('05', 'שיעור')], groupUniverse: index,
    });
    expect(p.features.get(COURSE)!.laboratory.value).toBe('varies_by_section');
    expect(p.coverage.variesBySectionCourseIds).toEqual([COURSE]);
  });

  test('document order cannot change the course-level result', () => {
    const of = (docs: SyllabusDocument[]) =>
      prepareEvidence({ courseIds: [COURSE], academicYear: YEAR, documents: docs, groupUniverse: index })
        .features.get(COURSE)!.laboratory.value;
    expect(of([doc('01', 'מעבדה'), doc('05', 'מעבדה')])).toBe(of([doc('05', 'מעבדה'), doc('01', 'מעבדה')]));
  });

  test('normalizing is pure and offline — no transport is reachable from it', async () => {
    const spy = jest.spyOn(globalThis, 'fetch' as never);
    const a = normalize(detailsPage([{ group: '01' }, { group: '05' }]));
    const b = normalize(detailsPage([{ group: '01' }, { group: '05' }]));
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    spy.mockRestore();
  });
});
