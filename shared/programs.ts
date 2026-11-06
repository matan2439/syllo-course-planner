import { z } from 'zod';
import registry from '../data/config/programs.json';
import { CATALOG_YEAR_POLICIES } from './institutions';
import { programIdOfBoard } from './planner/window_board';

/**
 * The single degree registry. data/config/programs.json is read by this module (TypeScript)
 * and by app/degrees/registry.py (Python); adding a degree means adding an entry there.
 */
export const programSchema = z.object({
  // `<base>_<year>`, optionally `<institution>:`-prefixed (app/degrees/registry.py: same rule).
  id: z.string().regex(/^(?:[a-z0-9_]+:)?[a-z0-9_]+$/),
  institution: z.string().regex(/^[a-z0-9_]+$/),
  base: z.string().min(1),
  year: z.number().int(),
  sourceYear: z.number().int(),
  nameHe: z.string().min(1),
  nameEn: z.string().min(1),
  track: z.string().nullable(),
  familyId: z.string().min(1),
  familyDescriptionHe: z.string(),
  descriptionHe: z.string(),
  yearLabelHe: z.string(),
  boardJsonFile: z.string().min(1),
  sourceIds: z.record(z.string()),
  status: z.enum(['draft', 'live', 'archived']),
  publicPlanner: z.boolean().optional(),
  isFamilyDefault: z.boolean(),
  capabilities: z.array(z.string()),
  catalogYearPolicy: z.enum(CATALOG_YEAR_POLICIES).optional(),
}).strict();
export type ProgramEntry = z.infer<typeof programSchema>;

/**
 * Parse and validate registry entries (app/degrees/registry.py validate_registry: same rules):
 * every entry is strict, an id is `[<institution>:]<base>_<year>` with year = sourceYear + 1,
 * ids are unique and every family has exactly one default entry.
 */
export function parseRegistry(programs: unknown[]): ProgramEntry[] {
  const entries = z.array(programSchema).min(1).parse(programs);
  for (const p of entries) {
    const cut = p.id.lastIndexOf(':');
    const prefix = cut < 0 ? '' : p.id.slice(0, cut);
    const bare = p.id.slice(cut + 1);
    if (prefix && prefix !== p.institution) throw new Error(`${p.id}: id prefix must be the institution (${p.institution})`);
    if (bare !== `${p.base}_${p.year}`) throw new Error(`${p.id}: id must be <base>_<year> (${p.base}_${p.year})`);
    if (p.year !== p.sourceYear + 1) throw new Error(`${p.id}: year (${p.year}) must be sourceYear + 1 (${p.sourceYear + 1})`);
  }
  const ids = entries.map((p) => p.id);
  const dups = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))].sort();
  if (dups.length) throw new Error(`duplicate program ids: ${dups.join(', ')}`);
  const defaults = new Map<string, number>();
  for (const p of entries) defaults.set(p.familyId, (defaults.get(p.familyId) ?? 0) + (p.isFamilyDefault ? 1 : 0));
  const bad = [...defaults].filter(([, n]) => n !== 1).sort(([a], [b]) => a.localeCompare(b));
  if (bad.length) {
    throw new Error(`every family needs exactly one isFamilyDefault entry: ${bad.map(([f, n]) => `${f}=${n}`).join(', ')}`);
  }
  return entries;
}

export const PROGRAM_REGISTRY: readonly ProgramEntry[] = parseRegistry((registry as { programs: unknown[] }).programs);

export function getProgramEntry(id: string): ProgramEntry | null {
  return PROGRAM_REGISTRY.find((p) => p.id === id) ?? null;
}

export function livePrograms(): ProgramEntry[] {
  return PROGRAM_REGISTRY.filter((p) => p.status === 'live');
}

/** Allowlisted draft programs for the editable planner on an isolated preview. */
export function isEditableDegreePreview(id: string): boolean {
  if (process.env.VERCEL_ENV === 'production' || process.env.NEXT_PUBLIC_VERCEL_ENV === 'production') return false;
  const programId = programIdOfBoard(id);
  if (getProgramEntry(programId)?.status !== 'draft') return false;
  const allowed = process.env.NEXT_PUBLIC_EDITABLE_DEGREE_PREVIEWS?.split(',').map(value => value.trim());
  return allowed?.includes(programId) === true
    || (process.env.NEXT_PUBLIC_ENABLE_EE_PLANNER === '1' && programId === 'electrical_engineering_2027');
}

/** Explicit public access to a draft planner while academic certification is pending. */
export function isPublicDraftPlanner(id: string): boolean {
  const program = getProgramEntry(programIdOfBoard(id));
  return program?.status === 'draft' && program.publicPlanner === true;
}

/**
 * Whether the API may serve a board/catalog for this program or window-board id. The owning
 * program decides (a `<base>_years_1_2_<year>` window board belongs to `<base>_<year>`):
 * Drafts and their window boards are hidden, except the explicitly enabled editable
 * integration previews. Ids unknown to the registry
 * (committed test boards) stay servable; live/archived are served.
 */
export function isServableProgramId(id: string): boolean {
  return getProgramEntry(programIdOfBoard(id))?.status !== 'draft'
    || isPublicDraftPlanner(id) || isEditableDegreePreview(id);
}
