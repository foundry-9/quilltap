/**
 * Bug 71 — profile parameters must reach the wire on the local providers.
 *
 * `connection_profiles.parameters` is free-form JSON: anything a user (or the
 * schema-driven profile editor) puts there saves cleanly and reloads cleanly.
 * What the providers do with it is the whole question, and until this suite
 * existed the answer for OLLAMA was "three keys" and for OPENAI_COMPATIBLE
 * "nothing at all" — silently.
 *
 * Asserted here, for both providers:
 *   - an allow-listed key lands, in the right place on the wire
 *   - a key that is not allow-listed does NOT land
 *   - an empty string omits the key (the editor's "use the model default")
 *   - `model` / `messages` / `stream` / `tools` cannot be overridden from a
 *     profile bag that tries
 *   - Ollama sends NO `keep_alive` unless the profile asks for one (the
 *     regression guard for anyone running OLLAMA_KEEP_ALIVE)
 *
 * Plus the OpenAI-compatible base class's tool legs, which never existed.
 */

import { DeepSeekProvider } from '@/plugins/dist/qtap-plugin-deepseek/provider'
import { OllamaProvider } from '@/plugins/dist/qtap-plugin-ollama/provider'
import { OpenAICompatibleEndpointProvider } from '@/plugins/dist/qtap-plugin-openai-compatible/provider'
// The base class is the canonical implementation and lives in packages/, so it
// is exercised at its source rather than through the published copy.
import { OpenAICompatibleProvider } from '@/packages/plugin-utils/src/providers/openai-compatible'
import type { LLMParams } from '@/plugins/dist/qtap-plugin-ollama/types'

jest.mock('openai', () => {
  const create = jest.fn()
  const ctor = jest.fn().mockImplementation(() => ({
    chat: { completions: { create } },
    models: { list: jest.fn() },
  }))
  // Hung off the constructor so the test can reach the same `create` before any
  // client has been built (the provider is constructed inside each helper).
  ;(ctor as unknown as { __create: unknown }).__create = create
  return { __esModule: true, default: ctor }
})

import OpenAI from 'openai'

function getCreateMock(): jest.Mock {
  return (OpenAI as unknown as { __create: jest.Mock }).__create
}

const okCompletion = {
  choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
}

const baseParams = {
  model: 'qwen3:8b',
  messages: [{ role: 'user', content: 'hi' }],
} as unknown as LLMParams

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

describe('OllamaProvider profile parameters', () => {
  const originalFetch = global.fetch
  let provider: OllamaProvider
  let fetchMock: jest.Mock

  beforeEach(() => {
    provider = new OllamaProvider('http://localhost:11434')
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: { role: 'assistant', content: 'hi' }, done: true }),
      text: async () => '',
    })
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  /** Send one message and return the JSON body that went out. */
  async function sentBody(profileParameters?: Record<string, unknown>): Promise<any> {
    await provider.sendMessage(
      { ...baseParams, ...(profileParameters ? { profileParameters } : {}) } as LLMParams,
      ''
    )
    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as any[]
    return JSON.parse(lastCall[1].body)
  }

  it('forwards allow-listed sampling parameters into options', async () => {
    const body = await sentBody({ top_k: 20, min_p: 0, presence_penalty: 1.5, seed: 7 })
    expect(body.options.top_k).toBe(20)
    expect(body.options.min_p).toBe(0)
    expect(body.options.presence_penalty).toBe(1.5)
    expect(body.options.seed).toBe(7)
    // The hardcoded four are still there.
    expect(body.options.temperature).toBe(0.7)
    expect(body.options.num_predict).toBe(4096)
  })

  it('drops a key that is not allow-listed', async () => {
    const body = await sentBody({ top_k: 20, definitely_not_a_parameter: 'boo' })
    expect(body.options.top_k).toBe(20)
    expect(body.options).not.toHaveProperty('definitely_not_a_parameter')
    expect(body).not.toHaveProperty('definitely_not_a_parameter')
  })

  it('omits a parameter the editor left blank', async () => {
    const body = await sentBody({ top_k: '', min_p: null, seed: undefined })
    expect(body.options).not.toHaveProperty('top_k')
    expect(body.options).not.toHaveProperty('min_p')
    expect(body.options).not.toHaveProperty('seed')
  })

  it('cannot be made to retarget the request', async () => {
    const body = await sentBody({
      model: 'evil-model',
      messages: [{ role: 'user', content: 'nope' }],
      stream: true,
      tools: [{ type: 'function', function: { name: 'rm_rf' } }],
    })
    expect(body.model).toBe('qwen3:8b')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(body.stream).toBe(false)
    expect(body).not.toHaveProperty('tools')
  })

  it('still forwards num_ctx, and drops a non-positive one', async () => {
    expect((await sentBody({ num_ctx: 40960 })).options.num_ctx).toBe(40960)
    fetchMock.mockClear()
    expect((await sentBody({ num_ctx: 0 })).options).not.toHaveProperty('num_ctx')
    fetchMock.mockClear()
    expect((await sentBody()).options).not.toHaveProperty('num_ctx')
  })

  describe('keep_alive', () => {
    it('sends none at all unless the profile asks for one', async () => {
      // Load-bearing: a per-request keep_alive OVERRIDES the server's
      // OLLAMA_KEEP_ALIVE, so an unconfigured profile must stay silent.
      const body = await sentBody({ top_k: 20 })
      expect(body).not.toHaveProperty('keep_alive')
    })

    it('sends a duration as the string Ollama parses', async () => {
      expect((await sentBody({ keep_alive: '30m' })).keep_alive).toBe('30m')
    })

    it('sends the sentinels as numbers, which is the only form Ollama accepts', async () => {
      // Measured against Ollama 0.32.1: `"-1"` is rejected with
      // "time: missing unit in duration", while the number -1 is honoured.
      expect((await sentBody({ keep_alive: '-1' })).keep_alive).toBe(-1)
      fetchMock.mockClear()
      expect((await sentBody({ keep_alive: '0' })).keep_alive).toBe(0)
    })
  })

  describe('think', () => {
    it('is false by default and true when thinking is enabled', async () => {
      expect((await sentBody()).think).toBe(false)
      fetchMock.mockClear()
      expect((await sentBody({ enable_thinking: true })).think).toBe(true)
    })

    it('carries the effort level when one is chosen', async () => {
      expect((await sentBody({ enable_thinking: true, thinking_effort: 'medium' })).think).toBe(
        'medium'
      )
    })

    it('ignores an effort level while thinking is off', async () => {
      expect((await sentBody({ enable_thinking: false, thinking_effort: 'high' })).think).toBe(false)
    })

    it('falls back to plain thinking on a level Ollama would reject', async () => {
      expect((await sentBody({ enable_thinking: true, thinking_effort: 'ludicrous' })).think).toBe(
        true
      )
    })
  })
})

// ---------------------------------------------------------------------------
// OpenAI-compatible — the base class
// ---------------------------------------------------------------------------

describe('OpenAICompatibleProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('sends no profile parameters at all with the default (empty) allow-list', async () => {
    // The neutrality gate: every existing subclass must be byte-identical on
    // the wire until it opts in.
    const provider = new OpenAICompatibleProvider('http://localhost:8080/v1')
    getCreateMock().mockResolvedValue(okCompletion)

    await provider.sendMessage(
      { ...baseParams, profileParameters: { top_k: 20, reasoning_effort: 'high' } } as LLMParams,
      ''
    )

    const body = getCreateMock().mock.calls[0][0]
    expect(body).not.toHaveProperty('top_k')
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(Object.keys(body).sort()).toEqual(
      ['max_tokens', 'messages', 'model', 'stop', 'temperature', 'top_p'].sort()
    )
  })

  it('sends tools and tool_choice when the caller supplies tools, and neither otherwise', async () => {
    const provider = new OpenAICompatibleProvider('http://localhost:8080/v1')
    getCreateMock().mockResolvedValue(okCompletion)

    const tools = [{ type: 'function', function: { name: 'search_web' } }]
    await provider.sendMessage({ ...baseParams, tools } as unknown as LLMParams, '')
    expect(getCreateMock().mock.calls[0][0].tools).toEqual(tools)
    expect(getCreateMock().mock.calls[0][0].tool_choice).toBe('auto')

    await provider.sendMessage(baseParams, '')
    expect(getCreateMock().mock.calls[1][0]).not.toHaveProperty('tools')
    expect(getCreateMock().mock.calls[1][0]).not.toHaveProperty('tool_choice')
  })

  it('parses tool_calls off a non-streaming response', async () => {
    const provider = new OpenAICompatibleProvider('http://localhost:8080/v1')
    getCreateMock().mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'search_web', arguments: '{"q":"hi"}' } },
              // Some local runtimes hand back an object where OpenAI specifies
              // a JSON string; both must come back as a string.
              { id: 'call_2', type: 'function', function: { name: 'roll', arguments: { sides: 20 } } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })

    const response = await provider.sendMessage(baseParams, '')
    expect(response.toolCalls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'search_web', arguments: '{"q":"hi"}' } },
      { id: 'call_2', type: 'function', function: { name: 'roll', arguments: '{"sides":20}' } },
    ])
  })

  it('accumulates streamed tool-call fragments across deltas', async () => {
    const provider = new OpenAICompatibleProvider('http://localhost:8080/v1')
    const chunks = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search_web', arguments: '{"q":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"hi"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
    ]
    getCreateMock().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk
      },
    })

    let final: Record<string, any> | undefined
    for await (const chunk of provider.streamMessage(baseParams, '')) {
      if (chunk.done) final = chunk as unknown as Record<string, any>
    }

    expect(final?.toolCalls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'search_web', arguments: '{"q":"hi"}' } },
    ])
    // The host's tool detection reads rawResponse; it is synthesized only when
    // there are calls to report.
    expect(final?.rawResponse?.choices?.[0]?.message?.tool_calls).toHaveLength(1)
  })

  it('reports no tool calls, and no rawResponse, on an ordinary stream', async () => {
    const provider = new OpenAICompatibleProvider('http://localhost:8080/v1')
    getCreateMock().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'hi' } }] }
        yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }
      },
    })

    let final: Record<string, any> | undefined
    for await (const chunk of provider.streamMessage(baseParams, '')) {
      if (chunk.done) final = chunk as unknown as Record<string, any>
    }
    expect(final).not.toHaveProperty('toolCalls')
    expect(final).not.toHaveProperty('rawResponse')
  })
})

// ---------------------------------------------------------------------------
// OpenAI-compatible — the endpoint provider the plugin actually builds
// ---------------------------------------------------------------------------

describe('OpenAICompatibleEndpointProvider profile parameters', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getCreateMock().mockResolvedValue(okCompletion)
  })

  async function sentBody(profileParameters?: Record<string, unknown>) {
    const provider = new OpenAICompatibleEndpointProvider('http://localhost:8080/v1')
    await provider.sendMessage(
      { ...baseParams, ...(profileParameters ? { profileParameters } : {}) } as LLMParams,
      ''
    )
    return getCreateMock().mock.calls[getCreateMock().mock.calls.length - 1][0]
  }

  it('forwards allow-listed sampling parameters', async () => {
    const body = await sentBody({ top_k: 20, min_p: 0, repeat_penalty: 1.05, seed: 7, cache_prompt: true })
    expect(body.top_k).toBe(20)
    expect(body.min_p).toBe(0)
    expect(body.repeat_penalty).toBe(1.05)
    expect(body.seed).toBe(7)
    expect(body.cache_prompt).toBe(true)
  })

  it('drops a key that is not allow-listed, and cannot retarget the request', async () => {
    const body = await sentBody({
      definitely_not_a_parameter: 'boo',
      model: 'evil-model',
      messages: [{ role: 'user', content: 'nope' }],
      stream: true,
    })
    expect(body).not.toHaveProperty('definitely_not_a_parameter')
    expect(body.model).toBe('qwen3:8b')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(body.stream).toBeUndefined()
  })

  it('omits a parameter the editor left blank', async () => {
    const body = await sentBody({ reasoning_effort: '', top_k: '' })
    expect(body).not.toHaveProperty('chat_template_kwargs')
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(body).not.toHaveProperty('top_k')
  })

  it('sends reasoning_effort as a chat template kwarg, never as a flat key', async () => {
    // A flat `reasoning_effort` is accepted by the JSON parser and then never
    // seen by the template — the silent no-op this bug is about.
    const body = await sentBody({ reasoning_effort: 'medium' })
    expect(body.chat_template_kwargs).toEqual({ reasoning_effort: 'medium' })
    expect(body).not.toHaveProperty('reasoning_effort')
  })

  it('merges reasoning_effort into a chat_template_kwargs the profile already set', async () => {
    const body = await sentBody({
      chat_template_kwargs: { enable_thinking: true },
      reasoning_effort: 'high',
    })
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: true, reasoning_effort: 'high' })
  })

  it('accepts the string spelling of chat_template_kwargs from a hand-edited profile', async () => {
    const body = await sentBody({ chat_template_kwargs: '{"enable_thinking":false}' })
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false })
  })
})

// ---------------------------------------------------------------------------
// DeepSeek — the neutrality gate for the collapse onto the base class
// ---------------------------------------------------------------------------

describe('DeepSeekProvider profile parameters (unchanged by the collapse)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getCreateMock().mockResolvedValue(okCompletion)
  })

  async function sentBody(profileParameters?: Record<string, unknown>) {
    const provider = new DeepSeekProvider()
    await provider.sendMessage(
      {
        ...baseParams,
        model: 'deepseek-chat',
        ...(profileParameters ? { profileParameters } : {}),
      } as LLMParams,
      'test-key'
    )
    return getCreateMock().mock.calls[getCreateMock().mock.calls.length - 1][0]
  }

  it('still reshapes the editor’s flat thinking string into DeepSeek’s object form', async () => {
    const body = await sentBody({ thinking: 'enabled' })
    expect(body.thinking).toEqual({ type: 'enabled' })
    // …and still strips the parameters DeepSeek ignores while thinking.
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
  })

  it('still forwards an allow-listed parameter and drops everything else', async () => {
    const body = await sentBody({ reasoning_effort: 'max', logprobs: true, not_a_parameter: 'boo' })
    expect(body.reasoning_effort).toBe('max')
    expect(body.logprobs).toBe(true)
    expect(body).not.toHaveProperty('not_a_parameter')
  })

  it('still omits a parameter the editor left blank', async () => {
    const body = await sentBody({ reasoning_effort: '', thinking: '' })
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(body).not.toHaveProperty('thinking')
    // Thinking absent means the sampling parameters stay on the wire.
    expect(body.temperature).toBe(0.7)
  })
})
