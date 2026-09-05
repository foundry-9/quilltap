/**
 * DeepSeek thinking detection — the model's habit, not just the request body.
 *
 * Bug 86: `stripThinkingIncompatibleParams` decided whether a request was a
 * thinking request by inspecting the outgoing body for `thinking: enabled`.
 * That answers "what did we ask for?" when the question is "what will the
 * model do?" — the V4 models reason with `parameters: {}`, so a default
 * profile was judged not to be thinking and `temperature`, `top_p`, and the
 * penalties were sent into a request that ignores them.
 *
 * These exercise the real decision through `sendMessage`, whose request body
 * we capture from the mocked OpenAI client.
 */

import { DeepSeekProvider } from '@/plugins/dist/qtap-plugin-deepseek/provider';

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
  const provider = new DeepSeekProvider();
  const params = {
    model: opts.model,
    messages: [{ role: 'user' as const, content: 'hi' }],
    temperature: 0.9,
    topP: 0.8,
    profileParameters: opts.profileParameters,
  };
  await provider.sendMessage(params as never, 'test-key').catch(() => undefined);
  const create = getCreateMock();
  return (create.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
}

/** The four params DeepSeek ignores while thinking. */
function thinkingIncompatibleKeys(body: Record<string, unknown>): string[] {
  return ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty'].filter(
    (k) => k in body
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  const MockOpenAI = OpenAI as unknown as jest.MockedClass<typeof OpenAI>;
  (MockOpenAI as unknown as jest.Mock).mockImplementation(() => ({
    chat: { completions: { create: jest.fn().mockResolvedValue(FAKE_COMPLETION) } },
    models: { list: jest.fn() },
  }));
});

describe('DeepSeek thinking-incompatible params', () => {
  it.each(['deepseek-v4-flash', 'deepseek-v4-pro'])(
    'strips them on %s with no thinking parameter at all (bug 86)',
    async (model) => {
      // The reproducing profile: `parameters: {}`. The model reasons anyway.
      const body = await captureBody({ model });
      expect(thinkingIncompatibleKeys(body)).toEqual([]);
    }
  );

  it('strips them at "(model default)", which the editor stores as ""', async () => {
    const body = await captureBody({
      model: 'deepseek-v4-flash',
      profileParameters: { thinking: '' },
    });
    expect(thinkingIncompatibleKeys(body)).toEqual([]);
  });

  it('strips them when thinking is explicitly enabled', async () => {
    const body = await captureBody({
      model: 'deepseek-v4-flash',
      profileParameters: { thinking: 'enabled' },
    });
    expect(thinkingIncompatibleKeys(body)).toEqual([]);
  });

  it('keeps them when the profile explicitly disables thinking', async () => {
    // An explicit choice outranks the model's habit, so the sampling controls
    // are meaningful again and must survive.
    const body = await captureBody({
      model: 'deepseek-v4-flash',
      profileParameters: { thinking: 'disabled', frequency_penalty: 0.5 },
    });
    expect(body.temperature).toBe(0.9);
    expect(body.top_p).toBe(0.8);
    expect(body.frequency_penalty).toBe(0.5);
  });

  it('keeps them on a model the static catalogue does not list', async () => {
    // No catalogue entry means no stated habit; an unknown model contributes
    // nothing and the params go out as they always did.
    const body = await captureBody({ model: 'deepseek-v4-flash-vision-exp' });
    expect(body.temperature).toBe(0.9);
    expect(body.top_p).toBe(0.8);
  });

  it('still forwards the thinking parameter itself in DeepSeek wire shape', async () => {
    const body = await captureBody({
      model: 'deepseek-v4-pro',
      profileParameters: { thinking: 'enabled', reasoning_effort: 'max' },
    });
    expect(body.thinking).toEqual({ type: 'enabled' });
    expect(body.reasoning_effort).toBe('max');
  });
});
