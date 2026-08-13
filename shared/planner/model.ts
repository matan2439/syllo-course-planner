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

/**
 * Canonical course-id normalization — matches the established server policy
 * (api/ai/course_topic_profile.ts:normalizeCourseId): trim strings, empty for
 * non-strings. Applied before indexing courses into the catalog.
 */
export function normalizeCourseId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
  /**
   * Full display universe from the SAME /api/board payload: placed courses
   * (semesters[].courses) ∪ metadata.program_repository_courses, keyed by
   * normalized course id. This is the authoritative lookup for interpreting
   * generated course ids; `semesters` remain PLACEMENTS, not the whole universe.
   */
  courseCatalog: Record<string, BoardCourseModel>;
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
/** Truthful record of how a free-text request fared against the ACTUAL plan. */
export interface IntentOutcomeModel {
  honored: string[];
  partiallyHonored: string[];
  unmet: string[];
  notesHe: string[];
}
export interface GeneratedPlanModel {
  semesters: PlanSemesterModel[];
  moves: PlanMoveModel[];
  warningsHe: string[];
  errors: string[];
  blocked: boolean;
  /** Present only when the server interpreted a free-text request (opt-in). */
  intentOutcome?: IntentOutcomeModel;
  /**
   * Structured agent outcome — present only on the opt-in AcademicDecisionAgent
   * path (default-off flag). Absent on the legacy/default response.
   */
  agentOutcome?: 'proposal' | 'clarification_required' | 'validation_failed' | 'blocked' | 'error';
  /**
   * Server-side Apply-eligibility floor for the agent path (true only for a
   * clean 'proposal'). Absent on the legacy/default response — apply gating
   * then falls back to blocked/errors/stale alone (backward-compatible).
   */
  applyEligible?: boolean;
  /** The preference-profile version this proposal was built from (agent path only). */
  profileVersion?: number
  /**
   * True when the flagged candidate orchestration found materially-distinct
   * balanced vs compact plans — i.e. asking the semester_balance question could
   * change the selected plan. Drives impact-driven elicitation. Absent/undefined
   * on the legacy path (no candidate analysis).
   */
  balanceAlternativesMaterial?: boolean
  /** Structured clarification items (agent path only). Lean VMs — no secrets. */
  agentClarificationItems?: AgentClarificationItemVM[];
  /** Typed grounding-validation findings (agent path only). */
  agentValidationFindings?: AgentValidationFindingVM[];
}

/** Lean view-model of a structured clarification item (subset the UI renders). */
export interface AgentClarificationItemVM {
  reasonCode: string;
  kind: 'answerable_preference' | 'authoritative_conflict';
  messageHe: string;
  answerable: boolean;
  applyBlocked: boolean;
  courseIds?: string[];
  answerType?: string;
  provenance?: { source: string | null; dataQuality: string | null; confidence: number } | null;
  detail?: string;
}

/** Lean view-model of a grounding-validation finding. */
export interface AgentValidationFindingVM {
  code: string;
  courseId: string;
  messageHe: string;
  detail: string;
  provenance: { source: string | null; dataQuality: string | null; confidence: number } | null;
}
