/**
 * Non-public data-loader boundary (web) — proves the real end-to-end read-only
 * path: GET /api/board → shared/planner runtime parse + adapter → canonical
 * BoardModel. Independent of React rendering. `fetch` is injectable so tests
 * drive it with truthful mocked board payloads (never bypassing shared/planner).
 *
 * No route renders this in Slice 1. A future server component may call it after
 * the approved cutover.
 *
 * Direct module import (not the shared barrel): api-client → adapters → wire,
 * which performs zod runtime parsing (hence zod is an explicit web dependency).
 */
import { getBoard, type ClientDeps } from '../../../shared/planner/api-client'
import type { BoardModel } from '../../../shared/planner/model'

export interface LoadBoardOptions {
  /** Injectable fetch for tests; defaults to the platform global fetch. */
  fetchImpl?: ClientDeps['fetchImpl']
  /** Origin/prefix; '' means same-origin. */
  baseUrl?: string
}

export async function loadBoard(
  programId: string,
  opts: LoadBoardOptions = {},
): Promise<BoardModel> {
  const fetchImpl =
    opts.fetchImpl ?? (globalThis.fetch as unknown as ClientDeps['fetchImpl'])
  const baseUrl = opts.baseUrl ?? ''
  return getBoard({ fetchImpl, baseUrl }, programId)
}
