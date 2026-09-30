## Paddle integration

When writing or modifying code that integrates with Paddle:

- Check current Paddle documentation via the `paddle-docs` MCP server before suggesting code. Do not rely on training data alone.
- This repo does NOT use a Paddle SDK, on purpose. Server side is `api/billing/paddle.ts` (config, direct REST calls, payload minimization); browser side is `web/features/billing/paddle-client.ts` (Paddle.js v2 from the CDN). Extend these; don't add `@paddle/paddle-node-sdk`.
- Webhooks: always verify with `verifyPaddleSignature` (rotation-safe, 300s tolerance) before touching the payload. Events are idempotent by `event_id`; credit grants also by ledger reference `paddle:<env>:<txn>`.
- The Syllo credits ledger is authoritative for entitlement; Paddle is the Merchant of Record. Refund/chargeback handling goes through the refund policy engine (`api/billing/refund_policy.ts`), never ad-hoc ledger writes.
- Environments: `PADDLE_ENV` is `sandbox` or `production`, and the API key prefix must match (`pdl_sdbx_` / `pdl_live_`). All development uses sandbox; client tokens for sandbox start with `test_`.
- MCP: use `paddle-sandbox` by default. Only call `paddle-live` when the prompt explicitly says live, production, or real customer data.
- Ask for explicit confirmation before any change to a Paddle account (creating/updating prices or products, archiving, refunds, cancellations).
- Secrets (`PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`) live in environment variables only, never in code or in `NEXT_PUBLIC_*` variables. Only `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` is public.
