/**
 * NanoGPT reasoning wiring.
 *
 * Three contracts, each with a failure mode already seen elsewhere:
 *
 *   1. The `thinkingTurnRule` must partition exactly the values the options
 *      schema offers — a value the editor can store but the rule cannot read
 *      recreates bug 85's wrong-anchor default.
 *   2. `:thinking` catalogue entries carry `thinksByDefault`, the model-habit
 *      half of the same rule.
 *   3. The stream surfaces `delta.reasoning` — NanoGPT's main endpoint field
 *      (NOT the legacy `reasoning_content`, which is kept only as a
 *      fallback). Reading the wrong field leaves the thinking fold empty.
 *   4. The gateway's occasional verbatim echo of the answer down the
 *      reasoning channel (routing-dependent, seen live 2026-08-22) must be
 *      suppressed — committing it repeats the whole reply under a thinking
 *      fold anchored at the end of the prose. Real reasoning, which
 *      diverges from the prose, must survive the guard.
 */

import { NanoGPTProvider } from '@/plugins/dist/qtap-plugin-nanogpt/provider';
import { plugin } from '@/plugins/dist/qtap-plugin-nanogpt/index';
import { STATIC_MODELS } from '@/plugins/dist/qtap-plugin-nanogpt/models';

// Mock the OpenAI SDK so stream/send hit a stub we can inspect.
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

function mockClient(create: jest.Mock): void {
  (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
    chat: { completions: { create } },
    models: { list: jest.fn() },
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('NanoGPT thinkingTurnRule', () => {
  it('partitions exactly the values the options schema offers', () => {
    const rule = plugin.thinkingTurnRule;
    expect(rule?.optionKey).toBe('reasoning_effort');

    const schema = plugin.getProviderOptionsSchema?.();
    const field = schema?.groups
      .flatMap((g) => g.fields)
      .find((f) => f.key === rule?.optionKey);
    expect(field).toBeDefined();

    // Every non-blank editor value must be classified by the rule; the blank
    // "(model default)" value must be classified by neither side.
    const editorValues = (field?.enumValues ?? []).map((v) => v.value);
    const classified = [...(rule?.enabledValues ?? []), ...(rule?.disabledValues ?? [])];
    for (const value of editorValues) {
      if (value === '') {
        expect(classified).not.toContain(value);
      } else {
        expect(classified).toContain(value);
      }
    }
    expect(rule?.disabledValues).toEqual(['none']);
  });

  it('marks :thinking catalogue entries as thinking by default', () => {
    const thinkingEntries = STATIC_MODELS.filter((m) => m.id.endsWith(':thinking'));
    expect(thinkingEntries.length).toBeGreaterThan(0);
    for (const entry of thinkingEntries) {
      expect(entry.supportsThinking).toBe(true);
      expect(entry.thinksByDefault).toBe(true);
    }
  });
});

describe('NanoGPT reasoning on the wire', () => {
  it('forwards reasoning_effort from profile parameters', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    mockClient(create);

    const provider = new NanoGPTProvider();
    await provider.sendMessage(
      {
        model: 'anthropic/claude-sonnet-5:thinking',
        messages: [{ role: 'user', content: 'hi' }],
        profileParameters: { reasoning_effort: 'high' },
      } as never,
      'test-key'
    );

    expect(create.mock.calls[0][0]).toMatchObject({ reasoning_effort: 'high' });
  });

  it('surfaces delta.reasoning from the stream (main-endpoint field)', async () => {
    async function* chunks() {
      yield { choices: [{ delta: { reasoning: 'hmm, ' } }] };
      yield { choices: [{ delta: { reasoning: 'therefore' } }] };
      yield { choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] };
      yield { choices: [], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } };
    }
    const create = jest.fn().mockResolvedValue(chunks());
    mockClient(create);

    const provider = new NanoGPTProvider();
    const received: { content: string; reasoningContent?: string; done: boolean }[] = [];
    for await (const chunk of provider.streamMessage(
      { model: 'anthropic/claude-sonnet-5:thinking', messages: [{ role: 'user', content: 'hi' }] } as never,
      'test-key'
    )) {
      received.push(chunk as never);
    }

    const final = received[received.length - 1];
    expect(final.done).toBe(true);
    expect(final.reasoningContent).toBe('hmm, therefore');
    expect(received.some((c) => c.content === 'answer')).toBe(true);
  });

  it('still reads the legacy reasoning_content dialect as a fallback', async () => {
    async function* chunks() {
      yield { choices: [{ delta: { reasoning_content: 'old school' } }] };
      yield { choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] };
    }
    const create = jest.fn().mockResolvedValue(chunks());
    mockClient(create);

    const provider = new NanoGPTProvider();
    const received: { reasoningContent?: string; done: boolean }[] = [];
    for await (const chunk of provider.streamMessage(
      { model: 'qwen3.8-27b:thinking', messages: [{ role: 'user', content: 'hi' }] } as never,
      'test-key'
    )) {
      received.push(chunk as never);
    }

    expect(received[received.length - 1].reasoningContent).toBe('old school');
  });

  it('drops a trailing reasoning echo that replays the prose verbatim', async () => {
    async function* chunks() {
      yield { choices: [{ delta: { content: 'The answer, ' } }] };
      yield { choices: [{ delta: { content: 'in full.' } }] };
      // Gateway echo: the whole answer re-emitted down the reasoning channel,
      // split across chunks, after the content stream ends.
      yield { choices: [{ delta: { reasoning: 'The answer, ' } }] };
      yield { choices: [{ delta: { reasoning: 'in full.' }, finish_reason: 'stop' }] };
      yield { choices: [], usage: { prompt_tokens: 1, completion_tokens: 5, total_tokens: 6 } };
    }
    const create = jest.fn().mockResolvedValue(chunks());
    mockClient(create);

    const provider = new NanoGPTProvider();
    const received: { reasoningContent?: string; done: boolean; rawResponse?: unknown }[] = [];
    for await (const chunk of provider.streamMessage(
      { model: 'openai/gpt-5.5', messages: [{ role: 'user', content: 'hi' }] } as never,
      'test-key'
    )) {
      received.push(chunk as never);
    }

    // No chunk — live or final — may surface the echo as reasoning.
    expect(received.every((c) => !c.reasoningContent)).toBe(true);
    const finalRaw = received[received.length - 1].rawResponse as {
      choices: { message: { reasoning_content?: string } }[];
    };
    expect(finalRaw.choices[0].message.reasoning_content).toBeUndefined();
  });

  it('keeps post-prose reasoning that diverges from the prose', async () => {
    async function* chunks() {
      yield { choices: [{ delta: { content: 'Answer first.' } }] };
      // Starts like the prose, then diverges — real thinking, not an echo.
      yield { choices: [{ delta: { reasoning: 'Answer' } }] };
      yield { choices: [{ delta: { reasoning: ' needs checking.' }, finish_reason: 'stop' }] };
    }
    const create = jest.fn().mockResolvedValue(chunks());
    mockClient(create);

    const provider = new NanoGPTProvider();
    const received: { reasoningContent?: string; done: boolean }[] = [];
    for await (const chunk of provider.streamMessage(
      { model: 'openai/gpt-5.5', messages: [{ role: 'user', content: 'hi' }] } as never,
      'test-key'
    )) {
      received.push(chunk as never);
    }

    expect(received[received.length - 1].reasoningContent).toBe('Answer needs checking.');
  });

  it('drops a non-streaming reasoning echo equal to the content', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [
        { message: { content: 'Same text.', reasoning: 'Same text.' }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    mockClient(create);

    const provider = new NanoGPTProvider();
    const response = await provider.sendMessage(
      { model: 'openai/gpt-5.5', messages: [{ role: 'user', content: 'hi' }] } as never,
      'test-key'
    );

    expect(response.content).toBe('Same text.');
    expect(response.reasoningContent).toBeUndefined();
  });
});
