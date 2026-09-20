/**
 * authoritative_resolution.ts — the narrow, auditable domain contract for
 * resolving an AUTHORITATIVE academic-fact conflict (Slice 15).
 *
 * This is deliberately separate from the student preference conversation: an
 * ordinary student is NEVER asked which prerequisite / semester availability /
 * official requirement is correct. Only an authorized academic actor may submit
 * a correction, and only with adequate authority + provenance. A submission
 * lacking either is rejected. The original conflicting facts are preserved for
 * auditability. No UI is exposed here, and there is no persistence/Supabase —
 * this is the contract + validation only, per the current identity/role model.
 */

export const AUTHORITY_TYPES = [
  'catalog_admin',
  'department_advisor',
  'registrar',
  'verified_source',
] as const;
export type AuthorityType = (typeof AUTHORITY_TYPES)[number];

export interface CorrectedFact {
  /** e.g. 'availability' | 'prerequisite' | 'requirement' | 'hours'. Open string. */
  kind: string;
  courseId?: string;
  value: unknown;
}

export interface ResolutionProvenance {
  url?: string;
  documentRef?: string;
  note?: string;
}

export interface AuthoritativeResolution {
  /** The finding/conflict id this resolves (e.g. from grounding-validation). */
  conflictId: string;
  correctedFact: CorrectedFact;
  source: string;
  provenance: ResolutionProvenance;
  authorityType: AuthorityType;
  authorizedActorId: string;
  timestamp: string;
  version?: string;
  /** The conflicting facts as they stood, kept verbatim for audit. */
  originalConflictingFacts: unknown;
}

export type ResolutionValidation =
  | { accepted: true; resolution: AuthoritativeResolution }
  | { accepted: false; reasons: string[] };

function hasProvenance(p: ResolutionProvenance | undefined | null): boolean {
  return !!p && (!!p.url || !!p.documentRef || !!p.note);
}

/**
 * Validate a proposed resolution. Rejects (never throws) whenever the authority
 * or provenance is inadequate — an unsourced or unauthorized fact must never
 * override the grounded catalog data.
 */
export function validateAuthoritativeResolution(input: Partial<AuthoritativeResolution>): ResolutionValidation {
  const reasons: string[] = [];

  if (!input.conflictId) reasons.push('missing conflictId');
  if (!input.correctedFact || input.correctedFact.value === undefined) reasons.push('missing correctedFact');
  if (!input.source) reasons.push('missing source');
  if (!hasProvenance(input.provenance)) reasons.push('missing provenance (url/documentRef/note)');
  if (!input.authorityType || !(AUTHORITY_TYPES as readonly string[]).includes(input.authorityType)) {
    reasons.push('missing or unrecognized authorityType');
  }
  if (!input.authorizedActorId) reasons.push('missing authorizedActorId');
  if (!input.timestamp) reasons.push('missing timestamp');
  if (input.originalConflictingFacts === undefined) reasons.push('missing originalConflictingFacts (audit)');

  if (reasons.length > 0) return { accepted: false, reasons };
  return { accepted: true, resolution: input as AuthoritativeResolution };
}
