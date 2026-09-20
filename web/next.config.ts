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
  // The /data route handler readFile()s assets that live OUTSIDE web/, so trace
  // from the repo root and explicitly bundle those assets into the route's
  // serverless function (otherwise the reads 404 at runtime).
  outputFileTracingRoot: path.join(process.cwd(), '..'),
  outputFileTracingIncludes: {
    // /data/[dir]/[file] serves the board + program JSON.
    '/data/[dir]/[file]': ['../data/parsed_json/**', '../data/programs/**'],
  },
  eslint: {
    // Lint is run separately; don't block builds on lint warnings
    ignoreDuringBuilds: true,
  },
  webpack(config) {
    // Shared planner contracts live one directory above this app. Vercel's
    // Next builder installs web/package.json dependencies here (not at the
    // repository root), so resolve their schema dependency from this app too.
    config.resolve.alias.zod = path.join(__dirname, 'node_modules', 'zod')
    return config
  },
  async rewrites() {
    return plannerApiOrigin
      ? [{ source: '/api/:path*', destination: `${plannerApiOrigin}/api/:path*` }]
      : []
  },
}

export default nextConfig
