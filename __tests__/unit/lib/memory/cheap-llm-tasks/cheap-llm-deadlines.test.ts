/**
 * Unit tests for the cheap-LLM per-attempt deadline.
 *
 * Compression carries the whole conversation history, so it is structurally the
 * largest prompt any cheap task sends and it sat against the shared ceiling as a
 * matter of course rather than as a stall. It now gets its own budget. These
 * tests pin the things that made the old arrangement wrong:
 *
 *  - compression's budget is genuinely larger than the shared default,
 *  - every other task still gets the default (the override is not a global bump),
 *  - a local provider keeps its own larger budget regardless of task,
 *  - and, since bug 107, that both ceilings clear the p99s measured on live
 *    data, and that the pre-computed and inline compression paths are budgeted
 *    *differently* — one is a background pass nobody is waiting on, the other
 *    is latency the operator sits through.
 *
 * The measured numbers these assertions defend, from a live instance:
 *   - 1,971 non-compression calls, max 39,936 ms against a 40,000 ms provider
 *     budget — a censored distribution, so the true tail is at least 40s.
 *   - 256 CONTEXT_COMPRESSION calls: p99 61.1s, max 67,733 ms against 70,000.
 * A budget below its own task's p99 converts healthy calls into permanent
 * losses, which is what these bounds exist to stop happening again.
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
  isTimeoutFailure,
  throwIfLostToTimeout,
  CheapLLMTaskLostError,
  CheapLLMTimeoutError,
  CHEAP_LLM_TASK_TIMEOUT_MS,
  CHEAP_LLM_TASK_TIMEOUT_INTERACTIVE_MS,
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

/** The measured p99 of CONTEXT_COMPRESSION, in ms. */
const COMPRESSION_P99_MS = 61_100;
/**
 * The observed maximum of the *censored* non-compression distribution. The
 * true tail is unknown and at least this; a ceiling at or below it is by
 * construction cutting healthy work.
 */
const CENSORED_TAIL_MS = 40_000;

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

  it('clears the censored tail of the shared default by a real margin', () => {
    // The old 45s (40s after provider headroom) sat *on* the observed maximum,
    // which is how 61 of 81 losses landed in this tier (bug 107).
    expect(CHEAP_LLM_TASK_TIMEOUT_MS).toBeGreaterThan(CENSORED_TAIL_MS * 1.5);
  });

  it('clears compression\'s measured p99 on the path nobody is waiting on', () => {
    for (const taskType of COMPRESSION_TASKS) {
      expect(deadlineFor(remote, taskType, 'background')).toBeGreaterThan(COMPRESSION_P99_MS);
    }
  });

  it('budgets the inline compression path more tightly than the pre-computed one', () => {
    // Asymmetry is the point: a generous background budget costs nothing but a
    // slow pass, while the same number inline is time the operator spends
    // watching an empty composer.
    for (const taskType of COMPRESSION_TASKS) {
      expect(deadlineFor(remote, taskType, 'interactive'))
        .toBeLessThan(deadlineFor(remote, taskType, 'background'));
    }
  });

  it('defaults to the background budget when no latency class is given', () => {
    for (const taskType of COMPRESSION_TASKS) {
      expect(deadlineFor(remote, taskType)).toBe(deadlineFor(remote, taskType, 'background'));
    }
  });

  it('applies the latency class to the shared tier too, not only to compression', () => {
    // The asymmetry follows *who is waiting*, not *which task it is*. The
    // memory recap and the two memory compressions are awaited inline while a
    // turn assembles, and a 90s ceiling would be spent in exactly the place it
    // should not be.
    expect(deadlineFor(remote, 'memory-recap-summarization', 'interactive'))
      .toBe(CHEAP_LLM_TASK_TIMEOUT_INTERACTIVE_MS);
    expect(deadlineFor(remote, 'memory-recap-summarization', 'background'))
      .toBe(CHEAP_LLM_TASK_TIMEOUT_MS);
    expect(CHEAP_LLM_TASK_TIMEOUT_INTERACTIVE_MS).toBeLessThan(CHEAP_LLM_TASK_TIMEOUT_MS);
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
      expect(deadlineFor(local, taskType, 'interactive')).toBe(CHEAP_LLM_TASK_TIMEOUT_LOCAL_MS);
    }
  });
});

describe('isTimeoutFailure', () => {
  // Both shapes mean "nobody answered in time", and the provider's own
  // abandonment is by far the more common: our deadline is the backstop and
  // fired zero times across the window that produced bug 107.
  it('recognises our own deadline', () => {
    expect(isTimeoutFailure(new CheapLLMTimeoutError(40_000, 'memory-extraction-self'))).toBe(true);
  });

  it('recognises a provider giving up on the budget we handed it', () => {
    expect(isTimeoutFailure(new Error('Request timed out.'))).toBe(true);
    expect(isTimeoutFailure(new Error('NanoGPT API error: ETIMEDOUT'))).toBe(true);
  });

  it('does not mistake an ordinary provider failure for one', () => {
    // These would fail identically on every retry; treating them as timeouts
    // would spend the backoff learning nothing.
    expect(isTimeoutFailure(new Error('401 Unauthorized'))).toBe(false);
    expect(isTimeoutFailure(new Error('Empty response from provider'))).toBe(false);
    expect(isTimeoutFailure(new Error('Unexpected token in JSON'))).toBe(false);
  });
});

describe('throwIfLostToTimeout', () => {
  it('says nothing about a task that succeeded', () => {
    expect(() => throwIfLostToTimeout({ success: true }, 'scene-state-tracking')).not.toThrow();
  });

  it('says nothing about a task that failed for any other reason', () => {
    // A refusal is a finished pass with a disappointing answer. Re-queueing it
    // would just spend the backoff on the same refusal.
    expect(() =>
      throwIfLostToTimeout({ success: false, error: 'content refused' }, 'scene-state-tracking')
    ).not.toThrow();
  });

  it('throws for a pass that never happened, naming the task', () => {
    expect(() =>
      throwIfLostToTimeout(
        { success: false, timedOut: true, error: 'Request timed out.' },
        'scene-state-tracking'
      )
    ).toThrow(CheapLLMTaskLostError);
    expect(() =>
      throwIfLostToTimeout({ success: false, timedOut: true }, 'scene-state-tracking')
    ).toThrow(/scene-state-tracking/);
  });
});
