/**
 * Paddle.js (Paddle Billing v2) in the browser — only the client-side token and
 * environment, both public by design. Card data is entered in Paddle's own
 * checkout frame and never touches Syllo.
 */
const PADDLE_JS = 'https://cdn.paddle.com/paddle/v2/paddle.js'

export interface PaddleEventData { name?: string; data?: { transaction_id?: string } }

interface PaddleGlobal {
  Environment: { set(env: 'sandbox'): void }
  Initialize(options: { token: string; eventCallback?: (event: PaddleEventData) => void }): void
  Checkout: { open(options: { transactionId: string; settings?: Record<string, unknown> }): void }
  PricePreview(request: { items: Array<{ priceId: string; quantity: number }> }): Promise<{
    data: { details: { lineItems: Array<{ price: { id: string }; formattedTotals: { total: string } }> } }
  }>
}

declare global { interface Window { Paddle?: PaddleGlobal } }

export const paddleClientConfigured = () => Boolean(process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN)

let listener: (event: PaddleEventData) => void = () => {}
let ready: Promise<PaddleGlobal> | null = null

/** Loads and initializes Paddle.js once; later calls only swap the event listener. */
export function loadPaddle(onEvent: (event: PaddleEventData) => void): Promise<PaddleGlobal> {
  listener = onEvent
  ready ??= new Promise<PaddleGlobal>((resolve, reject) => {
    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN
    if (!token) { reject(new Error('Paddle is not configured')); return }
    const init = () => {
      const paddle = window.Paddle
      if (!paddle) { reject(new Error('Paddle.js failed to load')); return }
      if (process.env.NEXT_PUBLIC_PADDLE_ENV !== 'production') paddle.Environment.set('sandbox')
      paddle.Initialize({ token, eventCallback: (event) => listener(event) })
      resolve(paddle)
    }
    if (window.Paddle) { init(); return }
    const script = document.createElement('script')
    script.src = PADDLE_JS
    script.async = true
    script.onload = init
    script.onerror = () => { ready = null; reject(new Error('Paddle.js failed to load')) }
    document.head.appendChild(script)
  })
  return ready
}
