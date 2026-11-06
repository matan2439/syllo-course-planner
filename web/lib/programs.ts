import { PROGRAM_REGISTRY, isServableProgramId, type ProgramEntry } from '../../shared/programs'

/**
 * UI view of the degree registry (data/config/programs.json). Drafts are
 * hidden; live and archived programs are listed. Pure data + resolution
 * helpers, no planner logic.
 */

export type ProgramVM = {
  id: string
  name: string
  track: string | null
  year: string
  description: string
  boardJsonFile: string
}

export type ProgramFamilyVM = {
  id: string
  name: string
  track: string | null
  description: string
  defaultProgram: ProgramVM
  archivePrograms: ProgramVM[]
}

function toVM(e: ProgramEntry): ProgramVM {
  return {
    id: e.id,
    name: e.nameHe,
    track: e.track,
    year: e.yearLabelHe,
    description: e.descriptionHe,
    boardJsonFile: e.boardJsonFile,
  }
}

const VISIBLE = PROGRAM_REGISTRY.filter((e) => isServableProgramId(e.id))

const PROGRAMS: Record<string, ProgramVM> = Object.fromEntries(VISIBLE.map((e) => [e.id, toVM(e)]))

const FAMILIES: ProgramFamilyVM[] = (() => {
  const byFamily = new Map<string, ProgramEntry[]>()
  for (const e of VISIBLE) byFamily.set(e.familyId, [...(byFamily.get(e.familyId) ?? []), e])
  const out: ProgramFamilyVM[] = []
  for (const [familyId, members] of byFamily) {
    const def = members.find((m) => m.isFamilyDefault)
    if (!def) continue
    out.push({
      id: familyId,
      name: def.nameHe,
      track: def.track,
      description: def.familyDescriptionHe,
      defaultProgram: PROGRAMS[def.id],
      archivePrograms: members.filter((m) => m !== def).map((m) => PROGRAMS[m.id]),
    })
  }
  return out
})()

export const DEFAULT_PROGRAM_ID = 'mechanical_engineering_2027'

export function listProgramFamilies(): ProgramFamilyVM[] {
  return FAMILIES.map((f) => ({ ...f, archivePrograms: [...f.archivePrograms] }))
}

/** Central resolution point: unknown/missing ids fall back to the default. */
export function getProgram(id: string | undefined): ProgramVM {
  return PROGRAMS[id ?? ''] ?? PROGRAMS[DEFAULT_PROGRAM_ID]
}

/**
 * Resolve a requested program without silently substituting another degree.
 * `getProgram` keeps its historical defaulting behavior for legacy callers;
 * user-facing routes should use this boundary for explicit query parameters.
 */
export function resolveProgram(id: string | undefined): ProgramVM | null {
  if (!id) return PROGRAMS[DEFAULT_PROGRAM_ID]
  return PROGRAMS[id] ?? null
}

/** Query-string suffix that preserves a non-default selection across pages. */
export function programQuery(id: string | undefined): string {
  if (!id || id === DEFAULT_PROGRAM_ID || !PROGRAMS[id]) return ''
  return `?program=${id}`
}
