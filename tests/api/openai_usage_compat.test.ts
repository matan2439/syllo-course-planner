import OpenAI from 'openai'
import { Agent, OpenAIProvider, Runner } from '@openai/agents'
import { sanitizeUsageDetails, usageCompatFetch } from '../../api/ai/agent/openai_usage_compat'

// The shape OpenAI returns today: a nested OBJECT inside input_tokens_details.
const USAGE = {
  input_tokens: 10, output_tokens: 5, total_tokens: 15,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens_details: { ephemeral_5m: 0, ephemeral_1h: 0 } },
  output_tokens_details: { reasoning_tokens: 2 },
}
const MESSAGE = { type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'שלום', annotations: [] }] }
const RESPONSE = { id: 'resp_1', object: 'response', created_at: 1, model: 'gpt-test', status: 'completed', output: [MESSAGE], usage: USAGE }

const sse = (events: object[]) => events.map((event, index) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify({ ...event, sequence_number: index })}\n\n`).join('')
const STREAM = sse([
  { type: 'response.created', response: { ...RESPONSE, status: 'in_progress', output: [], usage: null } },
  { type: 'response.output_item.added', output_index: 0, item: { ...MESSAGE, status: 'in_progress', content: [] } },
  { type: 'response.content_part.added', item_id: 'msg_1', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
  { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'שלום' },
  { type: 'response.output_text.done', item_id: 'msg_1', output_index: 0, content_index: 0, text: 'שלום' },
  { type: 'response.output_item.done', output_index: 0, item: MESSAGE },
  { type: 'response.completed', response: RESPONSE },
])
const stubFetch = (body: string, contentType = 'text/event-stream'): typeof fetch =>
  (async () => new Response(body, { status: 200, headers: { 'content-type': contentType } })) as typeof fetch

async function runThrough(fetchImpl: typeof fetch) {
  const client = new OpenAI({ apiKey: 'sk-test-not-real', fetch: fetchImpl, baseURL: 'https://stub.invalid/v1', maxRetries: 0 })
  const runner = new Runner({ modelProvider: new OpenAIProvider({ openAIClient: client, useResponses: true }), tracingDisabled: true })
  const result = await runner.run(new Agent({ name: 'probe', instructions: 'say hello', model: 'gpt-test' }), 'hi', { stream: true })
  for await (const _event of result) { /* drain */ }
  await result.completed
  return result
}

describe('OpenAI usage compatibility (no network, no model)', () => {
  test('REPRODUCTION: the SDK rejects the reply when usage details contain an object', async () => {
    await expect(runThrough(stubFetch(STREAM))).rejects.toThrow(/cache_write_tokens_details|Expected number, received object/)
  })

  test('with the compatibility fetch the same reply succeeds and keeps the numeric usage', async () => {
    const result = await runThrough(usageCompatFetch(stubFetch(STREAM)))
    expect(result.finalOutput).toBe('שלום')
    expect(result.state.usage.inputTokens).toBe(10)
    expect(result.state.usage.outputTokens).toBe(5)
  })

  test('sanitizing removes only non-numeric detail entries', () => {
    const cleaned = sanitizeUsageDetails({ usage: structuredClone(USAGE), other: { keep: { nested: 'x' } } })
    expect(cleaned.usage.input_tokens_details).toEqual({ cached_tokens: 0 })
    expect(cleaned.usage.output_tokens_details).toEqual({ reasoning_tokens: 2 })
    expect(cleaned.usage.input_tokens).toBe(10)
    expect(cleaned.other).toEqual({ keep: { nested: 'x' } })
  })

  test('a JSON response is sanitized, a non-JSON response is untouched', async () => {
    const json = await usageCompatFetch(stubFetch(JSON.stringify(RESPONSE), 'application/json'))('https://stub.invalid/x')
    expect((await json.json()).usage.input_tokens_details).toEqual({ cached_tokens: 0 })
    const text = await usageCompatFetch(stubFetch('plain', 'text/plain'))('https://stub.invalid/x')
    expect(await text.text()).toBe('plain')
  })

  test('an event stream split at arbitrary byte boundaries is still sanitized', async () => {
    const bytes = new TextEncoder().encode(STREAM)
    const body = new ReadableStream<Uint8Array>({
      start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close() },
    })
    const base = (async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as typeof fetch
    const text = await (await usageCompatFetch(base)('https://stub.invalid/x')).text()
    expect(text).not.toContain('cache_write_tokens_details')
    expect(text).toContain('cached_tokens')
    expect(text).toContain('שלום')
  })

  test('errors from OpenAI pass through unchanged', async () => {
    const failing = (async () => new Response('{"error":{"message":"nope"}}', { status: 429, headers: { 'content-type': 'application/json' } })) as typeof fetch
    const response = await usageCompatFetch(failing)('https://stub.invalid/x')
    expect(response.status).toBe(429)
    expect(await response.text()).toContain('nope')
  })
})
