import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** No paid-AI path may reach production without metering (api/ai/metering.ts). */
describe('Vercel AI routes: only metered endpoints are deployed', () => {
  const config = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
    builds: Array<{ src: string }>;
    rewrites: Array<{ source: string; destination: string }>;
    headers: Array<Record<string, unknown>>;
    crons: Array<{ path: string; schedule: string }>;
  };

  test('the legacy generate-plan / planner-run endpoints have no production route', () => {
    for (const legacy of ['generate-plan', 'planner-run']) {
      expect(config.builds.map((b) => b.src)).not.toContain(`api/ai/${legacy}.ts`);
      expect(config.rewrites.some((r) => r.source.includes(legacy) || r.destination.includes(legacy))).toBe(false);
    }
  });

  test('every deployed AI handler that calls a model is metered', () => {
    const modelCallers = ['api/ai/conversation.ts', 'api/ai/course-planner.ts'];
    for (const src of modelCallers) {
      expect(config.builds.map((b) => b.src)).toContain(src);
      expect(readFileSync(join(process.cwd(), src), 'utf8')).toMatch(/openMeteredOperation/);
    }
  });

  test('the reconciliation cron is top-level config, not nested in a header rule', () => {
    expect(config.crons).toEqual([{ path: '/api/billing/reconcile', schedule: expect.any(String) }]);
    expect(config.headers.every((h) => !('crons' in h))).toBe(true);
  });
});
