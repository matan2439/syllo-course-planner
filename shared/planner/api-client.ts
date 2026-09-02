/**
 * Runtime-neutral transport for the two canonical, EXISTING endpoints
 * (GET /api/board/:programId, POST /api/ai/generate-plan). No React, Next,
 * browser storage, or server modules — `fetch` is injected so this is usable
 * from any consumer. Malformed responses fail truthfully with ContractError;
 * missing identifiers/flags are never silently coerced.
 */
import { boardResponseToModel, generatePlanResponseToModel } from './adapters';
import {
  applyPlanResponseSchema, committedBoardResponseSchema, manualBoardEditResponseSchema,
  loadedPlanningContextResponseSchema, planningContextResponseSchema,
  type ManualBoardEditRequest, type PlanningContextRequest,
} from './wire';
import {
  conversationResponseSchema,
  type ConversationRequest,
  type ConversationResponse,
} from './conversation-wire';
import { ContractError } from './model';
import type { BoardModel, GeneratedPlanModel } from './model';

/** Minimal fetch shape (subset of the DOM/undici Response we rely on). */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export interface FetchLike {
  (url: string, init?: unknown): Promise<FetchResponseLike>;
}
export interface ClientDeps {
  fetchImpl: FetchLike;
  /** Origin/prefix, e.g. '' for same-origin or 'https://host'. */
  baseUrl: string;
}

export interface GeneratePlanRequest {
  program_id: string;
  plan_context: unknown;
  preferences: unknown;
  session_token: string;
  [key: string]: unknown;
}

async function readJson(res: FetchResponseLike): Promise<unknown> {
  if (!res.ok) throw new ContractError(`request failed with HTTP ${res.status}`);
  return res.json();
}

function asContractError(e: unknown, context: string): ContractError {
  if (e instanceof ContractError) return e;
  return new ContractError(`malformed ${context} response`, e);
}

export async function getBoard(deps: ClientDeps, programId: string): Promise<BoardModel> {
  const res = await deps.fetchImpl(`${deps.baseUrl}/api/board/${encodeURIComponent(programId)}`);
  const body = await readJson(res);
  try {
    return boardResponseToModel(body);
  } catch (e) {
    throw asContractError(e, 'board');
  }
}

export async function generatePlan(
  deps: ClientDeps,
  req: GeneratePlanRequest,
): Promise<GeneratedPlanModel> {
  const res = await deps.fetchImpl(`${deps.baseUrl}/api/ai/generate-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  const body = await readJson(res);
  try {
    return generatePlanResponseToModel(body);
  } catch (e) {
    throw asContractError(e, 'generate-plan');
  }
}

// ── S2: the authoritative Apply ─────────────────────────────────────────────

/**
 * What Apply is allowed to say. Note what is absent: any plan, any course id.
 * The server resolves the candidate from its own proposal record, so the client
 * is structurally incapable of choosing the committed content.
 */
export interface ApplyPlanRequest {
  program_id: string;
  proposal_id: string;
  candidate_id: string;
  expected_board_version: string | null;
  expected_profile_version: number;
  idempotency_key: string;
  academic_status?: unknown;
}

export interface CommittedBoardState {
  programId: string;
  version: string;
  semesters: Array<{ semesterId: string; courseIds: string[] }>;
}

export type ApplyPlanResult =
  | { ok: true; replayed: boolean; board: CommittedBoardState; appliedCandidateId: string }
  /** A typed, actionable refusal — never a stack trace. */
  | { ok: false; code: string; messageHe: string; currentBoardVersion?: string | null };

/**
 * A rejection is a NORMAL outcome here, not an exception: the server answers
 * 4xx with a typed reason the UI must render. Only a malformed body or a
 * transport failure is a ContractError, so a caller cannot confuse "the server
 * said no" with "the call never happened" — they require different UI.
 */
export async function applyPlan(deps: ClientDeps, req: ApplyPlanRequest): Promise<ApplyPlanResult> {
  let res: FetchResponseLike;
  try {
    res = await deps.fetchImpl(`${deps.baseUrl}/api/ai/apply-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Same-origin, so the ownership cookie travels by default; stated
      // explicitly because it is load-bearing rather than incidental.
      credentials: 'same-origin',
      body: JSON.stringify(req),
    });
  } catch (e) {
    throw new ContractError('apply-plan request failed', e);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (e) {
    throw asContractError(e, 'apply-plan');
  }
  const parsed = applyPlanResponseSchema.safeParse(body);
  if (!parsed.success) throw new ContractError('malformed apply-plan response', parsed.error);
  if (parsed.data.ok) {
    return {
      ok: true,
      replayed: parsed.data.replayed,
      board: parsed.data.board,
      appliedCandidateId: parsed.data.appliedCandidateId,
    };
  }
  return {
    ok: false,
    code: parsed.data.code,
    messageHe: parsed.data.message_he,
    currentBoardVersion: parsed.data.currentBoardVersion ?? null,
  };
}

/** The session's committed board, or null when it has never applied one. */
export async function getCommittedBoard(
  deps: ClientDeps,
  programId: string,
): Promise<CommittedBoardState | null> {
  const res = await deps.fetchImpl(
    `${deps.baseUrl}/api/ai/apply-plan?program_id=${encodeURIComponent(programId)}`,
    { credentials: 'same-origin' },
  );
  const body = await readJson(res);
  const parsed = committedBoardResponseSchema.safeParse(body);
  if (!parsed.success) throw new ContractError('malformed committed-board response', parsed.error);
  return parsed.data.board;
}

/**
 * Send one bounded transcript turn to the conversational Academic Agent.
 * Typed assistant unavailability is a normal response (including HTTP 503),
 * while every other non-success status remains a transport/contract error.
 */
export async function sendConversation(
  deps: ClientDeps,
  req: ConversationRequest,
): Promise<ConversationResponse> {
  let res: FetchResponseLike;
  try {
    res = await deps.fetchImpl(`${deps.baseUrl}/api/ai/conversation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(req),
    });
  } catch (error) {
    throw new ContractError('conversation request failed', error);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (error) {
    throw asContractError(error, 'conversation');
  }
  const parsed = conversationResponseSchema.safeParse(body);
  if (!parsed.success) throw new ContractError('malformed conversation response', parsed.error);
  if (!res.ok && parsed.data.outcome !== 'assistant_unavailable') {
    throw new ContractError(`conversation request failed with HTTP ${res.status}`);
  }
  return parsed.data;
}

// ── R2: authoritative manual board edit ────────────────────────────────────
export async function establishPlanningContext(
  deps: ClientDeps,
  req: PlanningContextRequest,
): Promise<{ academicStatusDigest: string }> {
  let res: FetchResponseLike;
  try {
    res = await deps.fetchImpl(`${deps.baseUrl}/api/ai/planning-context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(req),
    });
  } catch (error) {
    throw new ContractError('planning-context request failed', error);
  }
  const body = await readJson(res);
  const parsed = planningContextResponseSchema.safeParse(body);
  if (!parsed.success) throw new ContractError('malformed planning-context response', parsed.error);
  return { academicStatusDigest: parsed.data.academic_status_digest };
}

export interface LoadedPlanningContext {
  academicStatusDigest: string;
  preferenceDigest: string;
  personalStatus: unknown;
  preferences: Record<string, unknown>;
}

export async function getPlanningContext(
  deps: ClientDeps,
  programId: string,
): Promise<LoadedPlanningContext | null> {
  const res = await deps.fetchImpl(
    `${deps.baseUrl}/api/ai/planning-context?program_id=${encodeURIComponent(programId)}`,
    { credentials: 'same-origin' },
  );
  const body = await readJson(res);
  const parsed = loadedPlanningContextResponseSchema.safeParse(body);
  if (!parsed.success) throw new ContractError('malformed planning-context response', parsed.error);
  if (!parsed.data.context) return null;
  return {
    academicStatusDigest: parsed.data.context.academic_status_digest,
    preferenceDigest: parsed.data.context.preference_digest,
    personalStatus: parsed.data.context.personal_status,
    preferences: parsed.data.context.preferences,
  };
}

export type ManualBoardEditResult =
  | { ok: true; replayed: boolean; operationId: string; board: CommittedBoardState }
  | { ok: false; code: string; messageHe: string; currentBoardVersion?: string | null };

export async function editBoard(
  deps: ClientDeps,
  req: ManualBoardEditRequest,
): Promise<ManualBoardEditResult> {
  let res: FetchResponseLike;
  try {
    res = await deps.fetchImpl(`${deps.baseUrl}/api/ai/edit-board`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(req),
    });
  } catch (error) {
    throw new ContractError('edit-board request failed', error);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (error) {
    throw asContractError(error, 'edit-board');
  }
  const parsed = manualBoardEditResponseSchema.safeParse(body);
  if (!parsed.success) throw new ContractError('malformed edit-board response', parsed.error);
  if (parsed.data.ok) {
    return {
      ok: true, replayed: parsed.data.replayed,
      operationId: parsed.data.operation_id, board: parsed.data.board,
    };
  }
  return {
    ok: false, code: parsed.data.code, messageHe: parsed.data.message_he,
    currentBoardVersion: parsed.data.currentBoardVersion ?? null,
  };
}
