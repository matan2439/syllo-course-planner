/**
 * Runtime-neutral transport for the two canonical, EXISTING endpoints
 * (GET /api/board/:programId, POST /api/ai/generate-plan). No React, Next,
 * browser storage, or server modules — `fetch` is injected so this is usable
 * from any consumer. Malformed responses fail truthfully with ContractError;
 * missing identifiers/flags are never silently coerced.
 */
import { boardResponseToModel, generatePlanResponseToModel } from './adapters';
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
