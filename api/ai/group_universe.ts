/**
 * T1 — the AUTHORITATIVE offering/group universe normalizer.
 *
 * K7.5 made section-level evidence safe by refusing to aggregate it: a
 * course-level `true`/`false` requires knowing the COMPLETE set of groups the
 * course is offered in, and nothing produced that set, so every multi-section
 * course stayed `unknown`. Safe, but permanently uninformative.
 *
 * The institution's official course-details page enumerates the groups. This
 * module turns that page into a typed, provenance-carrying universe — and
 * nothing more. It deliberately does NOT:
 *   - fetch anything (it is a pure function over already-recorded content);
 *   - introduce section-level planning (the planner still selects a course and
 *     a period — the universe only tells aggregation how many groups exist);
 *   - infer completeness from how many syllabi happened to download. That is the
 *     exact defect K7.5 fixed, and `authoritativeGroupIds` is the only bridge
 *     into aggregation precisely so it can refuse.
 *
 * A universe that is not both APPLICABLE and COMPLETE yields nothing, which
 * leaves aggregation exactly as conservative as it was before this module
 * existed. Adding a universe can make an `unknown` become known; it can never
 * make a known fact wrong.
 */
import { createHash } from 'crypto';

export const GROUP_UNIVERSE_NORMALIZER_VERSION = 'group-universe/1.0.0';

/** One officially enumerated group/section of one offering. */
export interface OfferingGroup {
  /** The full group/section id exactly as the source publishes it. */
  groupId: string;
  /**
   * The official delivery-mode label for this group, when the source states one
   * unambiguously. Left undefined when the group's meeting rows disagree — a
   * group may legitimately mix modes, and guessing a primary one would be
   * inference. Never affects completeness.
   */
  groupType?: string;
  /** The official semester/period token for this group, where the source has one. */
  semester?: string;
  /** Source documents backing this group — the universe's own content hash. */
  evidenceIds: string[];
}

/** Whether this document describes the offering that was asked about. */
export type UniverseApplicability = 'applicable' | 'course_mismatch' | 'year_mismatch' | 'unidentified';

/**
 * Whether the enumeration can be trusted as the WHOLE group set.
 *   complete    — every anchor parsed cleanly and agrees
 *   incomplete  — a group entry exists that could not be identified, so rows
 *                 are known to be missing from the parse
 *   conflicting — the same group, or more than one course, is published with
 *                 irreconcilable detail
 *   unknown     — nothing enumerable was found (e.g. the "no results" shell)
 */
export type UniverseCompleteness = 'complete' | 'incomplete' | 'conflicting' | 'unknown';

export interface GroupUniverseAnomaly {
  kind: 'malformed_group_id' | 'conflicting_group' | 'multiple_course_ids';
  detail: string;
}

export interface OfferingGroupUniverse {
  institutionId: string;
  courseId: string;
  academicYear: number | string;
  /** Distinct semesters/periods the enumerated groups run in, where stated. */
  semesters: string[];
  groups: OfferingGroup[];
  /** Where the enumeration came from. */
  sourceRef: string;
  /** Content-addressed version of the source document. */
  contentHash: string;
  normalizerVersion: string;
  applicability: UniverseApplicability;
  completeness: UniverseCompleteness;
  anomalies: GroupUniverseAnomaly[];
}

/**
 * How the source spells the things this parser needs. Kept as parameters so the
 * contract is not institution-specific; the defaults simply record the one
 * official template this repository already sources from.
 */
export interface GroupUniverseDialect {
  /** Canonical course-id shape in the published content. */
  courseId: RegExp;
  /** The "group:" label preceding a group id in the course row. */
  groupLabel: RegExp;
  /** Column header naming the delivery mode. */
  deliveryHeader: RegExp;
  /** Column header naming the semester/period. */
  semesterHeader: RegExp;
  /** The academic-year statement, capturing the starting year. */
  academicYear: RegExp;
}

export const DEFAULT_GROUP_UNIVERSE_DIALECT: GroupUniverseDialect = {
  courseId: /\d{4}-\d{4}/,
  groupLabel: /קב'?\s*:/,
  deliveryHeader: /^אופן\s+ה?הוראה$/,
  semesterHeader: /^סמסטר$/,
  academicYear: /\((\d{4})\/\d{4}\)/,
};

export interface NormalizeGroupUniverseInput {
  institutionId: string;
  /** The course the caller is asking about — validated against the content. */
  courseId: string;
  /** The academic year the caller is asking about — validated against the content. */
  academicYear: number | string;
  sourceRef: string;
  /** Already-recorded official page content. No acquisition happens here. */
  content: string;
  dialect?: GroupUniverseDialect;
}

// ── minimal structural reading ───────────────────────────────────────────────

const TEXT = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;| /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Rows, each as its list of cell texts. Nested tables simply appear as more rows. */
function rowsOf(content: string): string[][] {
  const stripped = content.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  return stripped
    .split(/<tr\b/i)
    .slice(1)
    .map((row) => [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => TEXT(m[1])));
}

/** One occurrence of a group anchor, with whatever its own block stated. */
interface Anchor {
  courseId: string;
  groupId: string;
  types: Set<string>;
  semesters: Set<string>;
}

const single = (s: Set<string>): string | undefined => (s.size === 1 ? [...s][0] : undefined);

/**
 * Turn one already-recorded official course-details document into a typed group
 * universe. Pure and deterministic: same content in, byte-identical result out.
 */
export function normalizeOfferingGroupUniverse(input: NormalizeGroupUniverseInput): OfferingGroupUniverse {
  const d = input.dialect ?? DEFAULT_GROUP_UNIVERSE_DIALECT;
  const contentHash = `sha_${createHash('sha256').update(input.content, 'utf8').digest('hex').slice(0, 32)}`;

  const anchorRe = new RegExp(`(${d.courseId.source})\\s*${d.groupLabel.source}\\s*(\\S*)`);
  const anchors: Anchor[] = [];
  const anomalies: GroupUniverseAnomaly[] = [];
  let columns: { type: number; semester?: number; width: number } | undefined;

  for (const cells of rowsOf(input.content)) {
    if (cells.length === 0) continue;

    const anchor = anchorRe.exec(cells.join(' '));
    if (anchor) {
      // A new group block starts here; column positions are re-read per block
      // rather than carried over, so a layout change cannot silently mislabel.
      columns = undefined;
      const groupId = anchor[2].trim();
      if (!groupId) {
        anomalies.push({ kind: 'malformed_group_id', detail: `group entry for ${anchor[1]} has no readable group id` });
        continue;
      }
      anchors.push({ courseId: anchor[1], groupId, types: new Set(), semesters: new Set() });
      continue;
    }

    const typeIdx = cells.findIndex((c) => d.deliveryHeader.test(c));
    if (typeIdx >= 0) {
      const semIdx = cells.findIndex((c) => d.semesterHeader.test(c));
      columns = { type: typeIdx, width: cells.length, ...(semIdx >= 0 ? { semester: semIdx } : {}) };
      continue;
    }

    const current = anchors[anchors.length - 1];
    if (!columns || !current || cells.length !== columns.width) continue;
    const type = cells[columns.type];
    if (!type) continue; // a spacer row, not a meeting
    current.types.add(type);
    const semester = columns.semester === undefined ? '' : cells[columns.semester];
    if (semester) current.semesters.add(semester);
  }

  // ── identity validation ────────────────────────────────────────────────────
  const yearMatch = d.academicYear.exec(TEXT(input.content));
  const applicability: UniverseApplicability =
    yearMatch && yearMatch[1] !== String(input.academicYear)
      ? 'year_mismatch'
      : anchors.length === 0
        ? 'unidentified'
        : anchors.some((a) => a.courseId === input.courseId)
          ? 'applicable'
          : 'course_mismatch';

  const foreign = [...new Set(anchors.filter((a) => a.courseId !== input.courseId).map((a) => a.courseId))].sort();
  if (applicability !== 'course_mismatch' && foreign.length > 0) {
    anomalies.push({ kind: 'multiple_course_ids', detail: `also enumerates ${foreign.join(', ')}` });
  }

  // ── deduplicate, and detect groups republished with different detail ───────
  const byGroupId = new Map<string, OfferingGroup>();
  for (const a of anchors.filter((x) => x.courseId === input.courseId)) {
    const group: OfferingGroup = {
      groupId: a.groupId,
      ...(single(a.types) !== undefined ? { groupType: single(a.types) } : {}),
      ...(single(a.semesters) !== undefined ? { semester: single(a.semesters) } : {}),
      evidenceIds: [contentHash],
    };
    const seen = byGroupId.get(a.groupId);
    if (!seen) {
      byGroupId.set(a.groupId, group);
      continue;
    }
    if (seen.groupType !== group.groupType || seen.semester !== group.semester) {
      anomalies.push({ kind: 'conflicting_group', detail: `group ${a.groupId} published with differing detail` });
    }
    // An identical repeat is simply the same group — deduplicated, no anomaly.
  }

  const groups = [...byGroupId.values()].sort((a, b) => (a.groupId < b.groupId ? -1 : 1));
  const kinds = new Set(anomalies.map((x) => x.kind));

  const completeness: UniverseCompleteness =
    applicability === 'unidentified'
      ? 'unknown'
      : kinds.has('conflicting_group') || kinds.has('multiple_course_ids')
        ? 'conflicting'
        : kinds.has('malformed_group_id')
          ? 'incomplete'
          : groups.length > 0
            ? 'complete'
            : 'unknown';

  return {
    institutionId: input.institutionId,
    courseId: input.courseId,
    academicYear: input.academicYear,
    semesters: [...new Set(groups.map((g) => g.semester).filter((s): s is string => !!s))].sort(),
    groups,
    sourceRef: input.sourceRef,
    contentHash,
    normalizerVersion: GROUP_UNIVERSE_NORMALIZER_VERSION,
    applicability,
    completeness,
    anomalies,
  };
}

/**
 * The ONLY bridge from a universe into K7.5 aggregation.
 *
 * Returns the authoritative group ids only when the enumeration both describes
 * the requested offering and is known to be whole. Anything else returns
 * `undefined`, which `aggregateCourseLevelFeature` reads as "the universe is
 * unknown" — the conservative pre-existing behaviour.
 */
export function authoritativeGroupIds(universe: OfferingGroupUniverse): string[] | undefined {
  if (universe.applicability !== 'applicable' || universe.completeness !== 'complete') return undefined;
  return universe.groups.map((g) => g.groupId);
}

/** Course id → authoritative group ids, for `prepareEvidence`'s `groupUniverse`. */
export function groupUniverseIndex(universes: OfferingGroupUniverse[]): Record<string, string[]> {
  const index: Record<string, string[]> = {};
  for (const u of universes) {
    const ids = authoritativeGroupIds(u);
    if (ids) index[u.courseId] = ids;
  }
  return index;
}
