/**
 * Program registry for the Next picker — mirrors the canonical PROGRAM_LIST /
 * PROGRAM_FAMILIES embedded in app/web/semester_board_viewer.html (the static
 * planner's program modal). Pure data + resolution helpers; no planner logic.
 * The drift test keeps the mirror honest against the canonical file.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_PROGRAM_ID,
  getProgram,
  listProgramFamilies,
  programQuery,
} from '../../web/lib/programs';

test('families expose shipped Hebrew names, tracks and default versions', () => {
  const families = listProgramFamilies();
  expect(families.length).toBeGreaterThanOrEqual(2);

  const mech = families.find((f) => f.id === 'mechanical_engineering')!;
  expect(mech.name).toBe('הנדסה מכנית');
  expect(mech.track).toBeNull();
  expect(mech.defaultProgram.id).toBe('mechanical_engineering_2027');
  expect(mech.archivePrograms.map((p) => p.id)).toEqual([
    'mechanical_engineering_2025',
  ]);

  const bio = families.find((f) => f.id === 'mechanical_engineering_biomedical')!;
  expect(bio.track).toBe('מגמה בהנדסה ביו-רפואית');
});

test('getProgram resolves the default for missing or unknown ids', () => {
  expect(getProgram(undefined).id).toBe(DEFAULT_PROGRAM_ID);
  expect(getProgram('no_such_program').id).toBe(DEFAULT_PROGRAM_ID);
  expect(getProgram('mechanical_engineering_2025').id).toBe(
    'mechanical_engineering_2025'
  );
});

test('programs carry the shipped board JSON filename', () => {
  expect(getProgram('mechanical_engineering_2027').boardJsonFile).toBe(
    'mechanical_semester_board_2027.json'
  );
  expect(getProgram('mechanical_engineering_2025').boardJsonFile).toBe(
    'mechanical_semester_board.json'
  );
});

test('programQuery is empty for the default and a query string otherwise', () => {
  expect(programQuery(DEFAULT_PROGRAM_ID)).toBe('');
  expect(programQuery(undefined)).toBe('');
  expect(programQuery('mechanical_engineering_2025')).toBe(
    '?program=mechanical_engineering_2025'
  );
});

test('every mirrored program id exists in the canonical HTML registry (drift guard)', () => {
  const html = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html'),
    'utf8'
  );
  for (const family of listProgramFamilies()) {
    for (const p of [family.defaultProgram, ...family.archivePrograms]) {
      expect(html).toContain(`'${p.id}'`);
    }
  }
});
