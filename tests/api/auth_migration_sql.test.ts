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

test('self-serve deletion only ever deletes the caller, and only signed-in users may call it', () => {
  const del = fs.readFileSync(path.resolve(__dirname, '../../scripts/migrations/auth/002_delete_account.sql'), 'utf8')
    .replace(/--.*$/gm, '');
  expect(del).toMatch(/FUNCTION public\.delete_my_account\(\)\s/); // no argument: cannot target someone else
  expect(del).toMatch(/uid uuid := auth\.uid\(\)/);
  expect(del).toMatch(/DELETE FROM auth\.users WHERE id = uid;/);
  expect(del).toMatch(/REVOKE EXECUTE ON FUNCTION public\.delete_my_account\(\) FROM PUBLIC, anon;/);
  expect(del).toMatch(/GRANT EXECUTE ON FUNCTION public\.delete_my_account\(\) TO authenticated;/);
});
