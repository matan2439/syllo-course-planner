import { createBillingHandler } from '../../api/billing';
import type { PaddleConfig } from '../../api/billing/paddle';

const config: PaddleConfig = {
  environment: 'production', apiKey: 'pdl_live_fixture', webhookSecret: 'fixture', apiBase: 'http://paddle.invalid',
};

function response() {
  const res: any = { statusCode: 200, body: undefined, headersSent: false };
  res.setHeader = () => {};
  res.status = (status: number) => { res.statusCode = status; return res; };
  res.json = (body: unknown) => { res.body = body; res.headersSent = true; return res; };
  return res;
}

test('Production sales stay closed without an explicit launch setting', async () => {
  const dbCall = jest.fn();
  const apiCall = jest.fn();
  const handler = createBillingHandler({
    env: { VERCEL_ENV: 'production', PADDLE_ENV: 'production' },
    config: () => config,
    sql: () => ({ unsafe: dbCall }) as any,
    verifyUser: async () => 'fixture-user',
    api: apiCall,
  });
  const packages = response();
  await handler({ method: 'GET', url: '/api/billing/packages', query: { route: 'packages' }, headers: {} } as any, packages);
  expect(packages.body.packages).toEqual([]);

  const checkout = response();
  await handler({ method: 'POST', url: '/api/billing/checkout', query: { route: 'checkout' },
    headers: { 'content-type': 'application/json' }, body: { package_id: 'credits_small', accepted: true } } as any, checkout);
  expect(checkout.statusCode).toBe(503);
  expect(checkout.body.code).toBe('BILLING_LAUNCH_PENDING');
  expect(dbCall).not.toHaveBeenCalled();
  expect(apiCall).not.toHaveBeenCalled();
});

