import { z } from 'zod';
import registry from '../data/config/programs.json';
import { CATALOG_YEAR_POLICIES } from './institutions';

/**
 * The single degree registry. data/config/programs.json is read by this module (TypeScript)
 * and by app/degrees/registry.py (Python); adding a degree means adding an entry there.
 */
export const programSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
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

export const PROGRAM_REGISTRY: readonly ProgramEntry[] = z.object({ programs: z.array(programSchema).min(1) })
  .parse({ programs: (registry as { programs: unknown[] }).programs }).programs;

export function getProgramEntry(id: string): ProgramEntry | null {
  return PROGRAM_REGISTRY.find((p) => p.id === id) ?? null;
}

export function livePrograms(): ProgramEntry[] {
  return PROGRAM_REGISTRY.filter((p) => p.status === 'live');
}
