/**
 * Visual category accents deliberately mirror the program category ids from
 * the board contract. Unknown categories remain visually neutral rather than
 * being guessed from a course name.
 */
/** The program's general-studies (שער רוח) requirement category, as the board contract names it. */
export const GATEWAY_CATEGORY_ID = 'shaar_ruach'

const CATEGORY_ACCENT_CLASS: Readonly<Record<string, string>> = {
  fluids: 'card-cat-fluids',
  solids: 'card-cat-solids',
  systems: 'card-cat-systems',
  advanced_labs: 'card-cat-labs',
  other_specialization: 'card-cat-other_specialization',
  [GATEWAY_CATEGORY_ID]: 'card-cat-shaar_ruach',
}

export function categoryAccentClass(categoryId: string | null | undefined): string {
  return categoryId ? CATEGORY_ACCENT_CLASS[categoryId] ?? '' : ''
}

const CATEGORY_ACCENT_VAR: Readonly<Record<string, string>> = {
  fluids: '--cat-fluids-accent',
  solids: '--cat-solids-accent',
  systems: '--cat-systems-accent',
  advanced_labs: '--cat-labs-accent',
  other_specialization: '--cat-other-accent',
  [GATEWAY_CATEGORY_ID]: '--cat-gateway-accent',
}

/** The same accent as a CSS color, for dots and swatches; unknown categories stay neutral. */
export function categoryAccentColor(categoryId: string | null | undefined): string {
  const accent = categoryId ? CATEGORY_ACCENT_VAR[categoryId] : undefined
  return accent ? `var(${accent})` : 'var(--text-muted)'
}
