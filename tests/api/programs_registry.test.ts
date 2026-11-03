import { PROGRAM_REGISTRY, getProgramEntry, livePrograms, programSchema } from '../../shared/programs';
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
