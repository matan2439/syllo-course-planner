/**
 * Program registry for the Next surfaces — a typed mirror of the canonical
 * PROGRAM_LIST / PROGRAM_FAMILIES embedded in
 * app/web/semester_board_viewer.html (the static planner's program modal).
 * Keep in sync when programs are added there; the drift guard in
 * tests/ui/programs_adapter.test.ts fails if a mirrored id disappears from
 * the canonical file. Pure data + resolution helpers, no planner logic.
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

const PROGRAMS: Record<string, ProgramVM> = {
  mechanical_engineering_2027: {
    id: 'mechanical_engineering_2027',
    name: 'הנדסה מכנית',
    track: null,
    year: '2027 (תשפ״ז)',
    description: 'קורסי בחירה וליבה לפי קובץ תשפ״ז — המקור העדכני ביותר',
    boardJsonFile: 'mechanical_semester_board_2027.json',
  },
  mechanical_engineering_2025: {
    id: 'mechanical_engineering_2025',
    name: 'הנדסה מכנית',
    track: null,
    year: '2025',
    description: 'תכנון קורסי חובה ובחירה בהנדסה מכנית',
    boardJsonFile: 'mechanical_semester_board.json',
  },
  mechanical_engineering_biomedical_track_2025: {
    id: 'mechanical_engineering_biomedical_track_2025',
    name: 'הנדסה מכנית',
    track: 'מגמה בהנדסה ביו-רפואית',
    year: '2025',
    description: 'תכנון קורסים להנדסה מכנית עם דגש ביו-רפואי',
    boardJsonFile: 'mechanical_semester_board.json',
  },
}

const FAMILIES = [
  {
    id: 'mechanical_engineering',
    name: 'הנדסה מכנית',
    track: null,
    description: 'תוכנית חד-חוגית בהנדסה מכנית',
    defaultProgramId: 'mechanical_engineering_2027',
    archiveIds: ['mechanical_engineering_2025'],
  },
  {
    id: 'mechanical_engineering_biomedical',
    name: 'הנדסה מכנית',
    track: 'מגמה בהנדסה ביו-רפואית',
    description: 'תכנון קורסים להנדסה מכנית עם דגש ביו-רפואי',
    defaultProgramId: 'mechanical_engineering_biomedical_track_2025',
    archiveIds: [],
  },
]

export const DEFAULT_PROGRAM_ID = 'mechanical_engineering_2027'

export function listProgramFamilies(): ProgramFamilyVM[] {
  return FAMILIES.map((f) => ({
    id: f.id,
    name: f.name,
    track: f.track,
    description: f.description,
    defaultProgram: PROGRAMS[f.defaultProgramId],
    archivePrograms: f.archiveIds.map((id) => PROGRAMS[id]),
  }))
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
