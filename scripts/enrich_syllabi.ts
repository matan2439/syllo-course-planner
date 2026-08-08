/**
 * Protected enrichment operation (run manually / in a protected job, NOT during Generate):
 *   board syllabi → semantic provider → grounding validator → versioned cache file.
 *
 * Modes:
 *   npx tsx scripts/enrich_syllabi.ts <program> --live      # REAL model (needs a provider credential)
 *   npx tsx scripts/enrich_syllabi.ts <program>             # captured reviewed fixture (deterministic)
 *
 * --live requires a configured provider credential (OPENAI_API_KEY / ANTHROPIC_API_KEY /
 * GOOGLE_GENERATIVE_AI_API_KEY, and optionally AI_PROVIDER). It performs one real model call
 * per evaluated course, deterministically validates the output, and writes a validated,
 * versioned, provenance-tagged profile. It never exposes raw model output or secrets, and is
 * never invoked by ordinary Generate. The written cache is a deployment-safe immutable artifact.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ClaimSpecProvider, type SemanticExtractionProvider } from '../api/ai/semantic_course_extraction';
import { LlmSemanticExtractionProvider } from '../api/ai/llm_semantic_provider';
import { enrichProgram, parseCourseAllowlist } from '../api/ai/syllabus_enrichment';
import { loadEnrichedProfileCache, type ExtractorKind } from '../api/ai/course_profile_cache';

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const program = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--courses') || 'mechanical_engineering_2027';
  const live = args.includes('--live');
  const root = join(__dirname, '..');
  const board = JSON.parse(readFileSync(join(root, 'data', 'boards', `${program}.json`), 'utf8'));
  const captured = JSON.parse(readFileSync(join(root, 'data', 'enriched_profiles', 'captured_extractions.json'), 'utf8'));
  // Bounded, validated course allowlist (e.g. from a protected workflow input); defaults
  // to the reviewed evaluation set when not supplied.
  const allow = parseCourseAllowlist(argValue(args, '--courses'), { max: 12 });
  const courseIds: string[] = allow.length ? allow : Object.keys(captured.claims);
  const previous = loadEnrichedProfileCache(program);

  let provider: SemanticExtractionProvider;
  let extractorKind: ExtractorKind;
  if (live) {
    provider = new LlmSemanticExtractionProvider({ timeoutMs: 30000, maxRetries: 2 }); // throws no_model if no credential
    extractorKind = 'live_semantic';
    console.log(`[enrich] LIVE semantic extraction via ${provider.name}`);
  } else {
    provider = new ClaimSpecProvider(captured.claims, captured.extractorName);
    extractorKind = 'captured';
    console.log('[enrich] captured reviewed fixture (deterministic; NOT a live model)');
  }

  // Deterministic generatedAt for captured runs so re-running unchanged inputs is a no-op.
  const now = live ? new Date().toISOString() : '2026-08-07T00:00:00.000Z';
  const { cache, perCourse } = await enrichProgram(board, program, provider, {
    courseIds, extractorKind, timeoutMs: 30000, previous, now,
  });

  const outPath = join(root, 'data', 'enriched_profiles', `${program}.json`);
  writeFileSync(outPath, JSON.stringify(cache, null, 2) + '\n');
  console.log(`[enrich] wrote ${outPath} (extractorKind=${cache.extractorKind}, extractor=${cache.extractorName})`);
  for (const r of perCourse) console.log(`  ${r.courseId}: ${r.status}${r.failureKind ? ` [${r.failureKind}]` : ''} accepted=${r.acceptedCount} rejected=${r.rejectedCount}`);
}

main().catch((e) => { console.error(`[enrich] failed: ${e?.kind ? e.kind + ': ' : ''}${e?.message ?? e}`); process.exit(1); });
