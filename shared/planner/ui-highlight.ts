/**
 * Elements the co-pilot can point at. An element opts in with `data-highlight-id="<target>"`;
 * nothing here is per-screen. Course targets are `course:<id>` (board card) and
 * `catalog-course:<id>` (catalog row); the rest are the named targets below.
 */
export const UI_HIGHLIGHT_TARGETS = [
  'button:planning-tools',
  'view:board', 'view:schedule', 'view:bidding',
  'panel:courses', 'panel:assistant',
  'saved-plans', 'years-view', 'progress', 'proposal',
  'filter:category', 'filter:semester', 'filter:assessment', 'filter:grade', 'filter:favorites',
] as const;
export type UiHighlightTarget = (typeof UI_HIGHLIGHT_TARGETS)[number];

/** Shape only; the agent tool checks the id against the catalog and the list above. */
export const HIGHLIGHT_TARGET_PATTERN = /^[a-z][a-z-]*(?::[\w-]+)?$/;

/** Fired on `window` before an element is highlighted, so its owner can bring it on screen (open a tab or panel). */
export const HIGHLIGHT_EVENT = 'syllo:highlight';
