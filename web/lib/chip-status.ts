/**
 * View model for mirroring the legacy planner's live #hdr-chips status into
 * the outer Next shell. `parseChipStatus` takes {label, value, warn} tuples
 * already read (and esc()-sanitized) from the legacy DOM by
 * LegacyPlannerFrame's same-origin MutationObserver, and picks out only the
 * four labels the outer toolbar mirrors. Pure presentation mapping — it does
 * not compute or duplicate any planner arithmetic; placed/repo/missing-hours
 * are the legacy renderChips() output, verbatim.
 */

export type RawChip = { label: string; value: string; warn: boolean }

export type ChipStatusVM = {
  total: string | null
  placed: string | null
  repo: string | null
  missingHours: string | null
  missingHoursWarn: boolean
}

const LABEL_KEYS: Record<string, keyof Omit<ChipStatusVM, 'missingHoursWarn'>> = {
  'סה״כ': 'total',
  'מוצבים': 'placed',
  'במאגר': 'repo',
  'חסרות שעות': 'missingHours',
}

export function parseChipStatus(rawChips: RawChip[]): ChipStatusVM {
  const vm: ChipStatusVM = {
    total: null,
    placed: null,
    repo: null,
    missingHours: null,
    missingHoursWarn: false,
  }
  for (const chip of rawChips) {
    const key = LABEL_KEYS[chip.label?.trim()]
    const value = chip.value?.trim()
    if (!key || !value) continue
    vm[key] = value
    if (key === 'missingHours') vm.missingHoursWarn = chip.warn
  }
  return vm
}
