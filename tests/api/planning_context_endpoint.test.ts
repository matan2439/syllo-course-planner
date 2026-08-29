import handler from '../../api/ai/planning-context';
import { getAcademicContextStore, resetApplyRuntime } from '../../api/ai/apply_runtime';
import { SESSION_COOKIE } from '../../api/ai/session_owner';

const OWNER = 'p'.repeat(43);
const PROGRAM = 'tau_mechanical_engineering_2027';

const makeRes = () => ({
  statusCode: 0, _body: undefined as any, _headers: {} as Record<string, unknown>, headersSent: false,
  setHeader(this: any, key: string, value: unknown) { this._headers[key] = value; return this; },
  getHeader(this: any, key: string) { return this._headers[key]; },
  status(this: any, code: number) { this.statusCode = code; return this; },
  json(this: any, body: unknown) { this._body = body; this.headersSent = true; return this; },
});

beforeEach(() => resetApplyRuntime());

test('stores server-digested user academic context without generating a proposal', async () => {
  const res: any = makeRes();
  const personalStatus = { completed_course_ids: ['0368-1101'] };
  await handler({
    method: 'POST',
    headers: { cookie: `${SESSION_COOKIE}=${OWNER}` },
    body: {
      program_id: PROGRAM,
      plan_context: { personal_status: personalStatus, semesters: [] },
      preferences: { disallowed_course_ids: [] },
    },
  } as any, res);

  expect(res.statusCode).toBe(200);
  expect(res._body).toEqual({ ok: true, academic_status_digest: expect.stringMatching(/^as_/u) });
  const stored = await getAcademicContextStore().load(OWNER, PROGRAM);
  expect(stored).toEqual(expect.objectContaining({
    ownerId: OWNER,
    programId: PROGRAM,
    digest: res._body.academic_status_digest,
    personalStatus,
  }));
});

test('does not accept an owner id, authoritative plan, or browser-selected digest', async () => {
  for (const extra of [
    { owner_id: OWNER },
    { authoritative_plan: { semesters: [] } },
    { academic_status_digest: 'browser_choice' },
  ]) {
    const res: any = makeRes();
    await handler({
      method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${OWNER}` },
      body: {
        program_id: PROGRAM,
        plan_context: { personal_status: {}, semesters: [] },
        preferences: {},
        ...extra,
      },
    } as any, res);
    expect(res.statusCode).toBe(400);
    expect(res._body.code).toBe('INVALID_REQUEST');
  }
});

test('loads the same session academic context after refresh without exposing another owner', async () => {
  const personalStatus = {
    completed: [{ course_id: '0509-1510' }, { course_id: 'ELEC-1' }],
    currently_taking: [],
    completed_knowledge: { status: 'known', provenance: 'explicit_user' },
  };
  const writeRes: any = makeRes();
  await handler({
    method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${OWNER}` },
    body: {
      program_id: PROGRAM,
      plan_context: { personal_status: personalStatus, semesters: [] },
      preferences: { disallowed_course_ids: [] },
    },
  } as any, writeRes);

  const readRes: any = makeRes();
  await handler({
    method: 'GET', headers: { cookie: `${SESSION_COOKIE}=${OWNER}` },
    query: { program_id: PROGRAM },
  } as any, readRes);

  expect(readRes.statusCode).toBe(200);
  expect(readRes._body).toEqual({
    ok: true,
    context: {
      academic_status_digest: writeRes._body.academic_status_digest,
      personal_status: personalStatus,
      preferences: { disallowed_course_ids: [] },
    },
  });

  const otherRes: any = makeRes();
  await handler({
    method: 'GET', headers: { cookie: `${SESSION_COOKIE}=${'q'.repeat(43)}` },
    query: { program_id: PROGRAM },
  } as any, otherRes);
  expect(otherRes.statusCode).toBe(200);
  expect(otherRes._body).toEqual({ ok: true, context: null });
});
