/**
 * Preview harness for the multi-objective (topic + project) browser acceptance.
 *
 * Starts the SAME real-handler dev API server, but pinned to the committed
 * deterministic topic fixture and with the dev/quota bypasses the local stack
 * needs. Exists so the acceptance run is reproducible and cannot accidentally
 * pick up the git-ignored live evidence cache.
 *
 * DEV ONLY — never part of the deployed surface.
 */
process.env.AI_DEV_MODE = 'true'
process.env.AI_DEV_BYPASS_QUOTA = 'true'
process.env.AI_EVIDENCE_CACHE_DIR = 'data/evidence_fixtures/alternatives_preview'
// S3 — the local Preview board adapter. An ignored runtime path, so a committed
// board survives a browser refresh AND a restart of this process. NOT a
// Production adapter: a Vercel function's filesystem is per-instance.
process.env.SYLLO_BOARD_STATE_DIR = '.runtime/board-state'
delete process.env.DATABASE_URL

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./dev_api_server')
