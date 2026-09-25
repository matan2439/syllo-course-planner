import { Usage, type Model, type ModelRequest, type ModelResponse } from '@openai/agents'

export type FakeStep = Array<{ tool: string; args?: Record<string, unknown> } | { text: string }>

/**
 * A scripted OpenAI Agents SDK Model: each getResponse() returns the next
 * queued step (tool calls and/or assistant text). No network. Captures every
 * request so tests can assert what the agent saw.
 */
export class FakeAgentModel implements Model {
  readonly requests: ModelRequest[] = []
  private calls = 0

  constructor(private readonly steps: FakeStep[]) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request)
    const step = this.steps.shift()
    if (!step) throw new Error('FakeAgentModel: no scripted step left')
    return {
      usage: new Usage(),
      output: step.map((item) => 'text' in item
        ? {
            type: 'message' as const,
            role: 'assistant' as const,
            status: 'completed' as const,
            content: [{ type: 'output_text' as const, text: item.text }],
          }
        : {
            type: 'function_call' as const,
            callId: `call_${++this.calls}`,
            name: item.tool,
            status: 'completed' as const,
            arguments: JSON.stringify(item.args ?? {}),
          }),
    }
  }

  // eslint-disable-next-line require-yield
  async *getStreamedResponse(): AsyncIterable<never> {
    throw new Error('FakeAgentModel does not stream')
  }
}

export class FailingAgentModel implements Model {
  async getResponse(): Promise<ModelResponse> { throw new Error('provider down') }
  // eslint-disable-next-line require-yield
  async *getStreamedResponse(): AsyncIterable<never> { throw new Error('provider down') }
}
