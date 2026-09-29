import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * postgres.js JSON-encodes a parameter the server types as json/jsonb, so a
 * JSON.stringify'd value bound to `$n::jsonb` is stored as a JSON *string*
 * (PGlite does not reproduce this). Bind JSON text as `$n::text::jsonb`.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

test('no SQL binds a parameter directly as ::jsonb (double-encoding in production)', () => {
  const offenders = files(join(process.cwd(), 'api'))
    .flatMap((path) => (readFileSync(path, 'utf8').match(/\$\d+::jsonb/g) ?? []).map((m) => `${path}: ${m}`));
  expect(offenders).toEqual([]);
});
