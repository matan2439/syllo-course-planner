/**
 * Adapter contract for mirroring the legacy planner's live #hdr-chips status
 * into the outer Next shell. `parseChipStatus` takes {label, value, warn}
 * tuples already read (and esc()-sanitized) from the legacy DOM by
 * LegacyPlannerFrame's same-origin MutationObserver, and maps only the four
 * labels the outer toolbar mirrors. Pure presentation mapping — it does not
 * compute or duplicate any planner arithmetic (placed/repo/missing-hours are
 * the legacy renderChips() output, verbatim).
 */
import { parseChipStatus } from '../../web/lib/chip-status';

test('maps the four mirrored labels from raw chip tuples', () => {
  const vm = parseChipStatus([
    { label: 'סה״כ', value: '42', warn: false },
    { label: 'מוצבים', value: '18', warn: false },
    { label: 'במאגר', value: '12', warn: false },
    { label: 'חסרות שעות', value: '3', warn: true },
  ]);
  expect(vm).toEqual({
    total: '42',
    placed: '18',
    repo: '12',
    missingHours: '3',
    missingHoursWarn: true,
  });
});

test('ignores chips outside the mirrored set (draft-placed, plan-status)', () => {
  const vm = parseChipStatus([
    { label: 'סה״כ', value: '42', warn: false },
    { label: 'מוצבים (טיוטה)', value: '20', warn: false },
    { label: 'תוכנית תקינה', value: '✓', warn: false },
  ]);
  expect(vm.total).toBe('42');
  expect(vm.placed).toBeNull();
  expect(vm.repo).toBeNull();
  expect(vm.missingHours).toBeNull();
});

test('an empty chip list (iframe not loaded yet) yields all-null, no throw', () => {
  const vm = parseChipStatus([]);
  expect(vm).toEqual({
    total: null,
    placed: null,
    repo: null,
    missingHours: null,
    missingHoursWarn: false,
  });
});

test('malformed entries (blank label/value) are skipped gracefully', () => {
  const vm = parseChipStatus([
    { label: '', value: '', warn: false },
    { label: '   ', value: '5', warn: false },
    { label: 'סה״כ', value: '', warn: false },
  ]);
  expect(vm.total).toBeNull();
  expect(vm.placed).toBeNull();
});

test('missingHoursWarn mirrors the legacy .chip.warn class exactly, not a recomputed threshold', () => {
  const vm = parseChipStatus([{ label: 'חסרות שעות', value: '0', warn: false }]);
  expect(vm).toMatchObject({ missingHours: '0', missingHoursWarn: false });
});
