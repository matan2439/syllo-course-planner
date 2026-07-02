import type { NextConfig } from 'next'

// The planner UI served at /planner calls /api/board and /api/ai/* — those are
// root-level Vercel functions, not Next routes. In dev, proxy them to a
// running `vercel dev` (or set PLANNER_API_ORIGIN to any deployed origin).
const plannerApiOrigin = process.env.PLANNER_API_ORIGIN ?? 'http://localhost:3000'

const nextConfig: NextConfig = {
  eslint: {
    // Lint is run separately; don't block builds on lint warnings
    ignoreDuringBuilds: true,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${plannerApiOrigin}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
