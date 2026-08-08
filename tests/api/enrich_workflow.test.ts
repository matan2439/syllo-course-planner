/**
 * Protected enrichment workflow + input safety:
 *  - the course allowlist parser is strict (injection-safe) and bounded;
 *  - the committed workflow invokes the REAL live enrichment (not the captured provider),
 *    is dispatch-only, cannot push/deploy, passes inputs via env (no shell injection), and
 *    gates on a provider credential.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseCourseAllowlist } from '../../api/ai/syllabus_enrichment';

const ROOT = join(__dirname, '..', '..');

describe('parseCourseAllowlist — strict, bounded, injection-safe', () => {
  test('accepts valid ids, dedupes, empty → []', () => {
    expect(parseCourseAllowlist('0542-4425, 0542-2400 , 0542-4425')).toEqual(['0542-4425', '0542-2400']);
    expect(parseCourseAllowlist('')).toEqual([]);
    expect(parseCourseAllowlist(undefined)).toEqual([]);
  });
  test('rejects non-NNNN-NNNN tokens (no arbitrary strings / shell metacharacters)', () => {
    expect(() => parseCourseAllowlist('0542-4425; rm -rf /')).toThrow(/invalid/i);
    expect(() => parseCourseAllowlist('$(curl evil)')).toThrow(/invalid/i);
    expect(() => parseCourseAllowlist('all-courses')).toThrow(/invalid/i);
  });
  test('rejects an over-cap set (bounds the model-call count)', () => {
    const many = Array.from({ length: 13 }, (_, i) => `0542-${String(1000 + i)}`).join(',');
    expect(() => parseCourseAllowlist(many, { max: 12 })).toThrow(/too large/i);
  });
});

describe('committed enrichment workflow (.github/workflows/enrich-syllabi.yml)', () => {
  const yml = readFileSync(join(ROOT, '.github', 'workflows', 'enrich-syllabi.yml'), 'utf8');

  test('is dispatch-only and cannot push or deploy production', () => {
    expect(yml).toMatch(/workflow_dispatch:/);
    expect(yml).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(yml).not.toMatch(/vercel deploy/);
    expect(yml).not.toMatch(/git push/);
  });
  test('invokes the REAL live enrichment (not the captured provider)', () => {
    expect(yml).toMatch(/enrich_syllabi\.ts .* --live/);
    expect(yml).not.toMatch(/ClaimSpecProvider/);
  });
  test('passes inputs via env vars (no shell interpolation of workflow inputs → no injection)', () => {
    // the run step must reference "$PROGRAM"/"$COURSES", NOT ${{ inputs.* }} inline in the command
    expect(yml).toMatch(/"\$PROGRAM"/);
    expect(yml).toMatch(/"\$COURSES"/);
    expect(yml).not.toMatch(/enrich_syllabi\.ts.*\$\{\{\s*inputs\./);
  });
  test('gates on a provider credential and names the required secret, without embedding secret values', () => {
    expect(yml).toMatch(/OPENAI_API_KEY:\s*\$\{\{\s*secrets\.OPENAI_API_KEY\s*\}\}/);
    expect(yml).toMatch(/No provider credential configured/);
    expect(yml).not.toMatch(/sk-[A-Za-z0-9]/); // no baked secret
  });
});
