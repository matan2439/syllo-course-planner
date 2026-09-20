import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Vercel planning-context deployment contract', () => {
  const config = JSON.parse(
    readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'),
  ) as {
    builds?: Array<{ src?: string }>;
    rewrites?: Array<{ source?: string; destination?: string }>;
  };

  test('builds and routes the authoritative planning-context handler', () => {
    expect(config.builds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: 'api/ai/planning-context.ts' }),
      ]),
    );
    expect(config.rewrites).toEqual(
      expect.arrayContaining([
        {
          source: '/api/ai/planning-context',
          destination: '/api/ai/planning-context.ts',
        },
      ]),
    );
  });
});
