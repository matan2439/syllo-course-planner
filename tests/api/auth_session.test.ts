/**
 * Supabase-authenticated ownership: verification, account-scoped records,
 * cookie-spoof resistance, and one-time adoption of an anonymous browser's state.
 */
jest.mock('@supabase/ssr', () => {
  const actual = jest.requireActual('@supabase/ssr');
  return {
    ...actual,
    // The "Auth server": a cookie `sb-test-auth-token=<value>` verifies to a user
    // only when <value> is a known token. `refresh:<token>` also rotates cookies.
    createServerClient: jest.fn((_url: string, _key: string, opts: any) => ({
      auth: {
        getClaims: async () => {
          const cookie = opts.cookies.getAll().find((c: any) => c.name === 'sb-test-auth-token')?.value ?? '';
          const [kind, token] = cookie.startsWith('refresh:') ? ['refresh', cookie.slice(8)] : ['plain', cookie];
          const sub = mockTokens[token];
          if (!sub) return { data: null, error: new Error('invalid JWT') };
          if (kind === 'refresh') {
            await opts.cookies.setAll(
              [{ name: 'sb-test-auth-token', value: token, options: { path: '/' } }],
              { 'Cache-Control': 'private, no-store' },
            );
          }
          return { data: { claims: { sub } }, error: null };
        },
      },
    })),
  };
});

import planningContext from '../../api/ai/planning-context';
import { getAcademicContextStore, resetApplyRuntime } from '../../api/ai/apply_runtime';
import { accountOwnerId, resolveRequestOwner, verifiedUserId } from '../../api/ai/auth_session';
import { SESSION_COOKIE, isWellFormedOwnerId, resolveOwner } from '../../api/ai/session_owner';
import { ownerStorageKey } from '../../api/ai/owner_key';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const mockTokens: Record<string, string> = { 'token-a': USER_A, 'token-b': USER_B };
const PROGRAM = 'tau_mechanical_engineering_2027';
const ANON = 'q'.repeat(43);
const CONFIG = { url: 'https://example.supabase.co', anonKey: 'publishable' };

const makeRes = () => ({
  statusCode: 0, _body: undefined as any, _headers: {} as Record<string, unknown>, headersSent: false,
  setHeader(this: any, key: string, value: unknown) { this._headers[key] = value; return this; },
  getHeader(this: any, key: string) { return this._headers[key]; },
  status(this: any, code: number) { this.statusCode = code; return this; },
  json(this: any, body: unknown) { this._body = body; this.headersSent = true; return this; },
});
const cookies = (res: any): string[] => [].concat(res._headers['Set-Cookie'] ?? []);

beforeEach(() => {
  resetApplyRuntime();
  process.env.NEXT_PUBLIC_SUPABASE_URL = CONFIG.url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = CONFIG.anonKey;
});
afterAll(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

describe('verifiedUserId', () => {
  test('a valid session cookie yields the verified user id', async () => {
    const req = { headers: { cookie: 'sb-test-auth-token=token-a' } };
    await expect(verifiedUserId(req, makeRes(), CONFIG)).resolves.toBe(USER_A);
  });

  test('signed out, forged token, or auth not configured → null', async () => {
    await expect(verifiedUserId({ headers: {} }, makeRes(), CONFIG)).resolves.toBeNull();
    await expect(verifiedUserId({ headers: { cookie: 'sb-test-auth-token=forged' } }, makeRes(), CONFIG)).resolves.toBeNull();
    await expect(verifiedUserId({ headers: { cookie: 'sb-test-auth-token=token-a' } }, makeRes(), null)).resolves.toBeNull();
  });

  test('session restoration: a refreshed token rotates the auth cookie on the response', async () => {
    const res: any = makeRes();
    await expect(verifiedUserId({ headers: { cookie: 'sb-test-auth-token=refresh:token-a' } }, res, CONFIG)).resolves.toBe(USER_A);
    expect(cookies(res).some((c) => c.startsWith('sb-test-auth-token=token-a'))).toBe(true);
    expect(res._headers['Cache-Control']).toBe('private, no-store');
  });
});

describe('resolveRequestOwner', () => {
  test('signed out keeps the anonymous cookie flow unchanged', async () => {
    const res: any = makeRes();
    const owner = await resolveRequestOwner({ headers: { cookie: `${SESSION_COOKIE}=${ANON}` } }, res);
    expect(owner).toEqual({ ownerId: ANON, issued: false });
    expect(res._headers['Set-Cookie']).toBeUndefined();
  });

  test('signed in → the account owns the records; users never share a storage key', async () => {
    const a = await resolveRequestOwner({ headers: { cookie: 'sb-test-auth-token=token-a' } }, makeRes());
    const b = await resolveRequestOwner({ headers: { cookie: 'sb-test-auth-token=token-b' } }, makeRes());
    expect(a.ownerId).toBe(accountOwnerId(USER_A));
    expect(ownerStorageKey(a.ownerId)).not.toBe(ownerStorageKey(b.ownerId));
  });

  test('an anonymous cookie can never impersonate an account owner id', async () => {
    const spoof = accountOwnerId(USER_A);
    expect(isWellFormedOwnerId(spoof)).toBe(false);
    const owner = resolveOwner({ headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(spoof)}` } }, makeRes());
    expect(owner.ownerId).not.toBe(spoof);
    expect(owner.issued).toBe(true);
  });

  test('first signed-in request adopts this browser, then expires the anonymous cookie', async () => {
    const adopt = jest.fn().mockResolvedValue(true);
    const res: any = makeRes();
    const owner = await resolveRequestOwner(
      { headers: { cookie: `${SESSION_COOKIE}=${ANON}; sb-test-auth-token=token-a` } }, res, { adopt },
    );
    expect(adopt).toHaveBeenCalledWith(ANON, accountOwnerId(USER_A));
    expect(owner.ownerId).toBe(accountOwnerId(USER_A));
    expect(cookies(res)).toContain(`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  });

  test('a failed adoption keeps the cookie so it is retried, and still resolves the account', async () => {
    const res: any = makeRes();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const owner = await resolveRequestOwner(
      { headers: { cookie: `${SESSION_COOKIE}=${ANON}; sb-test-auth-token=token-a` } }, res,
      { adopt: jest.fn().mockRejectedValue(new Error('db down')) },
    );
    expect(owner.ownerId).toBe(accountOwnerId(USER_A));
    expect(res._headers['Set-Cookie']).toBeUndefined();
  });
});

describe('planning-context endpoint with accounts', () => {
  const put = (cookie: string, completed: string[]) => planningContext({
    method: 'POST', headers: { cookie },
    body: {
      program_id: PROGRAM,
      plan_context: { personal_status: { completed: completed.map((course_id) => ({ course_id })) }, semesters: [] },
      preferences: { max_weekly_hours: 18, disallowed_course_ids: ['0509-2000'] },
    },
  } as any, makeRes() as any);
  const get = async (cookie: string) => {
    const res: any = makeRes();
    await planningContext({ method: 'GET', headers: { cookie }, query: { program_id: PROGRAM } } as any, res);
    return res._body.context;
  };

  test('an account reads its own profile state from any device; another user reads nothing', async () => {
    await put('sb-test-auth-token=token-a', ['0368-1101']);
    // A different browser (no anonymous cookie) signed in as the same user.
    const sameUser = await get('sb-test-auth-token=token-a');
    expect(sameUser.preferences).toEqual({ max_weekly_hours: 18, disallowed_course_ids: ['0509-2000'] });
    expect(await get('sb-test-auth-token=token-b')).toBeNull();
    expect(await get('')).toBeNull();
    // The anonymous owner namespace never sees account records.
    expect(await getAcademicContextStore().load(USER_A, PROGRAM)).toBeNull();
  });
});
