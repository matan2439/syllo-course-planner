import { createBillingHandler } from '../../api/billing';
import type { PaddleConfig } from '../../api/billing/paddle';
import { legalReadyForLiveSales } from '../../api/billing/launch_gate';

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

test('Production sales stay closed with the switch on while legal artifacts are drafts', async () => {
  const dbCall = jest.fn();
  const apiCall = jest.fn();
  const handler = createBillingHandler({
    env: { VERCEL_ENV: 'production', PADDLE_ENV: 'production', BILLING_LAUNCH_ENABLED: 'true' },
    config: () => config,
    sql: () => ({ unsafe: dbCall }) as any,
    verifyUser: async () => 'fixture-user',
    api: apiCall,
  });
  expect(legalReadyForLiveSales()).toBe(false);
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

test('Live legal readiness requires approved policy and four reviewed version IDs', () => {
  const versions = { supplierTerms: 'supplier-v1', refundPolicy: 'refund-v1', privacyPolicy: 'privacy-v1', purchaseDisclosure: 'purchase-v1' };
  expect(legalReadyForLiveSales({ status: 'approved', version: 'policy-v1' }, versions)).toBe(true);
  expect(legalReadyForLiveSales({ status: 'unreviewed', version: 'policy-v1' }, versions)).toBe(false);
  expect(legalReadyForLiveSales({ status: 'approved', version: 'legal-none' }, versions)).toBe(false);
  expect(legalReadyForLiveSales({ status: 'approved', version: 'policy-v1' }, { ...versions, refundPolicy: 'refund-DRAFT-v1' })).toBe(false);
});

