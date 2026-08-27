/**
 * Unit tests for the cheap-LLM per-attempt deadline.
 *
 * Compression carries the whole conversation history, so it is structurally the
 * largest prompt any cheap task sends and it sat against the shared ceiling as a
 * matter of course rather than as a stall. It now gets its own budget. These
 * tests pin the three things that made the old arrangement wrong:
 *
 *  - compression's budget is genuinely larger than the shared default,
 *  - every other task still gets the default (the override is not a global bump),
 *  - a local provider keeps its own larger budget regardless of task.
 *
 * `deadlineFor` is pure, so no provider and no network are involved.
 */

import { describe, it, expect } from '@jest/globals';

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

import {
  deadlineFor,
  CHEAP_LLM_TASK_TIMEOUT_MS,
  CHEAP_LLM_TASK_TIMEOUT_LOCAL_MS,
} from '@/lib/memory/cheap-llm-tasks/core-execution';
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm';

const remote = { isLocal: false } as CheapLLMSelection;
const local = { isLocal: true } as CheapLLMSelection;

const COMPRESSION_TASKS = [
  'compress-conversation-history',
  'compress-system-prompt',
  'compress-memories',
];

describe('deadlineFor', () => {
  it('gives every compression task more room than the shared default', () => {
    for (const taskType of COMPRESSION_TASKS) {
      expect(deadlineFor(remote, taskType)).toBeGreaterThan(CHEAP_LLM_TASK_TIMEOUT_MS);
    }
  });

  it('keeps all three compression tasks on one budget', () => {
    const budgets = new Set(COMPRESSION_TASKS.map((t) => deadlineFor(remote, t)));
    expect(budgets.size).toBe(1);
  });

  it('leaves other cheap tasks on the shared default', () => {
    // The override must not read as a global bump: these are the task types
    // that shared the ceiling with compression and should not have moved.
    for (const taskType of [
      'memory-extraction-self',
      'memory-extraction-other',
      'scene-state-tracking',
      'answer-confirmation',
      'summarize-chat',
      'title-chat',
    ]) {
      expect(deadlineFor(remote, taskType)).toBe(CHEAP_LLM_TASK_TIMEOUT_MS);
    }
  });

  it('falls back to the default for an unknown or absent task type', () => {
    expect(deadlineFor(remote, 'not-a-real-task')).toBe(CHEAP_LLM_TASK_TIMEOUT_MS);
    expect(deadlineFor(remote, undefined)).toBe(CHEAP_LLM_TASK_TIMEOUT_MS);
  });

  it('keeps a local provider on its own budget, compression included', () => {
    // A cold model load dwarfs any per-task difference, and the local budget is
    // already the larger of the two — a per-task override must not shrink it.
    expect(deadlineFor(local, undefined)).toBe(CHEAP_LLM_TASK_TIMEOUT_LOCAL_MS);
    for (const taskType of COMPRESSION_TASKS) {
      expect(deadlineFor(local, taskType)).toBe(CHEAP_LLM_TASK_TIMEOUT_LOCAL_MS);
    }
  });
});
