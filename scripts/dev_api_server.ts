/**
 * Local dev API server — serves the REAL root serverless handlers over plain
 * Node HTTP so the Next app (`next dev`) can exercise the true generation
 * pipeline without `vercel dev` or a live database.
 *
 * Runs from the repo ROOT (via tsx) so board_loader's __dirname/data-path and
 * the planner modules resolve exactly as they do in the deployed function.
 * Point Next at it with PLANNER_API_ORIGIN=http://localhost:3002 (next.config
 * already proxies /api/* to that origin) and run:
 *
 *   AI_DEV_MODE=true AI_DEV_BYPASS_QUOTA=true npx tsx scripts/dev_api_server.ts
 *
 * DEV ONLY. Never part of the deployed surface (prod serves the functions
 * directly via vercel.json). No auth/quota — bypass flags are required.
 */
import { createServer, type ServerResponse } from 'node:http'
import generatePlanHandler from '../api/ai/generate-plan'
import applyPlanHandler from '../api/ai/apply-plan'
import { loadLocalBoardJson } from '../api/ai/board_loader'

const PORT = Number(process.env.DEV_API_PORT ?? 3002)

function decorate(res: ServerResponse) {
  const r = res as ServerResponse & { status: (c: number) => typeof r; json: (o: unknown) => void; send: (b: unknown) => void }
  r.status = (code: number) => { r.statusCode = code; return r }
  r.json = (obj: unknown) => { r.setHeader('content-type', 'application/json; charset=utf-8'); r.end(JSON.stringify(obj)) }
  r.send = (body: unknown) => { r.end(typeof body === 'string' ? body : JSON.stringify(body)) }
  return r
}

const server = createServer(async (req, res) => {
  const r = decorate(res)
  r.setHeader('Access-Control-Allow-Origin', '*')
  r.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  r.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { r.status(204).end(); return }

  const path = (req.url ?? '/').split('?')[0]
  try {
    if (req.method === 'GET' && path.startsWith('/api/board/')) {
      const programId = decodeURIComponent(path.slice('/api/board/'.length))
      const board = loadLocalBoardJson(programId)
      if (!board) { r.status(404).json({ error: `Program "${programId}" not found locally.`, code: 'NOT_FOUND' }); return }
      r.status(200).json(board)
      return
    }
    // S2 — the authoritative Apply (POST) and the session's committed board (GET).
    if (path === '/api/ai/apply-plan') {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      const raw = Buffer.concat(chunks).toString('utf8')
      ;(req as unknown as { body: unknown }).body = raw ? JSON.parse(raw) : {}
      const url = new URL(req.url ?? '/', 'http://localhost')
      ;(req as unknown as { query: unknown }).query = Object.fromEntries(url.searchParams)
      await applyPlanHandler(req as never, r as never)
      return
    }
    if (path === '/api/ai/generate-plan') {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      const raw = Buffer.concat(chunks).toString('utf8')
      ;(req as unknown as { body: unknown }).body = raw ? JSON.parse(raw) : {}
      ;(req as unknown as { query: unknown }).query = {}
      await generatePlanHandler(req as never, r as never)
      return
    }
    r.status(404).json({ error: `No dev route for ${req.method} ${path}` })
  } catch (e) {
    console.error('[dev-api] error:', e)
    if (!r.headersSent) r.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
})

server.listen(PORT, () => {
  console.log(`[dev-api] real handlers on http://localhost:${PORT}`)
  console.log(`[dev-api] AI_DEV_MODE=${process.env.AI_DEV_MODE} AI_DEV_BYPASS_QUOTA=${process.env.AI_DEV_BYPASS_QUOTA} DATABASE_URL=${process.env.DATABASE_URL ? 'set' : 'unset'}`)
})
