/**
 * Approved synthetic prelaunch benchmark, maximum $5 additional model charges.
 * One execution per evidence file; no retries, Production DB or Paddle calls.
 * npx tsx scripts/agent_cost_benchmark.ts --self-test  (offline)
 * npx tsx scripts/agent_cost_benchmark.ts --run-approved
 */
import assert from 'node:assert/strict';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import OpenAI from 'openai';
import { OpenAIResponsesModel, setTracingDisabled, type Model, type ModelRequest } from '@openai/agents';
import { loadLocalBoardJson } from '../api/ai/board_loader';
import { clarifyForAcademicDecision, extractClarificationContext } from '../api/ai/academic_decision_runtime';
import { PlanningSession } from '../api/ai/agent/session';
import { runPlannerAgent } from '../api/ai/agent/planner_agent';
import { BENCHMARK_MODEL, BENCHMARK_OUTPUT_LIMIT, createBudgetedFetch,
  reservationMicroUsd, validateBenchmarkPayload, settledUpperMicroUsd, chargedUpperMicroUsd, type Reservation } from './lib/bounded_openai_cost';

const PATH = resolve('docs/billing/PRELAUNCH_COST_BENCHMARK_2026-10-06.json');
const payload = () => ({ model: BENCHMARK_MODEL, service_tier: 'default',
  max_output_tokens: BENCHMARK_OUTPUT_LIMIT, store: false, tools: [], input: 'synthetic' });

async function selfTest() {
  assert.throws(() => validateBenchmarkPayload({ ...payload(), model: 'other' }));
  assert.throws(() => validateBenchmarkPayload({ ...payload(), max_output_tokens: null }));
  assert.throws(() => validateBenchmarkPayload({ ...payload(), tools: [{ type: 'web_search' }] }));
  assert.throws(() => validateBenchmarkPayload({ ...payload(), previous_response_id: 'hidden' }));
  assert.throws(() => reservationMicroUsd(272_001));
  assert.throws(() => reservationMicroUsd(NaN));
  const reservations: Reservation[] = [];
  let posted = 0;
  let durable = false;
  const transport: typeof fetch = async (url) => {
    if (String(url).endsWith('/input_tokens')) {
      return new Response(JSON.stringify({ object: 'response.input_tokens', input_tokens: 1000 }));
    }
    assert.equal(durable, true);
    posted++;
    throw new Error('synthetic transport failure after sending');
  };
  const guarded = createBudgetedFetch({ transport, reservations, caseId: () => 'offline',
    persist: () => { durable = true; } });
  const init = { method: 'POST', body: JSON.stringify(payload()) };
  await assert.rejects(guarded('https://api.openai.com/v1/responses', init));
  assert.equal(posted, 1);
  const terminal = { status: 'completed', serviceTier: 'default', model: BENCHMARK_MODEL,
    usage: { input_tokens: 1000, output_tokens: 10 } };
  assert.equal(settledUpperMicroUsd(reservations[0], terminal), 5200);
  assert.equal(settledUpperMicroUsd(reservations[0], { ...terminal, usage: null }), undefined);
  assert.equal(settledUpperMicroUsd(reservations[0], { ...terminal, status: 'failed' }), undefined);
  assert.equal(settledUpperMicroUsd(reservations[0], { ...terminal,
    usage: { input_tokens: 1001, output_tokens: 10 } }), undefined);
  assert.equal(reservations.length, 1); // Failure retains the full reservation.
  reservations.push({ caseId: 'offline', inputTokens: 0, maxOutputTokens: 0, reservedMicroUsd: 5_000_000 });
  await assert.rejects(guarded('https://api.openai.com/v1/responses', init), /BUDGET_EXHAUSTED/);
  assert.equal(posted, 1);
  await assert.rejects(guarded('https://example.com', init), /ENDPOINT_REJECTED/);
  const noPersistence = createBudgetedFetch({ transport, reservations: [], caseId: () => 'offline',
    persist: () => { throw new Error('disk failure'); } });
  await assert.rejects(noPersistence('https://api.openai.com/v1/responses', init), /disk failure/);
  assert.equal(posted, 1);
  const badCount = createBudgetedFetch({ transport: async () => new Response('{}'),
    reservations: [], caseId: () => 'offline', persist: () => assert.fail('must not persist') });
  await assert.rejects(badCount('https://api.openai.com/v1/responses', init), /COUNT_SHAPE_REJECTED/);
  console.log('PASS: configuration, hidden context, hosted tools, input limits, budget exhaustion, retained failed-call reservation, durable-before-send, endpoint and count validation. No network calls.');
}

async function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  const resume = process.argv.includes('--resume-approved');
  if (!process.argv.includes('--run-approved') && !resume) throw new Error('RUN_FLAG_REQUIRED');
  if (existsSync(PATH) && !resume) throw new Error('EVIDENCE_EXISTS_NO_AUTOMATIC_RERUN');
  try { process.loadEnvFile('.env.local'); } catch { /* environment only */ }
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY_MISSING');
  if (process.env.OPENAI_BASE_URL || (process.env.AI_AGENT_MODEL && process.env.AI_AGENT_MODEL !== BENCHMARK_MODEL)) {
    throw new Error('CUSTOM_PROVIDER_OR_MODEL_REJECTED');
  }
  process.env.AI_AGENT_TRACING = 'false';
  setTracingDisabled(true);
  const nativeFetch = globalThis.fetch;
  // Local tools cannot make remote calls; only the guarded client has transport.
  globalThis.fetch = async () => { throw new Error('NON_BENCHMARK_NETWORK_BLOCKED'); };
  let currentCase = '';
  const initialReport = {
    startedAt: new Date().toISOString(), approvedBudgetUsd: 5, model: BENCHMARK_MODEL,
    scope: 'synthetic prelaunch; local board; no Production database or payments',
    outputCapPerRequest: BENCHMARK_OUTPUT_LIMIT, automaticRetries: 0,
    reservations: [] as Reservation[], responses: [] as any[], cases: [] as any[],
    rejectedRequests: [] as any[],
    status: 'running', finishedAt: null as string | null,
  };
  const report: typeof initialReport = resume ? JSON.parse(readFileSync(PATH, 'utf8')) : initialReport;
  if (resume) {
    if (report.status !== 'stopped_incomplete' || report.approvedBudgetUsd !== 5
        || report.model !== BENCHMARK_MODEL
        || report.cases.some((c) => c.id === 'long_context_revision_retry')) throw new Error('RESUME_SCOPE_REJECTED');
    // Serial calls are matched by case and ordinal; unmatched reservations stay held.
    for (const caseId of new Set(report.reservations.map((r) => r.caseId))) {
      const reservations = report.reservations.filter((r) => r.caseId === caseId);
      const responses = report.responses.filter((r) => r.caseId === caseId);
      if (reservations.length !== responses.length) continue;
      reservations.forEach((r, i) => { r.settledUpperMicroUsd = settledUpperMicroUsd(r, responses[i]); });
    }
    report.rejectedRequests ??= [];
    report.status = 'running';
    report.finishedAt = null;
  } else writeFileSync(PATH, JSON.stringify(report, null, 2), { flag: 'wx' });
  const persist = () => writeFileSync(PATH, JSON.stringify(report, null, 2));
  const guarded = createBudgetedFetch({ transport: nativeFetch, reservations: report.reservations,
    caseId: () => currentCase, persist, rejected: (reason) => {
      report.rejectedRequests.push({ caseId: currentCase, reason }); persist();
    } });
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: 'https://api.openai.com/v1',
    maxRetries: 0, fetch: guarded });
  const provider = new OpenAIResponsesModel(client, BENCHMARK_MODEL);
  const boundedRequest = (request: ModelRequest): ModelRequest => ({ ...request, tracing: false,
    modelSettings: { ...request.modelSettings, maxTokens: BENCHMARK_OUTPUT_LIMIT, store: false,
      providerData: { service_tier: 'default' } } });
  const recordResponse = (response: any) => {
    if (!response?.id || report.responses.some((r) => r.id === response.id)) return;
    report.responses.push({ caseId: currentCase, id: response.id, model: response.model,
      status: response.status, serviceTier: response.service_tier, usage: response.usage ?? null });
    const reservation = report.reservations.at(-1);
    if (reservation?.caseId === currentCase) {
      reservation.settledUpperMicroUsd = settledUpperMicroUsd(reservation, report.responses.at(-1));
    }
    persist();
  };
  const model: Model = {
    async getResponse(request) {
      const response = await provider.getResponse(boundedRequest(request));
      recordResponse(response.providerData);
      return response;
    },
    async *getStreamedResponse(request) {
      for await (const event of provider.getStreamedResponse(boundedRequest(request))) {
        if (event.type === 'model' && ['response.completed', 'response.incomplete', 'response.failed'].includes((event as any).event?.type)) {
          recordResponse((event as any).event.response);
        }
        yield event;
      }
    },
  };
  try {
    const programId = 'mechanical_engineering_2027';
    const board = loadLocalBoardJson(programId);
    if (!board) throw new Error('LOCAL_BOARD_MISSING');
    const context = { semesters: [], total_hours_progress: { known_completed_hours: 90 },
      personal_status: { completed: [], currently_taking: [], planned: [],
        completed_knowledge: { status: 'known', provenance: 'explicit_user' } } };
    const preferences = { max_weekly_hours: 20, disallowed_course_ids: [] };
    const cases = [
      { id: 'short_question', text: 'סיימתי שנים א וב. איך כדאי להתחיל לתכנן את השנה השלישית בהנדסת מכונות?' },
      { id: 'schedule_proposal', text: 'סיימתי שנים א וב, אני בשנה שלישית, עד 20 שעות שבועיות, אוהב בקרה, אין קורסים להחריג. בנה תוכנית לשני הסמסטרים עם לא יותר ממעבדה אחת בסמסטר.' },
      { id: 'long_context_revision', text: 'סיימתי שנים א וב, עד 20 שעות שבועיות, ללא קורסים להחריג. העדפות לתכנון ולתיקון: '
        + Array.from({ length: 40 }, (_, i) => `אילוץ ${i + 1}: לשמור על תנאי קדם, להעדיף מערכות בקרה, לא יותר ממעבדה אחת בכל סמסטר, להסביר אם ההעדפות מתנגשות. `).join('')
        + 'בנה הצעה לשנה שלישית ובדוק את הכללים.' },
    ];
    for (const sample of cases) {
      if (resume && sample.id !== 'long_context_revision') continue;
      if (resume) sample.id = 'long_context_revision_retry';
      currentCase = sample.id;
      const started = Date.now();
      const initialRequests = report.reservations.length;
      const clarification = await clarifyForAcademicDecision(extractClarificationContext(context, preferences, undefined));
      const session = new PlanningSession({ programId, programBoard: board, currentDegreeYear: 3,
        planContext: structuredClone(context), committedContext: structuredClone(context),
        preferences: { ...preferences }, clarification, fetchSchedule: async () => [],
        insights: {
          async grades(courseId) { return { course_key: courseId, has_data: false, passing_grade: 60,
            sources: [], overall: null, recent: null, trend: null, lecturers: [], terms: [] }; },
          async syllabus(courseId, board) { return { course_id: courseId, board, live: null,
            live_unavailable_reason: 'Synthetic benchmark uses local board only' }; },
        },
      });
      const result = await runPlannerAgent({ transcript: [{ role: 'user', text: sample.text }], session }, { model });
      report.cases.push({ id: sample.id, elapsedMs: Date.now() - started,
        requests: report.reservations.length - initialRequests, outcome: result.outcome,
        deliveredUsagePresent: 'usage' in result && Boolean(result.usage),
        validationPassed: result.outcome === 'proposal' ? result.validation.valid : null,
        reply: result.messageHe, tools: session.events.filter((e) => e.type === 'tool_status') });
      persist();
      console.log(JSON.stringify({ caseId: sample.id, outcome: result.outcome,
        requests: report.reservations.length - initialRequests }));
      if (result.outcome === 'assistant_unavailable' || !('usage' in result && result.usage)) {
        report.status = 'stopped_incomplete';
        break;
      }
    }
    if (report.status === 'running') report.status = 'completed';
  } catch (error) {
    report.status = 'failed';
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    persist();
    globalThis.fetch = nativeFetch;
    console.log(JSON.stringify({ evidence: PATH, status: report.status,
      requests: report.reservations.length,
      conservativeCostUpperUsd: chargedUpperMicroUsd(report.reservations) / 1_000_000 }));
  }
}

main().catch((error) => { console.error('BENCHMARK FAILED:', error?.name, error?.code ?? ''); process.exitCode = 1; });
