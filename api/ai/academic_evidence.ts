/**
 * K1 — the authoritative ACADEMIC SOURCE + EVIDENCE contract.
 *
 * The smallest generic boundary for representing academic knowledge with
 * provenance. Nothing here is institution-, program- or subject-specific:
 * institution, program, course, academic year and source reference are all
 * parameters. A different university with different regulations uses the same
 * contract.
 *
 * Relationship to `knowledge_types.ts`: that module grounds an arbitrary
 * PROFESSIONAL CAPABILITY (what "design" or "robotics" means) against a general
 * web-authority hierarchy (accreditation body → standards body → … → informal).
 * This module is a different concern: the provenance of an ACADEMIC FACT about a
 * specific course in a specific program and year (does it exist, how many
 * credits, what prerequisites, when is it offered). The two hierarchies are
 * deliberately separate — a peer-reviewed paper is a strong source about a
 * profession and no source at all about a university's degree regulations.
 *
 * Core rules enforced here:
 *   1. Only AUTHORITATIVE source classes may determine a legality-bearing fact.
 *      Secondary/descriptive sources supply context and can never override them.
 *   2. No fact without evidence. `resolveFact` never returns a bare value; every
 *      resolution carries the records behind it, INCLUDING the ones it did not
 *      choose.
 *   3. Applicability beats recency. A newer document published for a different
 *      academic year (or program) never silently becomes the current fact.
 *   4. Two conflicting authoritative sources of the same class produce a
 *      deterministic `conflicting` state requiring review — both records are
 *      retained and neither is silently overwritten.
 *   5. `uncertain` / `conflicting` / `stale` / `missing` / `unsupported` can
 *      never reach hard legality. `legalityValue` is the single door, and it
 *      only opens for `confirmed_authoritative`.
 *
 * Pure: no I/O, no network, no LLM, no mutation. Same inputs ⇒ byte-identical
 * output, which is what lets a planning run be reproducible from a snapshot.
 */

// ── source hierarchy ─────────────────────────────────────────────────────────

/**
 * Academic source classes, in DESCENDING precedence. Index = authority rank, so
 * a lower index outranks a higher one when both are authoritative and disagree.
 */
export const ACADEMIC_SOURCE_CLASSES = [
  /** 1. Official university catalog / degree regulations — the top authority on legality. */
  'official_catalog',
  /** 2. Official faculty/course syllabus. */
  'official_syllabus',
  /** 3. Official timetable / exam source. */
  'official_timetable',
  /** 4. Authoritative imported student record (the student's own official transcript). */
  'authoritative_student_record',
  /** 5. Secondary descriptive source — context only, never legality. */
  'secondary_descriptive',
  /** 6. Unsupported / unverified source. */
  'unverified',
] as const;

export type AcademicSourceClass = (typeof ACADEMIC_SOURCE_CLASSES)[number];

/** The classes permitted to establish an academic fact as authoritative. */
const AUTHORITATIVE_CLASSES: ReadonlySet<string> = new Set([
  'official_catalog', 'official_syllabus', 'official_timetable', 'authoritative_student_record',
]);

export function isAuthoritativeSourceClass(sourceClass: AcademicSourceClass): boolean {
  return AUTHORITATIVE_CLASSES.has(sourceClass);
}

function authorityRank(sourceClass: AcademicSourceClass): number {
  const i = ACADEMIC_SOURCE_CLASSES.indexOf(sourceClass);
  return i < 0 ? ACADEMIC_SOURCE_CLASSES.length : i;
}

// ── fact types ───────────────────────────────────────────────────────────────

export type AcademicFactType =
  | 'course_exists'
  | 'credits'
  | 'prerequisites'
  | 'offering_periods'
  /** mandatory / elective category classification */
  | 'classification'
  | 'exam_rules'
  | 'degree_legality'
  /** Descriptive course feature (assessment shape, topics, …) — never legality-bearing. */
  | 'descriptive_feature';

/**
 * The fact types that carry DEGREE LEGALITY. Only an authoritative source class
 * may determine one of these; a secondary source claiming one is `unsupported`.
 */
export const LEGALITY_FACT_TYPES: readonly AcademicFactType[] = [
  'course_exists', 'credits', 'prerequisites', 'offering_periods',
  'classification', 'exam_rules', 'degree_legality',
];

function isLegalityFact(factType: AcademicFactType): boolean {
  return LEGALITY_FACT_TYPES.includes(factType);
}

// ── knowledge states ─────────────────────────────────────────────────────────

export type KnowledgeState =
  /** Established by an authoritative, applicable, fresh, confident source. */
  | 'confirmed_authoritative'
  /** Established descriptively (non-legality fact from a secondary source). */
  | 'confirmed_descriptive'
  /** Evidence exists but is not confident enough to act on. */
  | 'uncertain'
  /** Two authoritative sources of equal rank disagree — needs review. */
  | 'conflicting'
  /** Only inapplicable-version or past-freshness evidence exists. */
  | 'stale'
  /** No evidence at all. */
  | 'missing'
  /** A legality-bearing claim backed only by a non-authoritative source. */
  | 'unsupported';

// ── evidence record ──────────────────────────────────────────────────────────

export interface AcademicEvidence {
  /** Stable, deterministic id derived from the record's identifying fields. */
  evidenceId: string;
  institutionId: string;
  programId?: string;
  courseId: string;
  factType: AcademicFactType;
  /** The NORMALIZED value (already parsed into the planner's own vocabulary). */
  value: unknown;
  /** Source URL, or a stable non-URL reference for an imported record. */
  sourceRef: string;
  sourceClass: AcademicSourceClass;
  /** The academic year / catalog version this evidence APPLIES TO. */
  academicYear: number | string;
  /** Document version where the source declares one. */
  sourceVersion?: string;
  /** ISO timestamp of retrieval. */
  retrievedAt: string;
  /** ISO date the fact takes effect, where the source states one. */
  effectiveFrom?: string;
  /** How the value was extracted (e.g. 'rule:syllabus_assessment'). */
  extractionMethod: string;
  extractionVersion: string;
  /** 0..1. */
  confidence: number;
  /** DERIVED from sourceClass — never caller-supplied. */
  authoritative: boolean;
  /** Short original-language excerpt, within copyright-safe limits. */
  excerpt?: string;
  /** Where in the source the claim sits, when an excerpt is withheld. */
  locator?: string;
}

/** Small deterministic string hash (FNV-1a) — stable across runs, no randomness. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export type AcademicEvidenceInput = Omit<AcademicEvidence, 'evidenceId' | 'authoritative'> &
  Partial<Pick<AcademicEvidence, 'authoritative'>>;

/**
 * Build an evidence record. `evidenceId` is derived from the identifying fields
 * (so the same claim from the same source always gets the same id, and a
 * different value/year/class gets a different one), and `authoritative` is
 * derived from `sourceClass` — a caller cannot assert its own authority.
 */
export function makeEvidence(input: AcademicEvidenceInput): AcademicEvidence {
  const identity = [
    input.institutionId, input.programId ?? '', input.courseId, input.factType,
    JSON.stringify(input.value ?? null), input.sourceRef, input.sourceClass,
    String(input.academicYear), input.sourceVersion ?? '',
    input.extractionMethod, input.extractionVersion,
  ].join('|');

  const { authoritative: _ignored, ...rest } = input;
  return {
    ...rest,
    evidenceId: `ev_${hash(identity)}`,
    authoritative: isAuthoritativeSourceClass(input.sourceClass),
  };
}

/** Whether this single record is permitted to determine a legality-bearing fact. */
export function mayDetermineLegality(evidence: AcademicEvidence): boolean {
  if (!isLegalityFact(evidence.factType)) return false;
  return evidence.authoritative;
}

// ── resolution ───────────────────────────────────────────────────────────────

export interface ResolvedFact {
  state: KnowledgeState;
  /** Present ONLY for a confirmed state. Absent for every other state. */
  value?: unknown;
  /** EVERY candidate record, including outranked, inapplicable and conflicting ones. */
  evidence: AcademicEvidence[];
  /** Present only when state === 'conflicting'. */
  conflict?: { reason: string; evidenceIds: string[] };
}

/**
 * K5 — the single deterministic freshness/applicability policy. Every staleness
 * and version decision reads from ONE of these rather than comparing timestamps
 * ad hoc at each call site, so two callers can never disagree about whether the
 * same record is current.
 */
export interface FreshnessPolicy {
  /** Max age of a retrieval before the record is stale. Omitted ⇒ age never expires it. */
  maxAgeDays?: number;
  /**
   * Whether a record whose `effectiveFrom` is AFTER the moment of evaluation is
   * usable. False (the default) treats a not-yet-effective record as stale — a
   * future regulation must not govern the current plan.
   */
  allowNotYetEffective?: boolean;
  /** Minimum confidence to confirm a fact. Default 0.5. */
  minConfidence?: number;
}

export const DEFAULT_FRESHNESS_POLICY: FreshnessPolicy = {
  maxAgeDays: undefined,
  allowNotYetEffective: false,
  minConfidence: 0.5,
};

export interface ResolveContext {
  /** The academic year the plan is being built for. */
  academicYear: number | string;
  /** ISO 'now' — supplied, never read from the clock, so resolution is reproducible. */
  now: string;
  /** When set, evidence for a different program does not apply. */
  programId?: string;
  /** Minimum confidence to confirm a fact. Overrides the policy's own value. */
  minConfidence?: number;
  /** Freshness bound in days. Overrides the policy's own value. */
  maxAgeDays?: number;
  /** K5 — the deterministic freshness policy. Defaults to DEFAULT_FRESHNESS_POLICY. */
  policy?: FreshnessPolicy;
}

const DAY_MS = 86_400_000;

/** Deterministic ordering so a resolution never depends on input array order. */
function sortEvidence(list: AcademicEvidence[]): AcademicEvidence[] {
  return [...list].sort((a, b) =>
    authorityRank(a.sourceClass) - authorityRank(b.sourceClass) ||
    (a.evidenceId < b.evidenceId ? -1 : a.evidenceId > b.evidenceId ? 1 : 0),
  );
}

/**
 * Resolve one fact from its candidate evidence.
 *
 * Order of judgment (each step can only DOWNGRADE, never upgrade):
 *   1. no candidates                       → missing
 *   2. keep only records applicable to this academic year (and program, when
 *      given). None applicable → stale. Inapplicable records are RETAINED in
 *      `evidence` for review, never dropped.
 *   3. drop records past the freshness bound. None left → stale.
 *   4. legality-bearing fact with no authoritative record → unsupported.
 *      Non-legality fact with only secondary records → confirmed_descriptive.
 *   5. among the highest-ranked authoritative class, disagreement → conflicting
 *      (both retained, no winner picked).
 *   6. below minimum confidence → uncertain.
 *   7. otherwise → confirmed_authoritative.
 */
export function resolveFact(candidates: AcademicEvidence[], ctx: ResolveContext): ResolvedFact {
  const all = sortEvidence(candidates);
  if (all.length === 0) return { state: 'missing', evidence: [] };

  const policy = { ...DEFAULT_FRESHNESS_POLICY, ...(ctx.policy ?? {}) };
  const minConfidence = ctx.minConfidence ?? policy.minConfidence ?? 0.5;
  const maxAgeDays = ctx.maxAgeDays ?? policy.maxAgeDays;

  const applicable = all.filter(
    (e) =>
      String(e.academicYear) === String(ctx.academicYear) &&
      // A record with no programId is program-agnostic and applies everywhere.
      (ctx.programId === undefined || e.programId === undefined || e.programId === ctx.programId),
  );
  if (applicable.length === 0) return { state: 'stale', evidence: all };

  // One policy decides freshness: retrieval age, and whether a record that is
  // not yet in effect may govern the present.
  const fresh = applicable.filter((e) => {
    if (maxAgeDays !== undefined && Date.parse(ctx.now) - Date.parse(e.retrievedAt) > maxAgeDays * DAY_MS) {
      return false;
    }
    if (!policy.allowNotYetEffective && e.effectiveFrom && Date.parse(e.effectiveFrom) > Date.parse(ctx.now)) {
      return false;
    }
    return true;
  });
  if (fresh.length === 0) return { state: 'stale', evidence: all };

  const authoritative = fresh.filter((e) => e.authoritative);

  if (authoritative.length === 0) {
    // A legality-bearing claim can never rest on a non-authoritative source.
    if (isLegalityFact(fresh[0].factType)) return { state: 'unsupported', evidence: all };
    const best = fresh[0];
    if (best.confidence < minConfidence) return { state: 'uncertain', evidence: all };
    return { state: 'confirmed_descriptive', value: best.value, evidence: all };
  }

  // Highest-ranked authoritative class present. A lower official class that
  // disagrees is OUTRANKED (not a conflict) — official regulation beats a
  // syllabus restatement — but its record is still retained.
  const topRank = Math.min(...authoritative.map((e) => authorityRank(e.sourceClass)));
  const top = authoritative.filter((e) => authorityRank(e.sourceClass) === topRank);

  const distinct = [...new Set(top.map((e) => JSON.stringify(e.value ?? null)))];
  if (distinct.length > 1) {
    return {
      state: 'conflicting',
      evidence: all,
      conflict: {
        reason: `two ${top[0].sourceClass} sources disagree on ${top[0].factType}`,
        evidenceIds: top.map((e) => e.evidenceId).sort(),
      },
    };
  }

  const winner = top[0];
  if (winner.confidence < minConfidence) return { state: 'uncertain', evidence: all };
  return { state: 'confirmed_authoritative', value: winner.value, evidence: all };
}

/**
 * The SINGLE door from resolved knowledge onto hard legality. Returns the value
 * only for `confirmed_authoritative`; every other state — including
 * `confirmed_descriptive` — yields undefined, so an uncertain, conflicting,
 * stale, missing, unsupported or merely descriptive fact can never silently
 * change what the planner treats as legal.
 */
export function legalityValue(resolved: ResolvedFact): unknown | undefined {
  return resolved.state === 'confirmed_authoritative' ? resolved.value : undefined;
}
