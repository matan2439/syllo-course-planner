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
