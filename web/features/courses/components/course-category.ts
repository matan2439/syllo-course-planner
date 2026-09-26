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
