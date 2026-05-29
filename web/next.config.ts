import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  eslint: {
    // Lint is run separately; don't block builds on lint warnings
    ignoreDuringBuilds: true,
  },
}

export default nextConfig
