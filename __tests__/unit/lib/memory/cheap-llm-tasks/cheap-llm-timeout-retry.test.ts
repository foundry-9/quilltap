/**
 * Unit tests for the cheap-LLM same-route timeout retry (bug 107).
 *
 * A timed-out cheap pass used to be permanently lost. The SDK is handed
 * `maxRetries: 0` so a provider that gives up on its own budget arrives here as
 * a single failed attempt; nothing downstream re-queues the work; and the job
 * that asked for it went on to report a clean finish. Across 60 hours on a live
 * instance that was 81 lost passes, every one of them `Request timed out.`
 *
 * Two behaviours make that recoverable and, failing recovery, visible:
 *
 *  1. one more attempt at a fresh socket, but only for a timeout — a refusal or
 *     a bad key would fail identically the second time,
 *  2. `timedOut` on the result, so a caller can tell "this pass never happened"
 *     apart from "this pass disappointed me".
 *
 * The provider is stubbed; nothing here touches a network.
 */

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

const mockSendMessage = jest.fn();

jest.mock('@/lib/llm', () => ({
  createLLMProvider: jest.fn(async () => ({ sendMessage: (...args: any[]) => mockSendMessage(...args) })),
}));

jest.mock('@/lib/services/api-key.service', () => ({
  getApiKeyForCheapLLMSelection: jest.fn(async () => 'sk-test'),
}));

jest.mock('@/lib/services/llm-logging.service', () => ({
  logLLMCall: jest.fn(async () => undefined),
}));

jest.mock('@/lib/background-jobs/activity-registry', () => ({
  trackActivity: (_kind: string, fn: () => unknown) => fn(),
}));

// No fallback chain in these tests: the point is what the *primary* route does
// on its own, before any stand-in is considered.
jest.mock('@/lib/memory/cheap-llm-tasks/fallback', () => ({
  buildCheapFallbackSelections: jest.fn(async () => []),
}));

import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution';
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm';

const selection = {
  provider: 'NANOGPT',
  modelName: 'deepseek-v4-flash',
  isLocal: false,
  connectionProfileId: 'profile-1',
} as CheapLLMSelection;

const answered = { content: '{"ok":true}', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
const parse = (content: string) => JSON.parse(content) as { ok: boolean };

const run = (taskType = 'memory-extraction-self', options?: { latency?: 'background' | 'interactive' }) =>
  executeCheapLLMTask(
    selection,
    [{ role: 'user', content: 'go' }],
    'user-1',
    parse,
    taskType,
    'chat-1',
    undefined,
    undefined,
    undefined,
    undefined,
    options,
  );

describe('the same-route timeout retry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('tries the same route once more when the provider times out', async () => {
    mockSendMessage
      .mockRejectedValueOnce(new Error('Request timed out.'))
      .mockResolvedValueOnce(answered);

    const result = await run();

    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ ok: true });
    expect(result.timedOut).toBeUndefined();
  });

  it('gives up after the second timeout and says the pass was lost', async () => {
    mockSendMessage.mockRejectedValue(new Error('Request timed out.'));

    const result = await run();

    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(false);
    // The flag is the whole point: without it a caller cannot tell this apart
    // from a refusal, and reports a clean finish over a hole in the data.
    expect(result.timedOut).toBe(true);
  });

  it('does not retry an ordinary provider failure', async () => {
    // A 401 would be a 401 the second time too. The old behaviour — one
    // attempt, then the chain — is right for everything that is not a timeout.
    mockSendMessage.mockRejectedValue(new Error('401 Unauthorized'));

    const result = await run();

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(false);
  });

  it('does not spend a second budget while the operator is waiting', async () => {
    // The inline compression path: doubling the wait to rescue an optimisation
    // nobody would have noticed missing is the wrong trade. The turn goes out
    // uncompressed instead.
    mockSendMessage.mockRejectedValue(new Error('Request timed out.'));

    const result = await run('compress-conversation-history', { latency: 'interactive' });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(result.timedOut).toBe(true);
  });

  it('still retries compression on the pre-computed path', async () => {
    mockSendMessage
      .mockRejectedValueOnce(new Error('Request timed out.'))
      .mockResolvedValueOnce(answered);

    const result = await run('compress-conversation-history', { latency: 'background' });

    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
  });

  it('leaves the inline recap on the tighter budget with no retry', async () => {
    // `summarizeMemoryRecap` declares itself interactive at the task, because
    // it has exactly one caller and that caller is always a visible turn.
    mockSendMessage.mockRejectedValue(new Error('Request timed out.'));

    const result = await run('memory-recap-summarization', { latency: 'interactive' });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(result.timedOut).toBe(true);
  });

  it('hands the provider a budget inside our own deadline', async () => {
    mockSendMessage.mockResolvedValue(answered);

    await run('compress-conversation-history', { latency: 'background' });

    const [params] = mockSendMessage.mock.calls[0] as any[];
    // The provider should give up first, so the failure arrives as an ordinary
    // provider error with the socket closed rather than as our deadline firing
    // while an orphaned request runs on.
    expect(params.requestTimeoutMs).toBeGreaterThan(0);
    expect(params.requestTimeoutMs).toBeLessThan(120_000);
  });
});
