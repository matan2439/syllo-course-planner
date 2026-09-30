import { databaseUrl, isolatedUrl } from '../../api/db_env';
import { supabaseAuthConfig } from '../../api/ai/auth_session';

const PROD_POOLER = 'postgresql://postgres.lxwtycowmqosuyfumcbo:pw@aws-0-eu-north-1.pooler.supabase.com:6543/postgres';
const PREVIEW_POOLER = 'postgresql://postgres.previewref0000000000:pw@aws-0-eu-north-1.pooler.supabase.com:6543/postgres';
const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

describe('database isolation guard', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it('production uses the production database only', () => {
    expect(databaseUrl(env({ VERCEL_ENV: 'production', DATABASE_URL: PROD_POOLER }))).toBe(PROD_POOLER);
    expect(databaseUrl(env({ VERCEL_ENV: 'production', DATABASE_URL: PREVIEW_POOLER }))).toBe('');
  });

  it('preview and local never reach the production database', () => {
    expect(databaseUrl(env({ VERCEL_ENV: 'preview', DATABASE_URL: PROD_POOLER }))).toBe('');
    expect(databaseUrl(env({ DATABASE_URL: `  ${PROD_POOLER}  ` }))).toBe('');
    expect(databaseUrl(env({ VERCEL_ENV: 'preview', DATABASE_URL: PREVIEW_POOLER }))).toBe(PREVIEW_POOLER);
  });

  it('a missing variable stays missing (no fallback)', () => {
    expect(databaseUrl(env({ VERCEL_ENV: 'preview' }))).toBe('');
    expect(isolatedUrl(undefined, 'X', env({ VERCEL_ENV: 'production' }))).toBe('');
  });

  it('auth is off when Preview points at the production Supabase project', () => {
    const anon = { NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k' };
    expect(supabaseAuthConfig(env({ ...anon, VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: 'https://lxwtycowmqosuyfumcbo.supabase.co' }))).toBeNull();
    expect(supabaseAuthConfig(env({ ...anon, VERCEL_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'https://previewref.supabase.co' }))).toBeNull();
    expect(supabaseAuthConfig(env({ ...anon, VERCEL_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'https://lxwtycowmqosuyfumcbo.supabase.co' }))).not.toBeNull();
  });
});
