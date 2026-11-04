import { z } from 'zod';
import registry from '../data/config/programs.json';
import { CATALOG_YEAR_POLICIES } from './institutions';

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
  isFamilyDefault: z.boolean(),
  capabilities: z.array(z.string()),
  catalogYearPolicy: z.enum(CATALOG_YEAR_POLICIES).optional(),
}).strict();
export type ProgramEntry = z.infer<typeof programSchema>;

/**
 * Parse and validate registry entries (app/degrees/registry.py validate_registry: same rules):
 * every entry is strict, ids are unique and every family has exactly one default entry.
 */
export function parseRegistry(programs: unknown[]): ProgramEntry[] {
  const entries = z.array(programSchema).min(1).parse(programs);
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
