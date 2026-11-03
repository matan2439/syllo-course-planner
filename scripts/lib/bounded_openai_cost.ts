/** Prelaunch-only guard. No Production billing or entitlement code uses this. */
export const BENCHMARK_BUDGET_MICRO_USD = 5_000_000;
export const BENCHMARK_OUTPUT_LIMIT = 8_192;
export const BENCHMARK_MODEL = 'gpt-6-sol';

export type Reservation = {
  caseId: string;
  inputTokens: number;
  maxOutputTokens: number;
  reservedMicroUsd: number;
  settledUpperMicroUsd?: number;
};

export function validateBenchmarkPayload(body: Record<string, any>): void {
  if (body.model !== BENCHMARK_MODEL || body.service_tier !== 'default'
      || body.max_output_tokens !== BENCHMARK_OUTPUT_LIMIT || body.store !== false) {
    throw new Error('BENCHMARK_CONFIG_REJECTED');
  }
  if (body.previous_response_id || body.conversation || body.prompt || body.background) {
    throw new Error('BENCHMARK_HIDDEN_CONTEXT_REJECTED');
  }
  if (!Array.isArray(body.tools) || body.tools.some((t: any) => t.type !== 'function')) {
    throw new Error('BENCHMARK_HOSTED_TOOLS_REJECTED');
  }
  // Only inline text and function results are part of this approved test.
  const visit = (value: any): void => {
    if (!value || typeof value !== 'object') return;
    if (['input_image', 'input_file', 'input_audio', 'item_reference', 'compaction'].includes(value.type)) {
      throw new Error('BENCHMARK_NON_TEXT_INPUT_REJECTED');
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(body.input);
}

/** Worst cache-write rate for ALL input, full output cap, plus 100% contingency.
 * Counted input must remain below the long-context pricing threshold.
 * Unknown/failed calls retain the full reservation. Completed usage can replace
 * a reservation with a conservative upper bound, never a missing-usage estimate.
 */
export function reservationMicroUsd(inputTokens: number): number {
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || inputTokens > 272_000) {
    throw new Error('BENCHMARK_INPUT_COUNT_REJECTED');
  }
  return Math.ceil((inputTokens * 2.5 + BENCHMARK_OUTPUT_LIMIT * 10) * 2);
}

export function settledUpperMicroUsd(reservation: Reservation, response: any): number | undefined {
  const u = response?.usage;
  if (response?.status !== 'completed' || response?.serviceTier !== 'default'
      || !String(response?.model).startsWith(BENCHMARK_MODEL)
      || !Number.isSafeInteger(u?.input_tokens) || u.input_tokens < 0
      || u.input_tokens > reservation.inputTokens
      || !Number.isSafeInteger(u?.output_tokens) || u.output_tokens < 0
      || u.output_tokens > reservation.maxOutputTokens) return undefined;
  // Cache discounts are deliberately ignored in the spending guard.
  return Math.ceil((u.input_tokens * 2.5 + u.output_tokens * 10) * 2);
}

export const chargedUpperMicroUsd = (reservations: Reservation[]): number =>
  reservations.reduce((sum, r) => sum + (r.settledUpperMicroUsd ?? r.reservedMicroUsd), 0);

export function createBudgetedFetch(options: {
  transport: typeof fetch;
  reservations: Reservation[];
  caseId: () => string;
  persist: () => void;
  rejected?: (reason: string) => void;
}): typeof fetch {
  return async (url, init) => {
    if (String(url) !== 'https://api.openai.com/v1/responses' || init?.method !== 'POST'
        || typeof init.body !== 'string') throw new Error('BENCHMARK_ENDPOINT_REJECTED');
    const body = JSON.parse(init.body);
    validateBenchmarkPayload(body);
    const countKeys = ['model', 'input', 'instructions', 'tools', 'text', 'tool_choice',
      'parallel_tool_calls', 'reasoning', 'truncation'];
    const countBody = Object.fromEntries(countKeys.filter((k) => k in body).map((k) => [k, body[k]]));
    const count = await options.transport('https://api.openai.com/v1/responses/input_tokens', {
      ...init, body: JSON.stringify(countBody),
    });
    if (!count.ok) throw new Error(`BENCHMARK_COUNT_FAILED_${count.status}`);
    const counted = await count.json() as { object?: string; input_tokens?: number };
    if (counted.object !== 'response.input_tokens') throw new Error('BENCHMARK_COUNT_SHAPE_REJECTED');
    const cost = reservationMicroUsd(counted.input_tokens as number);
    const reserved = chargedUpperMicroUsd(options.reservations);
    if (reserved + cost > BENCHMARK_BUDGET_MICRO_USD) {
      options.rejected?.('BENCHMARK_BUDGET_EXHAUSTED');
      throw new Error('BENCHMARK_BUDGET_EXHAUSTED');
    }
    options.reservations.push({ caseId: options.caseId(), inputTokens: counted.input_tokens!,
      maxOutputTokens: BENCHMARK_OUTPUT_LIMIT, reservedMicroUsd: cost });
    // A durable reservation must succeed BEFORE sending a potentially billed call.
    options.persist();
    console.log(JSON.stringify({ request: options.reservations.length, caseId: options.caseId(),
      reservedTotalUsd: (reserved + cost) / 1_000_000 }));
    return options.transport(url, init);
  };
}
