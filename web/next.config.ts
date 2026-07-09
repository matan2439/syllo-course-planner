import type { NextConfig } from 'next'
import path from 'node:path'

// The planner UI served at /planner calls /api/board and /api/ai/* — those are
// root-level Vercel functions, not Next routes. Proxy them ONLY when an explicit
// origin is set (dev → a running `vercel dev`, or any deployed origin). When
// unset — the same-origin production case (Option C: /api/* served by the
// co-deployed functions in the same project) — emit no rewrite so /api/* is
// never proxied to localhost.
const plannerApiOrigin = process.env.PLANNER_API_ORIGIN

const nextConfig: NextConfig = {
  // Option C serves this Next app from the tau-course-planner project (repo root).
  // The /planner/legacy and /data route handlers readFile() assets that live
  // OUTSIDE web/, so trace from the repo root and explicitly bundle those assets
  // into each route's serverless function (otherwise the reads 404 at runtime).
  outputFileTracingRoot: path.join(process.cwd(), '..'),
  outputFileTracingIncludes: {
    // /planner/legacy reads the canonical single-file legacy planner HTML.
    '/planner/legacy': ['../app/web/semester_board_viewer.html'],
    // /data/[dir]/[file] serves the board + program JSON the embedded planner loads.
    '/data/[dir]/[file]': ['../data/parsed_json/**', '../data/programs/**'],
  },
  eslint: {
    // Lint is run separately; don't block builds on lint warnings
    ignoreDuringBuilds: true,
  },
  async rewrites() {
    return plannerApiOrigin
      ? [{ source: '/api/:path*', destination: `${plannerApiOrigin}/api/:path*` }]
      : []
  },
}

export default nextConfig
