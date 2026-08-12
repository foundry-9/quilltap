/**
 * Anthropic new-model-generation request shaping — regression guard for the
 * Sonnet 5 / Opus 4.7+ / Fable / Mythos parameter rules.
 *
 * These models (commits 733fa12c, 36d04ab0) removed temperature/top_p/top_k
 * and fixed-budget thinking:
 *   - sampling params (temperature/top_p) must be OMITTED — sending them 400s
 *     with "`temperature` is deprecated for this model", even with thinking off.
 *   - extended thinking must be requested as `{type: 'adaptive', display:
 *     'summarized'}` rather than `{type: 'enabled', budget_tokens}` — the
 *     fixed-budget form 400s, and adaptive defaults display to "omitted" (empty
 *     reasoning text) unless "summarized" is asked for explicitly.
 * Older models (Sonnet 4.6-, Opus 4.6-, Haiku 4.5) keep the classic shape.
 *
 * The branching lives in a private helper, so — like the z-ai plugin suite —
 * we assert on the request body handed to the (mocked) Anthropic SDK. The
 * sendMessage and streamMessage paths carry duplicated copies of this logic,
 * so both are exercised to guard against drift.
 */

// Override the global jest.setup.ts Anthropic mock with one whose `create` is a
// single shared jest.fn we can inspect (the global mock hands each instance its
// own fn, so the request body can't be captured through it).
jest.mock('@anthropic-ai/sdk', () => {
  const create = jest.fn();
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({ messages: { create } })),
  };
});

import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from '@/plugins/dist/qtap-plugin-anthropic/provider';

// A valid non-streaming response so sendMessage's post-processing doesn't throw
// before we can inspect the captured request.
const FAKE_RESPONSE = {
  content: [{ type: 'text', text: 'ok' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
};

/** The shared create mock the provider and this test both see. */
function getCreateMock(): jest.Mock {
  return new (Anthropic as unknown as new () => { messages: { create: jest.Mock } })().messages
    .create;
}

beforeEach(() => {
  jest.clearAllMocks();
  getCreateMock().mockResolvedValue(FAKE_RESPONSE);
});

/** Run sendMessage and return the request body handed to the Anthropic client. */
async function captureSendBody(opts: {
  model: string;
  temperature?: number;
  topP?: number;
  profileParameters?: Record<string, unknown>;
}): Promise<Record<string, any>> {
  const provider = new AnthropicProvider();
  const params = {
    model: opts.model,
    messages: [{ role: 'user' as const, content: 'hi' }],
    temperature: opts.temperature,
    topP: opts.topP,
    profileParameters: opts.profileParameters,
  };
  await provider.sendMessage(params as never, 'test-key').catch(() => undefined);
  const create = getCreateMock();
  return (create.mock.calls[0]?.[0] ?? {}) as Record<string, any>;
}

/** Run streamMessage far enough to capture the request body it builds. */
async function captureStreamBody(opts: {
  model: string;
  temperature?: number;
  profileParameters?: Record<string, unknown>;
}): Promise<Record<string, any>> {
  const provider = new AnthropicProvider();
  const params = {
    model: opts.model,
    messages: [{ role: 'user' as const, content: 'hi' }],
    temperature: opts.temperature,
    profileParameters: opts.profileParameters,
  };
  try {
    // The mocked create resolves a plain object that isn't async-iterable, so
    // the stream loop throws — but only AFTER create is called with the body.
    for await (const _chunk of provider.streamMessage(params as never, 'test-key')) {
      // no-op
    }
  } catch {
    // expected: FAKE_RESPONSE is not an async iterable
  }
  const create = getCreateMock();
  return (create.mock.calls[0]?.[0] ?? {}) as Record<string, any>;
}

// Enabling thinking via the default-budget flag (thinkingBudget path is
// equivalent for the assertions here).
const THINKING_ON = { extendedThinking: true };

describe('AnthropicProvider — new model generation (sampling params rejected)', () => {
  const NEW_GEN = [
    'claude-sonnet-5',
    'claude-sonnet-5-20260101',
    'claude-opus-4-7',
    'claude-opus-4-8',
    'claude-fable-5',
    'claude-mythos-5',
    'claude-mythos-preview',
  ];

  it.each(NEW_GEN)('omits temperature/top_p for %s even with thinking off', async model => {
    const body = await captureSendBody({ model, temperature: 0.7 });
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
  });

  it('omits top_p for a new-gen model even when topP is supplied', async () => {
    const body = await captureSendBody({ model: 'claude-sonnet-5', topP: 0.9 });
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
  });

  it.each(NEW_GEN)('uses adaptive+summarized thinking for %s', async model => {
    const body = await captureSendBody({ model, profileParameters: THINKING_ON });
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
  });

  it('streamMessage also omits sampling params and uses adaptive thinking', async () => {
    const body = await captureStreamBody({
      model: 'claude-opus-4-8',
      temperature: 0.5,
      profileParameters: THINKING_ON,
    });
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
  });
});

describe('AnthropicProvider — older models keep the classic shape', () => {
  const OLD_GEN = ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5', 'claude-3-5-sonnet-latest'];

  it.each(OLD_GEN)('sends temperature for %s', async model => {
    const body = await captureSendBody({ model, temperature: 0.7 });
    expect(body.temperature).toBe(0.7);
  });

  it('defaults temperature to 1.0 for an older model when none is provided', async () => {
    const body = await captureSendBody({ model: 'claude-opus-4-6' });
    expect(body.temperature).toBe(1.0);
  });

  it.each(OLD_GEN)('uses fixed-budget thinking for %s', async model => {
    const body = await captureSendBody({
      model,
      profileParameters: { thinkingBudget: 2048 },
    });
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
    // fixed-budget thinking also forbids sampling params
    expect(body.temperature).toBeUndefined();
  });

  it('streamMessage keeps fixed-budget thinking for older models', async () => {
    const body = await captureStreamBody({
      model: 'claude-sonnet-4-6',
      profileParameters: { thinkingBudget: 2048 },
    });
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
  });
});

describe('AnthropicProvider — prefix boundary is exact', () => {
  it('does not treat claude-opus-4-6 as new-gen', async () => {
    const body = await captureSendBody({ model: 'claude-opus-4-6', temperature: 0.3 });
    expect(body.temperature).toBe(0.3);
  });

  it('treats a dated claude-opus-4-8 snapshot as new-gen', async () => {
    const body = await captureSendBody({ model: 'claude-opus-4-8-20260215', temperature: 0.3 });
    expect(body.temperature).toBeUndefined();
  });
});
