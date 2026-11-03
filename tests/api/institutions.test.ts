import { INSTITUTIONS, getInstitution, institutionForProgram } from '../../shared/institutions';
import { programProviderFor, TauProgramProvider } from '../../api/ai/program_provider';

test('TAU is the one active institution and carries its rules as config', () => {
  expect(INSTITUTIONS.filter((i) => i.active).map((i) => i.id)).toEqual(['tau']);
  expect(getInstitution('tau')?.generalRequirement).toMatchObject({ categoryId: 'shaar_ruach', creditsPerCourse: 2, countsTowardTotal: true });
});

test('existing unprefixed program ids keep resolving to TAU; a prefix selects an institution', () => {
  expect(institutionForProgram('mechanical_engineering_2027')?.id).toBe('tau');
  expect(institutionForProgram('tau:mechanical_engineering_2027')?.id).toBe('tau');
  expect(institutionForProgram('unknown_college:cs_2027')).toBeNull();
  expect(programProviderFor('mechanical_engineering_2027')).toBeInstanceOf(TauProgramProvider);
});
