/**
 * Loads the full board_json snapshot for a program from a committed local file.
 * Used when DATABASE_URL is unavailable (dev / CI without DB access).
 *
 * Invariant: the planner must NEVER plan over a client-side subset.
 * loadLocalBoardJson returns the full universe or null — never a subset.
 * The caller must treat null as a hard error (503 NO_UNIVERSE), not a fallback.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const BOARDS_DIR = join(__dirname, '..', '..', 'data', 'boards');

export function loadLocalBoardJson(programId: string): any | null {
  const filePath = join(BOARDS_DIR, `${programId}.json`);
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}
