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
 */
export async function queryBoardJson(
  dbUrl: string,
  base: string,
  year: number,
): Promise<Record<string, unknown> | null> {
  const sql = postgres(dbUrl, { max: 1, idle_timeout: 5 });
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
    await sql.end();
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
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
  if (!dbUrl) {
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
