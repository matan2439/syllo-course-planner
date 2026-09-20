/**
 * Guard for BROWSER-FACING board fixtures.
 *
 * Found during Preview acceptance: `test_program_grounded_preview_2027` was
 * committed without `metadata.board_data_version`, which
 * `shared/planner/wire.ts`'s `boardResponseSchema` requires. `/api/board`
 * happily returned it with HTTP 200 and the browser client then failed with
 * `ContractError: malformed board response` — the contract working correctly,
 * but the failure only showed up in a real browser round-trip.
 *
 * Scope is deliberately narrow: only the fixtures actually reachable through the
 * Preview route go through `boardResponseToModel`. The many API-only fixtures
 * are exercised directly by handler tests and legitimately omit browser-only
 * fields, so asserting the contract over all of `data/boards` would be wrong.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { boardResponseToModel } from '../../shared/planner/adapters';

/** Board fixtures the Preview route (and therefore a real browser) can load. */
const BROWSER_FACING_FIXTURES = [
  'test_program_agent_preview_2027',
  'test_program_dual_balance_2027',
  'test_program_grounded_preview_2027',
];

describe('browser-facing board fixtures satisfy the board wire contract', () => {
  test.each(BROWSER_FACING_FIXTURES)('%s parses through boardResponseToModel', (name) => {
    const raw = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'data', 'boards', `${name}.json`), 'utf-8'),
    );
    expect(() => boardResponseToModel(raw)).not.toThrow();
  });

  test.each(BROWSER_FACING_FIXTURES)('%s declares a catalog revision the client can key on', (name) => {
    const raw = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'data', 'boards', `${name}.json`), 'utf-8'),
    );
    const model = boardResponseToModel(raw);
    expect(typeof model.catalogRevision).toBe('string');
    expect(model.catalogRevision.length).toBeGreaterThan(0);
  });
});
