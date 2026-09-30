/** Pure pieces of billing: webhook signatures, config guards, catalog, the RefundPolicyEngine. */
import { paddleConfig, signPaddleBody, verifyPaddleSignature, minimizeEntity } from '../../api/billing/paddle';
import { packageById, packageByPriceId } from '../../api/billing/catalog';
import {
  POLICY_VERSION, decideAdjustment, recommendRefundRequest, type AdjustmentFacts,
} from '../../api/billing/refund_policy';

describe('Paddle-Signature', () => {
  const body = '{"event_id":"evt_1"}';
  const now = 1_800_000_000_000;
  const ts = now / 1000;

  test('valid, tampered, wrong secret, stale, malformed', () => {
    expect(verifyPaddleSignature(body, signPaddleBody(body, 's3cret', ts), 's3cret', now)).toBe(true);
    expect(verifyPaddleSignature(body + ' ', signPaddleBody(body, 's3cret', ts), 's3cret', now)).toBe(false);
    expect(verifyPaddleSignature(body, signPaddleBody(body, 'other', ts), 's3cret', now)).toBe(false);
    expect(verifyPaddleSignature(body, signPaddleBody(body, 's3cret', ts - 3600), 's3cret', now)).toBe(false);
    expect(verifyPaddleSignature(body, undefined, 's3cret', now)).toBe(false);
    expect(verifyPaddleSignature(body, 'ts=abc;h1=00', 's3cret', now)).toBe(false);
    expect(verifyPaddleSignature(body, signPaddleBody(body, 's3cret', ts), '', now)).toBe(false);
  });

  test('secret rotation: any of several h1 values may match', () => {
    const good = signPaddleBody(body, 'new', ts).split(';')[1];
    const old = signPaddleBody(body, 'old', ts).split(';')[1];
    expect(verifyPaddleSignature(body, `ts=${ts};${old};${good}`, 'new', now)).toBe(true);
  });
});

describe('environment separation', () => {
  test('the API key must belong to PADDLE_ENV', () => {
    const base = { PADDLE_WEBHOOK_SECRET: 'x' };
    expect(paddleConfig({ ...base, PADDLE_ENV: 'sandbox', PADDLE_API_KEY: 'pdl_sdbx_apikey_1' }).apiBase).toBe('https://sandbox-api.paddle.com');
    expect(paddleConfig({ ...base, VERCEL_ENV: 'production', PADDLE_ENV: 'production', PADDLE_API_KEY: 'pdl_live_apikey_1' }).apiBase).toBe('https://api.paddle.com');
    expect(() => paddleConfig({ ...base, VERCEL_ENV: 'production', PADDLE_ENV: 'production', PADDLE_API_KEY: 'pdl_sdbx_apikey_1' })).toThrow(/not a production key/);
    expect(() => paddleConfig({ ...base, PADDLE_ENV: 'sandbox', PADDLE_API_KEY: 'pdl_live_apikey_1' })).toThrow(/not a sandbox key/);
    expect(() => paddleConfig({ ...base, PADDLE_API_KEY: 'pdl_sdbx_apikey_1' })).toThrow(/PADDLE_ENV/);
  });

  test('mixed sandbox/production configuration fails closed', () => {
    const base = { PADDLE_WEBHOOK_SECRET: 'whsec' } as NodeJS.ProcessEnv;
    const sandbox = { ...base, PADDLE_ENV: 'sandbox', PADDLE_API_KEY: 'pdl_sdbx_apikey_1' } as NodeJS.ProcessEnv;
    const live = { ...base, PADDLE_ENV: 'production', PADDLE_API_KEY: 'pdl_live_apikey_1' } as NodeJS.ProcessEnv;
    // Sandbox on a production deployment would grant real credits for fake payments.
    expect(() => paddleConfig({ ...sandbox, VERCEL_ENV: 'production' })).toThrow(/not allowed on VERCEL_ENV=production/);
    // Live billing only on the production deployment.
    expect(() => paddleConfig({ ...live, VERCEL_ENV: 'preview' })).toThrow(/not allowed on VERCEL_ENV=preview/);
    expect(() => paddleConfig(live)).toThrow(/VERCEL_ENV=unset/);
    expect(paddleConfig({ ...sandbox, VERCEL_ENV: 'preview' }).environment).toBe('sandbox');
    // Client-side config must agree with the server.
    expect(() => paddleConfig({ ...sandbox, NEXT_PUBLIC_PADDLE_ENV: 'production' })).toThrow(/NEXT_PUBLIC_PADDLE_ENV/);
    expect(() => paddleConfig({ ...sandbox, NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: 'live_abc' })).toThrow(/not a sandbox token/);
    expect(() => paddleConfig({ ...live, VERCEL_ENV: 'production', NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: 'test_abc' })).toThrow(/not a production token/);
    expect(paddleConfig({ ...live, VERCEL_ENV: 'production', NEXT_PUBLIC_PADDLE_ENV: 'production', NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: 'live_abc' }).environment).toBe('production');
  });

  test('catalog: price id → package → credits, only for this deployment\'s prices', () => {
    const env = { PADDLE_PRICE_CREDITS_SMALL: 'pri_sandboxsmall0001' } as NodeJS.ProcessEnv;
    expect(packageByPriceId('pri_sandboxsmall0001', env)).toMatchObject({ id: 'credits_small', credits: 50 });
    expect(packageByPriceId('pri_liveprice00001', env)).toBeNull();
    expect(packageById('credits_medium', env)).toBeNull(); // no price configured → not purchasable
    expect(packageById('credits_small', { PADDLE_PRICE_CREDITS_SMALL: 'not-a-price' } as NodeJS.ProcessEnv)).toBeNull();
  });

  test('stored payloads drop payment-method and address data', () => {
    const min = minimizeEntity('transaction.completed', {
      id: 'txn_1', status: 'completed', address: { postal_code: '123' },
      payments: [{ method_details: { card: { last4: '4242', cardholder_name: 'A B' } } }],
      items: [{ price: { id: 'pri_1', name: 'x' }, quantity: 1 }], details: { totals: { grand_total: '1' } },
    });
    expect(JSON.stringify(min)).not.toMatch(/4242|cardholder|postal/);
    expect(min).toMatchObject({ id: 'txn_1', items: [{ price_id: 'pri_1', quantity: 1 }] });
  });
});

describe('RefundPolicyEngine', () => {
  const facts = (over: {
    adjustment?: Partial<AdjustmentFacts['adjustment']>; lot?: Partial<AdjustmentFacts['lot']>;
    payment?: Partial<AdjustmentFacts['payment']>; refundRevokedBefore?: number; risk?: Partial<AdjustmentFacts['risk']>;
  } = {}): AdjustmentFacts => {
    const lot = { granted: 500, consumed: 0, reserved: 0, revoked: 0, ...over.lot };
    return {
      adjustment: { id: 'adj_1', action: 'refund', type: 'full', status: 'approved', amount: 5000, currency: 'ILS', ...over.adjustment },
      payment: { id: '1', amountTotal: 5000, currency: 'ILS', refundedBefore: 0, disputeState: 'none', ...over.payment },
      lot: { ...lot, unused: lot.granted - lot.consumed - lot.reserved - lot.revoked },
      refundRevokedBefore: over.refundRevokedBefore ?? 0,
      risk: { refundAfterConsumptionCount: 0, chargebackCount: 0, ...over.risk },
    };
  };
  const types = (o: ReturnType<typeof decideAdjustment>) => o.actions.map((a) => a.type);

  test('versioned and deterministic', () => {
    expect(decideAdjustment(facts())).toEqual(decideAdjustment(facts()));
    expect(decideAdjustment(facts()).policyVersion).toBe(POLICY_VERSION);
  });

  test('refund requested / rejected: record only, nothing revoked, nobody flagged', () => {
    for (const status of ['pending_approval', 'rejected']) {
      const o = decideAdjustment(facts({ adjustment: { status } }));
      expect(o.decision).toBe('RECORD_ONLY');
      expect(o.actions).toEqual([]);
    }
  });

  test('unused package, full refund: revoke all, close the lot, no flags', () => {
    const o = decideAdjustment(facts());
    expect(o.decision).toBe('FULL_REFUND_ACCOUNTING');
    expect(o.actions).toEqual([{ type: 'REVOKE_UNUSED_ENTITLEMENT', kind: 'refund', credits: null, close: true }]);
  });

  test('500 purchased / 120 consumed, full refund: revoke unused, record consumption, review the payment only', () => {
    const o = decideAdjustment(facts({ lot: { consumed: 120 } }));
    expect(types(o)).toEqual(['REVOKE_UNUSED_ENTITLEMENT', 'RECORD_CONSUMED_SERVICE', 'MARK_CONSUMED_BEFORE_REFUND', 'RAISE_ALERT']);
    expect(types(o)).not.toContain('FLAG_ACCOUNT_REVIEW');
    expect(o.analysis).toEqual({ label: 'analysis_only', consumption_ratio: 0.24, unused_ratio: 0.76, candidate_consumed_value: 1200, candidate_unused_value: 3800 });
  });

  test('partial refund of exactly the unused value: proportional revocation, nothing flagged', () => {
    const o = decideAdjustment(facts({ lot: { consumed: 120 }, adjustment: { type: 'partial', amount: 3800 } }));
    expect(o.decision).toBe('PARTIAL_REFUND_ACCOUNTING');
    expect(o.actions).toEqual([{ type: 'REVOKE_UNUSED_ENTITLEMENT', kind: 'refund', credits: 380, close: false }]);
  });

  test('partial refunds are cumulative and round up in the buyer\'s favour of revocation', () => {
    const o = decideAdjustment(facts({ adjustment: { type: 'partial', amount: 1001 }, payment: { refundedBefore: 1000 }, refundRevokedBefore: 100 }));
    expect(o.actions).toEqual([{ type: 'REVOKE_UNUSED_ENTITLEMENT', kind: 'refund', credits: 101, close: false }]); // ceil(500·2001/5000)=201 − 100
  });

  test('second refund-after-consumption flags the account for review (never restriction)', () => {
    const o = decideAdjustment(facts({ lot: { consumed: 400 }, risk: { refundAfterConsumptionCount: 1 } }));
    expect(types(o)).toContain('FLAG_ACCOUNT_REVIEW');
    expect(JSON.stringify(o)).not.toMatch(/restrict/i);
  });

  test('chargeback: dispute processing with revocation, critical alert, account review', () => {
    const o = decideAdjustment(facts({ adjustment: { action: 'chargeback' }, lot: { consumed: 10 } }));
    expect(o.decision).toBe('DISPUTE_PROCESSING');
    expect(types(o)).toEqual(['REVOKE_UNUSED_ENTITLEMENT', 'SET_DISPUTE_STATE', 'RAISE_ALERT', 'FLAG_ACCOUNT_REVIEW', 'RECORD_CONSUMED_SERVICE']);
  });

  test('never guesses: unsupported or inconsistent facts go to manual review', () => {
    const cases = [
      facts({ adjustment: { action: 'chargeback_reverse' } }),
      facts({ adjustment: { action: 'credit' } }),
      facts({ adjustment: { action: 'something_new' } }),
      facts({ adjustment: { status: 'reversed' } }),
      facts({ adjustment: { currency: 'USD' } }),
      facts({ adjustment: { type: 'partial', amount: 3000 }, payment: { refundedBefore: 3000 } }),
      facts({ adjustment: { amount: null } }),
    ];
    for (const f of cases) expect(decideAdjustment(f).decision).toBe('MANUAL_REVIEW_REQUIRED');
  });

  test('refund REQUESTS are never sized automatically until a legal policy is approved', () => {
    const r = recommendRefundRequest({
      jurisdiction: 'IL', purchasedAt: '2026-09-01T00:00:00Z', requestedAt: '2026-09-02T00:00:00Z',
      lot: { granted: 500, consumed: 120, reserved: 0, revoked: 0, unused: 380 }, amountTotal: 5000,
      paymentStatus: 'completed', disputeState: 'none', risk: { refundAfterConsumptionCount: 0, chargebackCount: 0 },
    });
    expect(r.recommendation).toBe('MANUAL_REVIEW');
    expect(r.analysis).toMatchObject({ candidate_consumed_value: 1200, candidate_unused_value: 3800 });
  });
});
