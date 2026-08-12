/**
 * Z.AI `reasoning_effort` — model gating + default-`high` behavior.
 *
 * Covers the decisions in
 * docs/developer/features/z-ai-reasoning-effort-plan.md: the glm-5.2-and-newer
 * gate (`supportsReasoningEffort`) and the provider's default-`high`/skip logic
 * in `applyProfileParameters` (exercised through `sendMessage`, whose request
 * body we capture from the mocked OpenAI client).
 */

import { ZAIProvider, supportsReasoningEffort } from '@/plugins/dist/qtap-plugin-z-ai/provider';

// Mock the OpenAI SDK so sendMessage hits a stub we can inspect.
jest.mock('openai', () => {
  const create = jest.fn();
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: { completions: { create } },
      models: { list: jest.fn() },
    })),
  };
});

import OpenAI from 'openai';

function getCreateMock(): jest.Mock {
  const MockOpenAI = OpenAI as unknown as jest.MockedClass<typeof OpenAI>;
  const instance = MockOpenAI.mock.results[MockOpenAI.mock.results.length - 1]?.value;
  return instance.chat.completions.create as jest.Mock;
}

const FAKE_COMPLETION = {
  choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

/** Run sendMessage and return the request body handed to the OpenAI client. */
async function captureBody(opts: {
  model: string;
  profileParameters?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const provider = new ZAIProvider();
  // new ZAIProvider() creates the OpenAI client lazily inside sendMessage, so
  // resolve the create mock after the call.
  const params = {
    model: opts.model,
    messages: [{ role: 'user' as const, content: 'hi' }],
    profileParameters: opts.profileParameters,
  };
  await provider.sendMessage(params as never, 'test-key').catch(() => undefined);
  const create = getCreateMock();
  return (create.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  jest.clearAllMocks();
  const MockOpenAI = OpenAI as unknown as jest.MockedClass<typeof OpenAI>;
  // Make every instance's create resolve a valid completion.
  (MockOpenAI as unknown as jest.Mock).mockImplementation(() => ({
    chat: { completions: { create: jest.fn().mockResolvedValue(FAKE_COMPLETION) } },
    models: { list: jest.fn() },
  }));
});

describe('supportsReasoningEffort', () => {
  it.each([
    ['glm-5.2', true],
    ['glm-5.2-0626', true],
    ['glm-5.3', true],
    ['glm-6', true],
    ['glm-5.1', false],
    ['glm-5', false],
    ['glm-5-turbo', false],
    ['glm-4.6', false],
    ['glm-5v-turbo', false],
  ])('%s -> %s', (model, expected) => {
    expect(supportsReasoningEffort(model)).toBe(expected);
  });
});

describe('applyProfileParameters reasoning_effort behavior', () => {
  it('defaults glm-5.2 to high when thinking is not disabled and no effort set', async () => {
    const body = await captureBody({ model: 'glm-5.2' });
    expect(body.reasoning_effort).toBe('high');
  });

  it('applies the high default even at thinking "(model default)"', async () => {
    const body = await captureBody({ model: 'glm-5.2', profileParameters: { thinking: '' } });
    expect(body.reasoning_effort).toBe('high');
  });

  it('sets no effort on glm-5.2 when thinking is explicitly disabled', async () => {
    const body = await captureBody({
      model: 'glm-5.2',
      profileParameters: { thinking: 'disabled' },
    });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('never sets effort on a model that does not support it (glm-4.6)', async () => {
    const body = await captureBody({
      model: 'glm-4.6',
      profileParameters: { reasoning_effort: 'max' },
    });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('honors an explicit profile effort on glm-5.2, overriding the default', async () => {
    const body = await captureBody({
      model: 'glm-5.2',
      profileParameters: { reasoning_effort: 'max' },
    });
    expect(body.reasoning_effort).toBe('max');
  });

  it('treats minimal as a real explicit value on glm-5.2', async () => {
    const body = await captureBody({
      model: 'glm-5.2',
      profileParameters: { reasoning_effort: 'minimal' },
    });
    expect(body.reasoning_effort).toBe('minimal');
  });
});
