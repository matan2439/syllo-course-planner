/**
 * GET /api/board/[programId]
 *
 * Returns the pre-computed board JSON for a program version.
 *
 * programId format: "{base_program_id}_{academic_year}"
 *   e.g. "mechanical_engineering_2027"
 *        → program_id = "mechanical_engineering", academic_year = 2027
 *
 * The board JSON stored in program_versions.board_json is returned as-is.
 * Its schema is identical to data/parsed_json/mechanical_semester_board_2027.json.
 *
 * Error responses (all JSON):
 *   400  Invalid programId format
 *   404  Program not found or board_json not yet populated
 *   503  DATABASE_URL not configured, or DB connection failed
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import postgres from 'postgres';
import { loadLocalBoardJson } from './ai/board_loader';

// ── Parsing ───────────────────────────────────────────────────────────────────

export interface ParsedProgramId {
  base: string;
  year: number;
}

/**
 * Parse "mechanical_engineering_2027" → { base: "mechanical_engineering", year: 2027 }
 * The year must be exactly 4 digits at the end, preceded by an underscore.
 * Returns null for anything else.
 */
export function parseProgramVersionId(programId: string): ParsedProgramId | null {
  const m = programId.match(/^(.+)_(\d{4})$/);
  if (!m) return null;
  return { base: m[1], year: parseInt(m[2], 10) };
}

// ── Database ──────────────────────────────────────────────────────────────────

/**
 * Query program_versions for board_json.
 * Exported for unit-testing via dependency injection.
 *
 * Connection options explained:
 *   prepare: false      — Supabase uses PgBouncer in transaction mode (port 6543).
 *                         PgBouncer transaction mode does not support prepared
 *                         statements. Without this flag the postgres package sends
 *                         PREPARE/EXECUTE which PgBouncer rejects, causing the
 *                         connection to hang.
 *   connect_timeout: 10 — Fail fast instead of blocking indefinitely on a
 *                         bad connection.
 *   idle_timeout: 5     — Release idle connections quickly in serverless context.
 */
export async function queryBoardJson(
  dbUrl: string,
  base: string,
  year: number,
): Promise<Record<string, unknown> | null> {
  const sql = postgres(dbUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,  // don't hang on a slow/failed connection
    prepare: false,        // required: PgBouncer transaction mode forbids prepared statements
  });
  try {
    const rows = await sql<Array<{ board_json: Record<string, unknown> | null }>>`
      SELECT board_json
      FROM   program_versions
      WHERE  program_id    = ${base}
        AND  academic_year = ${year}
      LIMIT  1
    `;
    if (!rows.length || rows[0].board_json == null) return null;
    return rows[0].board_json;
  } finally {
    // timeout: 5 prevents sql.end() from hanging when the connection is in a
    // bad state (e.g. PgBouncer rejected the session). Without this, the
    // finally block blocks forever → NO_RESPONSE_FROM_FUNCTION (502).
    await sql.end({ timeout: 5 });
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // Outer catch: ensures we always send a response even if something
  // unexpected throws before or after the queryBoardJson try/catch.
  try {
    await _handle(req, res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Unexpected server error.',
        code: 'INTERNAL_ERROR',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function _handle(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const rawId = Array.isArray(req.query.programId)
    ? req.query.programId[0]
    : (req.query.programId ?? '');

  const parsed = parseProgramVersionId(rawId);
  if (!parsed) {
    res.status(400).json({
      error: `Invalid programId: "${rawId}". Expected format: {program_id}_{year}, e.g. mechanical_engineering_2027`,
      code: 'INVALID_PROGRAM_ID',
    });
    return;
  }

  const dbUrl = process.env.DATABASE_URL ?? '';

  // DB OUTAGE fallback: a missing DATABASE_URL or a failed DB connection (e.g.
  // the Supabase pooler returning ENOTFOUND when the free-tier project is
  // paused) must NOT block board display when the identical board_json is
  // committed at data/boards/<programId>.json — the SAME loadLocalBoardJson
  // resilience api/ai/generate-plan.ts already relies on. This keeps the board
  // display consistent with generation (both plan over that local universe when
  // the DB is down). A DB that is REACHABLE but simply has no such program is a
  // genuine 404 below — it does not fall back.
  if (!dbUrl) {
    const local = loadLocalBoardJson(rawId);
    if (local) { res.status(200).json(local); return; }
    res.status(503).json({
      error: 'DATABASE_URL is not configured on this server.',
      code: 'NO_DATABASE_URL',
    });
    return;
  }

  let board: Record<string, unknown> | null;
  try {
    board = await queryBoardJson(dbUrl, parsed.base, parsed.year);
  } catch (err) {
    const local = loadLocalBoardJson(rawId);
    if (local) { res.status(200).json(local); return; }
    res.status(503).json({
      error: 'Database query failed.',
      code: 'DB_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (!board) {
    res.status(404).json({
      error: `Program "${rawId}" not found or board data not yet populated.`,
      code: 'NOT_FOUND',
    });
    return;
  }

  res.status(200).json(board);
}
