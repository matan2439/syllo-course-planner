import { z } from 'zod';
import registry from '../data/config/institutions.json';

/**
 * Universities/colleges as configuration. Rules that used to be implicit TAU constants
 * (credit unit, semester shape, the general/humanities requirement) live per institution in
 * data/config/institutions.json; code resolves an institution from a program id.
 */
export const BOARD_FORMATS = ['syllo_board_v1'] as const;
export const institutionSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  nameHe: z.string().min(1),
  nameEn: z.string().min(1),
  active: z.boolean(),
  programIdPattern: z.string().min(1),
  boardFormat: z.enum(BOARD_FORMATS),
  credits: z.object({ unitHe: z.string(), unitEn: z.string() }),
  semesters: z.object({ perYear: z.array(z.string().regex(/^[a-z]$/)).min(1), summer: z.boolean() }),
  generalRequirement: z.object({
    categoryId: z.string(), nameHe: z.string(), creditsPerCourse: z.number().positive(),
    countsTowardTotal: z.boolean(), source: z.string(),
  }).nullable().optional(),
  sources: z.record(z.string()).optional(),
}).strict();
export type Institution = z.infer<typeof institutionSchema>;

export const INSTITUTIONS: readonly Institution[] = z.object({ institutions: z.array(institutionSchema).min(1) })
  .parse({ institutions: (registry as { institutions: unknown[] }).institutions }).institutions;

export const DEFAULT_INSTITUTION_ID = 'tau';

export function getInstitution(id: string): Institution | null {
  return INSTITUTIONS.find((inst) => inst.id === id) ?? null;
}

/**
 * The institution a program belongs to: an explicit `<institution>:` prefix wins, else the
 * first active institution whose pattern matches. Today every program id is a TAU id
 * (no prefix), so existing ids and saved user data keep resolving to TAU unchanged.
 */
export function institutionForProgram(programId: string): Institution | null {
  const prefixed = /^([a-z0-9_]+):/.exec(programId);
  if (prefixed) return getInstitution(prefixed[1]);
  return INSTITUTIONS.find((inst) => inst.active && new RegExp(inst.programIdPattern).test(programId)) ?? null;
}
