import { PROGRAM_REGISTRY, getProgramEntry, livePrograms, parseRegistry, programSchema } from '../../shared/programs';
import { getInstitution } from '../../shared/institutions';

const IDS = [
  'mechanical_engineering_2027',
  'mechanical_engineering_2025',
  'mechanical_engineering_biomedical_track_2025',
];

test('registry parses and holds exactly the three live ME programs', () => {
  expect(PROGRAM_REGISTRY.map((p) => p.id).sort()).toEqual([...IDS].sort());
  expect(PROGRAM_REGISTRY.every((p) => p.status === 'live')).toBe(true);
  expect(livePrograms()).toHaveLength(3);
});

test('mechanical_engineering_2027 fields', () => {
  const p = getProgramEntry('mechanical_engineering_2027');
  expect(p).toMatchObject({ sourceYear: 2026, year: 2027, base: 'mechanical_engineering', isFamilyDefault: true, sourceIds: { tcid: '8715' }, capabilities: ['mechanical_design'] });
  expect(getProgramEntry('nope')).toBeNull();
});

test('every institution resolves and entries are strict', () => {
  for (const p of PROGRAM_REGISTRY) expect(getInstitution(p.institution)).not.toBeNull();
  expect(() => programSchema.parse({ ...PROGRAM_REGISTRY[0], extra: 1 })).toThrow();
});

describe('the registry validates itself', () => {
  const me = getProgramEntry('mechanical_engineering_2027')!;
  const entry = (over: Record<string, unknown>) => ({ ...me, base: 'bar', ...over });

  test('an id may carry an institution prefix', () => {
    expect(parseRegistry([entry({ id: 'foo:bar_2027', institution: 'foo', familyId: 'bar' })]).map((p) => p.id))
      .toEqual(['foo:bar_2027']);
  });

  test.each(['Bar_2027', 'foo:Bar_2027', 'foo:', ':bar_2027', 'a:b:c_2027', 'bar-2027'])('rejects id %s', (id) => {
    expect(() => parseRegistry([entry({ id, familyId: 'bar' })])).toThrow();
  });

  test.each([
    [{ id: 'baz_2027' }, /<base>_<year>/],
    [{ id: 'bar_2028' }, /<base>_<year>/],
    [{ id: 'bar_2028', year: 2028 }, /sourceYear/],
    [{ id: 'foo:bar_2027' }, /institution/],
  ])('id, base, year and sourceYear must agree: %o', (over, why) => {
    expect(() => parseRegistry([entry({ familyId: 'bar', ...over })])).toThrow(why);
  });

  test('a family needs exactly one default', () => {
    expect(() => parseRegistry([entry({ id: 'bar_2027', familyId: 'bar', isFamilyDefault: false })])).toThrow(/bar/);
    expect(() => parseRegistry([
      entry({ id: 'bar_2027', familyId: 'bar' }),
      entry({ id: 'bar_2028', familyId: 'bar', year: 2028, sourceYear: 2027 }),
    ])).toThrow(/bar/);
  });

  test('duplicate ids are rejected', () => {
    expect(() => parseRegistry([entry({ id: 'bar_2027', familyId: 'bar' }), entry({ id: 'bar_2027', familyId: 'baz' })]))
      .toThrow(/bar_2027/);
  });

  test('the committed registry passes the same validation', () => {
    expect(parseRegistry([...PROGRAM_REGISTRY])).toHaveLength(PROGRAM_REGISTRY.length);
  });
});
