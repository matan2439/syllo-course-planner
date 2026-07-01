/**
 * ClarificationUX view-model adapter — tests for
 * api/ai/academic_clarification_view_model.ts.
 *
 * Proves buildClarificationViewModel is a pure, deterministic transform from
 * an existing ClarificationResult (produced by DeterministicClarificationCapability,
 * academic_clarification.ts) into a stable, UI-ready shape — without
 * re-deciding what's missing, without React/DOM/Supabase/LLM/production
 * planner imports.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DeterministicClarificationCapability } from '../../api/ai/academic_clarification';
import type { ClarificationPlanningContext, ClarificationResult } from '../../api/ai/academic_decision_types';
import type { InvalidClarificationAnswer } from '../../api/ai/academic_clarification_loop';
import { buildClarificationViewModel } from '../../api/ai/academic_clarification_view_model';

const capability = new DeterministicClarificationCapability();

function clarify(context: ClarificationPlanningContext): Promise<ClarificationResult> {
  return capability.clarify({ gaps: [], context });
}

const FULLY_ANSWERED_CONTEXT: ClarificationPlanningContext = {
  completedCourseIds: ['0366_1234'],
  currentCourseIds: ['0366_5678'],
  excludedCourseIds: [],
  maxWeeklyHours: 20,
  track: 'systems',
};

describe('buildClarificationViewModel', () => {
  test('empty/no-clarification result produces needsUserInput: false', async () => {
    const clarification = await clarify(FULLY_ANSWERED_CONTEXT);
    expect(clarification.needsClarification).toBe(false);

    const vm = buildClarificationViewModel(clarification);

    expect(vm.needsUserInput).toBe(false);
    expect(vm.items).toEqual([]);
  });

  test('missing completed courses produces one required/critical view-model item', async () => {
    const clarification = await clarify({ ...FULLY_ANSWERED_CONTEXT, completedCourseIds: [] });

    const vm = buildClarificationViewModel(clarification);

    const item = vm.items.find((i) => i.id === 'completed_courses');
    expect(item).toBeDefined();
    expect(item!.required).toBe(true);
    expect(item!.critical).toBe(true);
  });

  test('missing current courses produces a non-critical item', async () => {
    const clarification = await clarify({ ...FULLY_ANSWERED_CONTEXT, currentCourseIds: [] });

    const vm = buildClarificationViewModel(clarification);

    const item = vm.items.find((i) => i.id === 'current_courses');
    expect(item).toBeDefined();
    expect(item!.critical).toBe(false);
  });

  test('missing excluded courses produces a required/critical item', async () => {
    const clarification = await clarify({ ...FULLY_ANSWERED_CONTEXT, excludedCourseIds: undefined });

    const vm = buildClarificationViewModel(clarification);

    const item = vm.items.find((i) => i.id === 'excluded_courses');
    expect(item).toBeDefined();
    expect(item!.required).toBe(true);
    expect(item!.critical).toBe(true);
  });

  test('missing max weekly hours produces a numeric item', async () => {
    const clarification = await clarify({ ...FULLY_ANSWERED_CONTEXT, maxWeeklyHours: undefined });

    const vm = buildClarificationViewModel(clarification);

    const item = vm.items.find((i) => i.id === 'max_weekly_hours');
    expect(item).toBeDefined();
    expect(item!.answerType).toBe('number');
  });

  test('missing track/focus produces a text item', async () => {
    const clarification = await clarify({ ...FULLY_ANSWERED_CONTEXT, track: undefined });

    const vm = buildClarificationViewModel(clarification);

    const item = vm.items.find((i) => i.id === 'track_or_focus');
    expect(item).toBeDefined();
    expect(item!.answerType).toBe('text');
  });

  test('deterministic item order matches the source question order', async () => {
    const clarification = await clarify({});

    const vm = buildClarificationViewModel(clarification);

    expect(vm.items.map((i) => i.id)).toEqual(clarification.questions.map((q) => q.id));
    expect(vm.items.map((i) => i.id)).toEqual([
      'completed_courses',
      'current_courses',
      'excluded_courses',
      'max_weekly_hours',
      'track_or_focus',
    ]);
  });

  test('stable question ids are preserved exactly', async () => {
    const clarification = await clarify({});

    const vm = buildClarificationViewModel(clarification);

    for (const question of clarification.questions) {
      const item = vm.items.find((i) => i.id === question.id);
      expect(item).toBeDefined();
      expect(item!.inputKey).toBe(question.inputKey);
    }
  });

  test('does not mutate the source clarification result', async () => {
    const clarification = await clarify({});
    const before = JSON.parse(JSON.stringify(clarification));

    buildClarificationViewModel(clarification, { invalidAnswers: [{ questionId: 'max_weekly_hours', reason: 'bad' }] });

    expect(clarification).toEqual(before);
  });

  test('invalid answer metadata from the loop harness is surfaced as validation messages', async () => {
    const clarification = await clarify({});
    const invalidAnswers: InvalidClarificationAnswer[] = [
      { questionId: 'max_weekly_hours', reason: "'max_weekly_hours' expects a number" },
    ];

    const vm = buildClarificationViewModel(clarification, { invalidAnswers });

    const hoursItem = vm.items.find((i) => i.id === 'max_weekly_hours');
    const trackItem = vm.items.find((i) => i.id === 'track_or_focus');
    expect(hoursItem!.validationMessage).toBe("'max_weekly_hours' expects a number");
    expect(trackItem!.validationMessage).toBeUndefined();
  });

  test('blocking clarification state produces blocking: true', async () => {
    const clarification = await clarify({ ...FULLY_ANSWERED_CONTEXT, completedCourseIds: [] });

    const vm = buildClarificationViewModel(clarification, { blocking: true });

    expect(vm.blocking).toBe(true);
  });

  test('non-blocking clarification state produces blocking: false', async () => {
    const clarification = await clarify({ ...FULLY_ANSWERED_CONTEXT, completedCourseIds: [] });

    const vm = buildClarificationViewModel(clarification);

    expect(vm.blocking).toBe(false);
  });

  test('does not import React, DOM, Supabase, LLM clients, or production planner entrypoints', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../api/ai/academic_clarification_view_model.ts'),
      'utf-8',
    );
    const importLines = source
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line) || /\brequire\(/.test(line))
      .join('\n')
      .toLowerCase();

    const forbidden = [
      'react',
      '@supabase',
      'supabase',
      'openai',
      'anthropic',
      'generate-plan',
      'planner-run',
      'planner_orchestration',
      './planner_agent',
      './planner_capabilities',
      'program_provider',
    ];

    for (const pattern of forbidden) {
      expect(importLines).not.toContain(pattern.toLowerCase());
    }
  });
});
