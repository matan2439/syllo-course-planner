'use client'

import { Component, type ReactNode } from 'react'
import { ShaderGradient, ShaderGradientCanvas } from '@shadergradient/react'

/**
 * The real WebGL ShaderGradient scene — the canonical sylloGradientConfig
 * documented in ShaderGradientBackground.tsx / semester_board_viewer.html,
 * ported 1:1 so there is no visual jump from the CSS placeholder.
 *
 * Loaded only on the client (three.js/@react-three/fiber need window + WebGL),
 * via next/dynamic ssr:false in the parent. If WebGL context creation throws
 * (unsupported GPU, blocked context, driver crash) the boundary renders null
 * and the parent's .syllo-bg CSS gradient stays as the graceful fallback.
 */

class WebGLBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

// Same color1/2/3 + brightness tokens the CSS fallback uses per theme.
const PALETTE = {
  dark: { color1: '#606080', color2: '#7C5CFF', color3: '#212121', brightness: 0.7 },
  light: { color1: '#D6CCFF', color2: '#EEF0F5', color3: '#FAFAFC', brightness: 1 },
} as const

export default function ShaderScene({ theme }: { theme: 'dark' | 'light' }) {
  const p = PALETTE[theme]
  return (
    <WebGLBoundary>
      <ShaderGradientCanvas
        // Fill the fixed, clipped .syllo-bg parent; never intercept input.
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        pointerEvents="none"
        pixelDensity={1}
      >
        <ShaderGradient
          type="waterPlane"
          animate="on"
          color1={p.color1}
          color2={p.color2}
          color3={p.color3}
          brightness={p.brightness}
          cAzimuthAngle={180}
          cDistance={2.8}
          cPolarAngle={80}
          cameraZoom={9.1}
          rotationX={50}
          rotationY={0}
          rotationZ={-60}
          uDensity={1.5}
          uSpeed={0.3}
          uStrength={1.5}
          uTime={8}
          reflection={0.1}
          grain="off"
        />
      </ShaderGradientCanvas>
    </WebGLBoundary>
  )
}
