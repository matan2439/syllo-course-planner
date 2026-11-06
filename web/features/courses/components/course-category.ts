import { getInstitution, DEFAULT_INSTITUTION_ID } from '../../../../shared/institutions'
import type { CSSProperties } from 'react'
/**
 * Visual category accents deliberately mirror the program category ids from
 * the board contract. Unknown categories remain visually neutral rather than
 * being guessed from a course name.
 */
/** The program's general-studies (שער רוח) requirement category, as the board contract names it. */
export const GATEWAY_CATEGORY_ID = getInstitution(DEFAULT_INSTITUTION_ID)?.generalRequirement?.categoryId ?? 'shaar_ruach'

const CATEGORY_ACCENT_CLASS: Readonly<Record<string, string>> = {
  fluids: 'card-cat-fluids',
  solids: 'card-cat-solids',
  systems: 'card-cat-systems',
  advanced_labs: 'card-cat-labs',
  other_specialization: 'card-cat-other_specialization',
  [GATEWAY_CATEGORY_ID]: 'card-cat-shaar_ruach',
}

const TRACK_ACCENTS: Readonly<Record<string, string>> = {
  communications: '#2563eb',
  signal_processing: '#0891b2',
  computer_systems: '#4338ca',
  control_autonomous: '#0f766e',
  energy_renewables: '#65a30d',
  optics_photonics: '#db2777',
  devices_nanoelectronics: '#9333ea',
  electromagnetics_radiation: '#c2410c',
  bioelectronics: '#059669',
  electronic_materials: '#a16207',
  quantum: '#7e22ce',
  multidisciplinary: '#64748b',
  vlsi: '#b91c1c',
  ml_ai: '#be185d',
  hardware_exposure_elective: '#0284c7',
}

export function categoryAccentClass(categoryId: string | null | undefined): string {
  if (!categoryId) return ''
  return CATEGORY_ACCENT_CLASS[categoryId] ?? (Object.hasOwn(TRACK_ACCENTS, categoryId) ? 'card-cat-track' : '')
}

export function categoryAccentStyle(categoryId: string | null | undefined): CSSProperties | undefined {
  if (categoryId && Object.hasOwn(TRACK_ACCENTS, categoryId)) {
    return { '--track-accent': TRACK_ACCENTS[categoryId] } as CSSProperties
  }
}

const CATEGORY_ACCENT_VAR: Readonly<Record<string, string>> = {
  mandatory: '--purple',
  fluids: '--cat-fluids-accent',
  solids: '--cat-solids-accent',
  systems: '--cat-systems-accent',
  advanced_labs: '--cat-labs-accent',
  other_specialization: '--cat-other-accent',
  [GATEWAY_CATEGORY_ID]: '--cat-gateway-accent',
}

/** The same accent as a CSS color, for dots and swatches; unknown categories stay neutral. */
export function categoryAccentColor(categoryId: string | null | undefined): string {
  if (categoryId && Object.hasOwn(TRACK_ACCENTS, categoryId)) return TRACK_ACCENTS[categoryId]
  const accent = categoryId ? CATEGORY_ACCENT_VAR[categoryId] : undefined
  return accent ? `var(${accent})` : 'var(--text-muted)'
}
