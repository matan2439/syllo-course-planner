/**
 * Compatibility for OpenAI usage reports.
 *
 * The Agents SDK validates every `*_tokens_details` entry of a response as a NUMBER. OpenAI now returns
 * nested objects there (for example `input_tokens_details.cache_write_tokens_details`), and the SDK then
 * rejects the WHOLE reply with a ZodError, so the assistant answers "unavailable" even though the model
 * answered. Only usage bookkeeping is affected, so we drop the non-numeric entries before the SDK sees
 * them. Numbers (the ones the SDK and our metering read) are untouched.
 *
 * Remove this when the SDK is upgraded to a version that accepts the new shape.
 */

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Returns the same payload with non-numeric entries removed from every `*_tokens_details` object. */
export function sanitizeUsageDetails<T>(payload: T): T {
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!isPlainObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (/tokens_details$/.test(key) && isPlainObject(value)) {
        for (const [detailKey, detailValue] of Object.entries(value)) {
          if (typeof detailValue !== 'number') delete value[detailKey];
        }
      } else {
        visit(value);
      }
    }
  };
  visit(payload);
  return payload;
}

const sanitizeJsonText = (text: string): string => {
  try { return JSON.stringify(sanitizeUsageDetails(JSON.parse(text))); } catch { return text; }
};

/** Sanitizes the `data:` lines of a server-sent-event stream, event by event. */
function sanitizeEventStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  const emit = (controller: TransformStreamDefaultController<Uint8Array>, block: string) => {
    const lines = block.split('\n').map((line) => (line.startsWith('data:') && !line.startsWith('data: [DONE]')
      ? `data: ${sanitizeJsonText(line.slice(5).trim())}` : line));
    controller.enqueue(encoder.encode(`${lines.join('\n')}\n\n`));
  };
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';
      for (const block of blocks) emit(controller, block);
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer.trim()) emit(controller, buffer);
    },
  }));
}

/** A `fetch` that sanitizes usage details in JSON and event-stream responses; everything else passes through. */
export function usageCompatFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const response = await baseFetch(input, init);
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !response.body) return response;
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    if (type.includes('text/event-stream')) {
      return new Response(sanitizeEventStream(response.body), { status: response.status, statusText: response.statusText, headers });
    }
    if (type.includes('application/json')) {
      const text = await response.text();
      return new Response(sanitizeJsonText(text), { status: response.status, statusText: response.statusText, headers });
    }
    return response;
  }) as typeof fetch;
}
