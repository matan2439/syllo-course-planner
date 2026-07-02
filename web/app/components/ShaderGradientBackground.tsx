/**
 * Syllo animated gradient background — CSS port of the canonical
 * sylloGradientConfig documented in app/web/semester_board_viewer.html.
 * Same color1/2/3 tokens per theme, animated only via GPU-composited
 * transform; the global prefers-reduced-motion rule freezes it.
 *
 * Canonical ShaderGradient editor config (for a future real
 * @shadergradient/react + @react-three/fiber integration — drop it in with
 * these exact values and there is no visual jump):
 *   Dark  color1="#606080" color2="#7C5CFF" color3="#212121"
 *   Light color1="#D6CCFF" color2="#EEF0F5" color3="#FAFAFC"
 *   type="waterPlane" cAzimuthAngle={180} cDistance={2.8} cPolarAngle={80}
 *   cameraZoom={9.1} rotationX={50} rotationY={0} rotationZ={-60}
 *   uDensity={1.5} uSpeed={0.3} uStrength={1.5} uTime={8} reflection={0.1}
 *   brightness={0.7 dark / 1 light} grain="off" pixelDensity={1} animate="on"
 */
export default function ShaderGradientBackground() {
  return <div aria-hidden className="syllo-bg" />
}
