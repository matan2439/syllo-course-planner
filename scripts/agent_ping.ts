/**
 * One cheap request that proves the co-pilot's exact model config works:
 * @openai/agents 0.3.9 + AI_AGENT_MODEL (default gpt-6-sol) + reasoning effort
 * + one strict tool call. Reads OPENAI_API_KEY from .env.local.
 *
 *   npm run agent:ping
 */
import { Agent, run, setTracingDisabled, tool } from '@openai/agents';
import { z } from 'zod';
import { agentModelName } from '../api/ai/agent/planner_agent';

try { process.loadEnvFile('.env.local') } catch { /* rely on the shell env */ }
setTracingDisabled(true);

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error('Set OPENAI_API_KEY in .env.local (repo root)');
  let toolCalled = false;
  const agent = new Agent({
    name: 'ping',
    instructions: 'Call the echo tool with the word "ok", then reply with exactly the tool result.',
    model: agentModelName(),
    modelSettings: { reasoning: { effort: 'medium' } }, // same setting the co-pilot sends
    tools: [tool({
      name: 'echo',
      description: 'Echo a word back.',
      parameters: z.object({ word: z.string(), note: z.string().nullable() }),
      execute: async ({ word }) => { toolCalled = true; return word; },
    })],
  });
  const started = Date.now();
  const result = await run(agent, 'ping', { maxTurns: 3 });
  console.log(`model=${agentModelName()} reasoning=medium tool_called=${toolCalled} reply=${JSON.stringify(result.finalOutput)} (${Date.now() - started}ms)`);
  if (!toolCalled) process.exit(1);
}

main().catch((error) => { console.error('PING FAILED:', error?.status ?? '', error?.message ?? error); process.exit(1); });
