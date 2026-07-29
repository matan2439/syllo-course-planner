/**
 * Canonical planner MODELS + primitives — the exact internal representation,
 * shared by api/ (root) and web/ (Next). Runtime-neutral: no React, Next,
 * browser storage, zod, or server modules here (pure TS).
 *
 * Layer boundary (approved): this file is neither the wire schema layer
 * (shared/planner/wire.ts) nor a UI view model. Hours are stored as EXACT
 * integer half-hour units; conversion is lossless and rejects unsupported
 * precision rather than rounding.
 */

/** Client-owned contract version. NOTE: not returned by the server today. */
export const CONTRACT_VERSION = 1 as const;

/** Typed, truthful failure for any contract/precision violation. */
export class ContractError extends Error {
  readonly detail?: unknown;
  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = 'ContractError';
    this.detail = detail;
  }
}

// ── Half-hour units (exact) ──────────────────────────────────────────────────
/** Decimal weekly hours (e.g. 3.5) → integer half-hour units (e.g. 7). */
export function toHalfHours(decimalHours: number): number {
  if (typeof decimalHours !== 'number' || !Number.isFinite(decimalHours)) {
    throw new ContractError(`toHalfHours: not a finite number: ${String(decimalHours)}`);
  }
  const units = decimalHours * 2;
  if (!Number.isInteger(units)) {
    throw new ContractError(
      `toHalfHours: ${decimalHours} is not representable in half-hour units (would round)`,
    );
  }
  return units;
}

/** Integer half-hour units → decimal weekly hours (lossless inverse). */
export function fromHalfHours(units: number): number {
  if (!Number.isInteger(units)) {
    throw new ContractError(`fromHalfHours: ${units} is not an integer half-hour count`);
  }
  return units / 2;
}

// ── Revisions (kept DISTINCT — never collapsed into one baseRevision) ─────────
export type CatalogRevision = string & { readonly __brand: 'CatalogRevision' };
export type ProposalBaseRevision = string & { readonly __brand: 'ProposalBaseRevision' };
export type LocalWorkspaceRevision = string & { readonly __brand: 'LocalWorkspaceRevision' };

/** The catalog revision the server reports (board_json metadata.board_data_version). */
export const catalogRevision = (s: string): CatalogRevision => s as CatalogRevision;
/** The catalog revision captured locally when a proposal was generated. */
export const proposalBaseRevision = (s: string): ProposalBaseRevision => s as ProposalBaseRevision;
/** A client-generated revision id for the locally persisted workspace. */
export const localWorkspaceRevision = (s: string): LocalWorkspaceRevision => s as LocalWorkspaceRevision;

/**
 * A locally-based proposal/workspace is stale iff the catalog revision it was
 * based on differs from the current catalog revision. (Slice 0: this marks
 * local state for revalidation/regeneration; it never produces an HTTP 409 —
 * localStorage has no server write.)
 */
export function isCatalogStale(capturedBase: ProposalBaseRevision, current: CatalogRevision): boolean {
  return (capturedBase as string) !== (current as string);
}

// ── Canonical models ─────────────────────────────────────────────────────────
export interface BoardCourseModel {
  courseId: string;
  nameHe: string;
  /** Exact half-hour units, or null when the catalog has no weekly hours. */
  halfHours: number | null;
  courseType: string;
  isMandatory: boolean;
}
export interface BoardSemesterModel {
  semesterId: string;
  courses: BoardCourseModel[];
}
export interface BoardModel {
  catalogRevision: CatalogRevision;
  semesters: BoardSemesterModel[];
}

export interface PlanSemesterModel {
  semesterId: string;
  courseIds: string[];
}
export interface PlanMoveModel {
  courseId: string;
  from: string | null;
  to: string;
}
export interface GeneratedPlanModel {
  semesters: PlanSemesterModel[];
  moves: PlanMoveModel[];
  warningsHe: string[];
  errors: string[];
  blocked: boolean;
}
