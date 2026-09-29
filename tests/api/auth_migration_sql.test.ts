/**
 * Static guard on the auth migration: the RLS/grant rules are the only thing
 * standing between the public publishable key and other students' data.
 */
import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(path.resolve(__dirname, '../../scripts/migrations/auth/001_profiles.sql'), 'utf8')
  .replace(/--.*$/gm, ''); // judge the statements, not the comments

test('profiles has RLS and owner-only policies', () => {
  expect(sql).toMatch(/ALTER TABLE public\.profiles ENABLE ROW LEVEL SECURITY/);
  expect(sql).toMatch(/FOR SELECT TO authenticated\s+USING \(id = \(SELECT auth\.uid\(\)\)\)/);
  expect(sql).toMatch(/FOR UPDATE TO authenticated\s+USING \(id = \(SELECT auth\.uid\(\)\)\)\s+WITH CHECK \(id = \(SELECT auth\.uid\(\)\)\)/);
});

test('clients can edit only the student fields — never role or email, never insert/delete', () => {
  expect(sql).toMatch(/REVOKE ALL ON public\.profiles FROM anon, authenticated/);
  const grants = sql.match(/GRANT [^;]+ON public\.profiles[^;]*;/g) ?? [];
  expect(grants).toEqual([
    'GRANT SELECT ON public.profiles TO authenticated;',
    'GRANT UPDATE (program_id, current_degree_year) ON public.profiles TO authenticated;',
  ]);
  expect(sql).not.toMatch(/GRANT[^;]*\brole\b[^;]*ON public\.profiles/);
  expect(sql).not.toMatch(/TO anon/);
});

test('every other public table is locked out of the Data API', () => {
  expect(sql).toMatch(/FROM pg_tables\s+WHERE schemaname = 'public'/);
  expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY', t\.tablename/);
});

test('no admin secret or service role is referenced', () => {
  expect(sql).not.toMatch(/service_role/i);
});
