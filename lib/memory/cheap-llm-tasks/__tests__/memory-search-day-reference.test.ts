/**
 * @jest-environment node
 */

/**
 * The deterministic day-reference merge inside `extractMemorySearchKeywords`
 * (Fix 1 of the day-references + fresh-boost work).
 *
 * `executeCheapLLMTask` is mocked so a canned LLM response is fed straight into
 * the real parser the extractor supplies — which is where the merge lives — and
 * so the rendered prompt can be inspected for the local-time TODAY line.
 *
 * Every expectation is computed through the local-time API rather than pinned
 * to a timezone: Jest hands the file a copy of `process.env`, so `TZ` cannot be
 * fixed here (see lib/memory/__tests__/day-references.test.ts).
 */

// ── Subject ───────────────────────────────────────────────────────────────────
import { extractMemorySearchKeywords, type MemorySearchExtraction } from '../memory-tasks';

// ── Mocks ─────────────────────────────────────────────────────────────────────
jest.mock('../core-execution', () => ({
  executeCheapLLMTask: jest.fn(),
}));

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

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { executeCheapLLMTask } from '../core-execution';
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm';
import type { ChatMessage } from '../types';

const SELECTION: CheapLLMSelection = {
  provider: 'OPENAI',
  modelName: 'gpt-test',
  connectionProfileId: 'profile-1',
  isLocal: false,
} as never;

/** 2026-07-28 21:44 **local** — the wall clock from the diagnosed chat. */
const NOW = new Date(2026, 6, 28, 21, 44, 0, 0);
const NOW_ISO = NOW.toISOString();

/** Local midnight `offset` days from NOW, as a UTC ISO string. */
function localMidnight(offset: number): string {
  return new Date(
    NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + offset, 0, 0, 0, 0,
  ).toISOString();
}

/** What the LLM "returned" for the next call. */
let nextResponse = '{"keywords":["mission"]}';

beforeEach(() => {
  jest.clearAllMocks();
  nextResponse = '{"keywords":["mission"]}';
  jest.mocked(executeCheapLLMTask).mockImplementation(
    async (_sel, _msgs, _uid, parse) =>
      ({ success: true, result: (parse as (c: string) => unknown)(nextResponse) }) as never,
  );
});

async function run(
  messages: ChatMessage[],
  timelineMode: 'realtime' | 'narrative' = 'realtime',
): Promise<MemorySearchExtraction> {
  const res = await extractMemorySearchKeywords(
    messages,
    'Amy',
    SELECTION,
    'user-1',
    'chat-1',
    'char-1',
    { nowIso: NOW_ISO, timelineMode },
  );
  return res.result ?? { keywords: [] };
}

const userSays = (content: string): ChatMessage[] => [{ role: 'user', content }];

function lastUserPrompt(): string {
  const calls = jest.mocked(executeCheapLLMTask).mock.calls;
  const messages = calls[calls.length - 1][1] as Array<{ role: string; content: string }>;
  return messages.find(m => m.role === 'user')!.content;
}

describe('extractMemorySearchKeywords — deterministic day-reference merge', () => {
  it('rescues the diagnosed failure: LLM says not-retrospective, the turn says "today"', () => {
    nextResponse = JSON.stringify({
      keywords: ['mission'],
      temporal: 'present',
      context: 'information',
      paraphrase: 'Charlie is asking about the mission.',
      retrospective: false,
      timeRange: null,
    });
    return run(userSays('No, no. I mean the mission today. I want to hear about it.')).then(r => {
      expect(r.retrospective).toBe(true);
      expect(r.timeRange).toEqual({ from: localMidnight(0), to: NOW_ISO });
      // Everything the LLM did get right survives the merge.
      expect(r.keywords).toEqual(['mission']);
      expect(r.paraphrase).toBe('Charlie is asking about the mission.');
      expect(r.temporal).toBe('present');
    });
  });

  it('overrides an LLM-provided range when the reference points at the past', async () => {
    nextResponse = JSON.stringify({
      keywords: ['mission'],
      retrospective: true,
      // The UTC-biased range the model would emit at 21:44 local: the wrong day.
      timeRange: { from: '2026-07-29', to: '2026-07-29' },
    });
    const r = await run(userSays('how did the mission go today?'));
    expect(r.timeRange).toEqual({ from: localMidnight(0), to: NOW_ISO });
  });

  it('resolves "yesterday" to the previous local day', async () => {
    nextResponse = JSON.stringify({ keywords: ['mission'], retrospective: false, timeRange: null });
    const r = await run(userSays('tell me about yesterday'));
    expect(r.retrospective).toBe(true);
    expect(r.timeRange).toEqual({ from: localMidnight(-1), to: localMidnight(0) });
  });

  it('leaves the LLM result untouched on a fictional (narrative) timeline', async () => {
    nextResponse = JSON.stringify({ keywords: ['mission'], retrospective: false, timeRange: null });
    const r = await run(userSays('I mean the mission today'), 'narrative');
    expect(r.retrospective).toBe(false);
    expect(r.timeRange).toBeNull();
  });

  it('passes the LLM result through unchanged when no day reference is present', async () => {
    nextResponse = JSON.stringify({
      keywords: ['soil samples'],
      retrospective: false,
      timeRange: null,
      entities: ['Constantinople'],
    });
    const r = await run(userSays('how are the soil samples looking?'));
    expect(r).toEqual({
      keywords: ['soil samples'],
      temporal: undefined,
      context: undefined,
      paraphrase: undefined,
      retrospective: false,
      timeRange: null,
      entities: ['Constantinople'],
    });
  });

  it('applies nothing for a future-pointing reference, keeping any LLM range', async () => {
    nextResponse = JSON.stringify({
      keywords: ['pool'],
      retrospective: true,
      timeRange: { from: '2026-07-20', to: '2026-07-26' },
    });
    const r = await run(userSays("let's go to the pool tomorrow"));
    expect(r.retrospective).toBe(true);
    expect(r.timeRange).toEqual({
      from: '2026-07-20T00:00:00.000Z',
      to: '2026-07-26T23:59:59.999Z',
    });
  });

  it('ignores a stale day reference older than the scan window', async () => {
    nextResponse = JSON.stringify({ keywords: ['mission'], retrospective: false, timeRange: null });
    const messages: ChatMessage[] = [
      { role: 'user', content: 'we went to the market yesterday' },
      { role: 'assistant', content: 'we did' },
      { role: 'user', content: 'anyway' },
      { role: 'assistant', content: 'quite' },
      { role: 'user', content: 'about those samples' },
      { role: 'assistant', content: 'they hold' },
    ];
    const r = await run(messages);
    expect(r.retrospective).toBe(false);
    expect(r.timeRange).toBeNull();
  });

  it('still sees a day reference inside the scan window', async () => {
    nextResponse = JSON.stringify({ keywords: ['mission'], retrospective: false, timeRange: null });
    const messages: ChatMessage[] = [
      { role: 'user', content: 'we went to the market last spring' },
      { role: 'assistant', content: 'we did' },
      { role: 'user', content: 'and the mission today?' },
      { role: 'assistant', content: 'what about it' },
    ];
    const r = await run(messages);
    expect(r.retrospective).toBe(true);
    expect(r.timeRange).toEqual({ from: localMidnight(0), to: NOW_ISO });
  });
});

describe('extractMemorySearchKeywords — TODAY line', () => {
  it('renders the date and weekday from the local calendar, not UTC', async () => {
    await run(userSays('how are you'));
    const prompt = lastUserPrompt();
    expect(prompt).toContain('TODAY: 2026-07-28 (Tuesday)');
    expect(prompt).toContain('timeline mode: realtime');
  });
});
