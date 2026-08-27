import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { RawBoard } from './board'
import type { ProgramVM } from './programs'

/**
 * Server-side reader for a program's board JSON (same static files the
 * canonical planner falls back to). Returns null when the file is not
 * shipped in this checkout — pages render a calm fallback instead of
 * crashing. Assumes cwd = web/.
 */
export async function readBoardForProgram(
  program: ProgramVM
): Promise<RawBoard | null> {
  try {
    const file = path.resolve(
      process.cwd(),
      '..',
      'data',
      'parsed_json',
      program.boardJsonFile
    )
    return JSON.parse(await readFile(file, 'utf8')) as RawBoard
  } catch {
    return null
  }
}

/**
 * Read the exact server-authoritative local snapshot addressed by a program id.
 * Preview fixtures are deliberately not registered as public programs, so
 * resolving them through `getProgram()` would silently substitute the default
 * Mechanical Engineering repository while API mutations validate the fixture.
 * Fail closed for unsafe or missing ids; never fall back to another program.
 */
export async function readBoardForProgramId(
  programId: string
): Promise<RawBoard | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(programId)) return null
  try {
    const file = path.resolve(
      process.cwd(),
      '..',
      'data',
      'boards',
      `${programId}.json`
    )
    return JSON.parse(await readFile(file, 'utf8')) as RawBoard
  } catch {
    return null
  }
}

/** Shared page subtitle: program identity, as shipped by the registry. */
export function programSubtitle(program: ProgramVM, suffix?: string): string {
  const track = program.track ? ` · ${program.track}` : ''
  return `${program.name}${track} · ${program.year}${suffix ? ` — ${suffix}` : ''}`
}
