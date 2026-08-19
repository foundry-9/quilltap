/**
 * Bug 82 — three leading system messages break strict local chat templates.
 *
 * The context builder deliberately emits the head of a turn as up to three
 * consecutive `system` messages so a cache breakpoint on the first survives
 * churn in the others. A hosted provider accepts that; a local runtime applies
 * the *model's own* chat template, and the Qwen family `raise_exception` on any
 * system message after index 0 — so the opening greeting (one system message)
 * worked and every turn after it died with a 500.
 *
 * Asserted here:
 *   - Ollama and OpenAI-Compatible fold the leading run into one message, in
 *     order, on both the streaming and non-streaming paths
 *   - a system message that is *not* in the leading run is left where it is
 *   - a hosted subclass of the same base class (DeepSeek) is untouched — the
 *     regression that matters, since folding there would cost the cache prefix
 */

import { OllamaProvider } from '@/plugins/dist/qtap-plugin-ollama/provider'
import { OpenAICompatibleEndpointProvider } from '@/plugins/dist/qtap-plugin-openai-compatible/provider'
import { DeepSeekProvider } from '@/plugins/dist/qtap-plugin-deepseek/provider'
import { collapseLeadingSystemMessages } from '@/packages/plugin-utils/src/providers/system-messages'
import type { LLMParams } from '@/plugins/dist/qtap-plugin-ollama/types'

jest.mock('openai', () => {
  const create = jest.fn()
  const ctor = jest.fn().mockImplementation(() => ({
    chat: { completions: { create } },
    models: { list: jest.fn() },
  }))
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

/** The shape a normal (non-opening) turn actually reaches a provider with. */
const THREE_BLOCK_TURN = [
  { role: 'system', content: 'PERSONA' },
  { role: 'system', content: 'REINFORCEMENT' },
  { role: 'system', content: 'SUMMARY' },
  { role: 'user', content: 'hello' },
  { role: 'assistant', content: 'hi' },
  { role: 'user', content: 'again' },
]

const turnParams = (messages: unknown[]) =>
  ({ model: 'qwen3.5-9b-q6', messages } as unknown as LLMParams)

// ---------------------------------------------------------------------------
// The helper itself
// ---------------------------------------------------------------------------

describe('collapseLeadingSystemMessages', () => {
  it('joins the leading run in order, with a blank line between blocks', () => {
    expect(collapseLeadingSystemMessages(THREE_BLOCK_TURN)).toEqual([
      { role: 'system', content: 'PERSONA\n\nREINFORCEMENT\n\nSUMMARY' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'again' },
    ])
  })

  it('returns the very same array when there is nothing to fold', () => {
    const one = [{ role: 'system', content: 'PERSONA' }, { role: 'user', content: 'hi' }]
    expect(collapseLeadingSystemMessages(one)).toBe(one)
    const none = [{ role: 'user', content: 'hi' }]
    expect(collapseLeadingSystemMessages(none)).toBe(none)
    const empty: { role: string; content: string }[] = []
    expect(collapseLeadingSystemMessages(empty)).toBe(empty)
  })

  it('leaves a later system message exactly where it is', () => {
    const withLate = [
      { role: 'system', content: 'A' },
      { role: 'system', content: 'B' },
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'LATE' },
    ]
    expect(collapseLeadingSystemMessages(withLate)).toEqual([
      { role: 'system', content: 'A\n\nB' },
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'LATE' },
    ])
  })

  it('skips an empty block rather than leaving a stray blank line', () => {
    expect(
      collapseLeadingSystemMessages([
        { role: 'system', content: 'A' },
        { role: 'system', content: '' },
        { role: 'system', content: 'C' },
      ])
    ).toEqual([{ role: 'system', content: 'A\n\nC' }])
  })
})

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

describe('OllamaProvider leading system messages', () => {
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
      body: {
        getReader: () => ({
          read: async () => ({ done: true, value: undefined }),
          releaseLock: () => {},
        }),
      },
    })
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  function lastBody(): any {
    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as any[]
    return JSON.parse(lastCall[1].body)
  }

  it('folds the three blocks into one on the non-streaming path', async () => {
    await provider.sendMessage(turnParams(THREE_BLOCK_TURN), '')
    const { messages } = lastBody()
    expect(messages.filter((m: any) => m.role === 'system')).toHaveLength(1)
    expect(messages[0]).toEqual({
      role: 'system',
      content: 'PERSONA\n\nREINFORCEMENT\n\nSUMMARY',
    })
    expect(messages.map((m: any) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
  })

  it('folds the three blocks into one on the streaming path', async () => {
    for await (const _chunk of provider.streamMessage(turnParams(THREE_BLOCK_TURN), '')) {
      // drain
    }
    const { messages } = lastBody()
    expect(messages.filter((m: any) => m.role === 'system')).toHaveLength(1)
    expect(messages[0].content).toBe('PERSONA\n\nREINFORCEMENT\n\nSUMMARY')
  })

  it('leaves an opening greeting — one system message — untouched', async () => {
    await provider.sendMessage(
      turnParams([
        { role: 'system', content: 'PERSONA' },
        { role: 'user', content: 'hello' },
      ]),
      ''
    )
    const { messages } = lastBody()
    expect(messages).toEqual([
      { role: 'system', content: 'PERSONA' },
      { role: 'user', content: 'hello' },
    ])
  })
})

// ---------------------------------------------------------------------------
// OpenAI-Compatible, and the hosted subclass that must NOT change
// ---------------------------------------------------------------------------

describe('OpenAI-compatible leading system messages', () => {
  beforeEach(() => {
    getCreateMock().mockReset()
    getCreateMock().mockResolvedValue(okCompletion)
  })

  it('folds the leading run for a local OpenAI-compatible endpoint', async () => {
    const provider = new OpenAICompatibleEndpointProvider('http://localhost:8080/v1')
    await provider.sendMessage(turnParams(THREE_BLOCK_TURN), '')
    const [body] = getCreateMock().mock.calls[0] as any[]
    expect(body.messages.filter((m: any) => m.role === 'system')).toHaveLength(1)
    expect(body.messages[0]).toEqual({
      role: 'system',
      content: 'PERSONA\n\nREINFORCEMENT\n\nSUMMARY',
    })
  })

  it('folds it on the streaming path too', async () => {
    getCreateMock().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'hi' }, finish_reason: null }] }
      },
    })
    const provider = new OpenAICompatibleEndpointProvider('http://localhost:8080/v1')
    for await (const _chunk of provider.streamMessage(turnParams(THREE_BLOCK_TURN), '')) {
      // drain
    }
    const [body] = getCreateMock().mock.calls[0] as any[]
    expect(body.messages.filter((m: any) => m.role === 'system')).toHaveLength(1)
  })

  // The regression that matters: a hosted subclass of the same base class keeps
  // all three blocks, so its cache breakpoints keep landing where they do today.
  it('leaves a hosted subclass of the same base class alone', async () => {
    const provider = new DeepSeekProvider()
    await provider.sendMessage(turnParams(THREE_BLOCK_TURN), 'sk-test')
    const [body] = getCreateMock().mock.calls[0] as any[]
    expect(body.messages.filter((m: any) => m.role === 'system')).toHaveLength(3)
    expect(body.messages.map((m: any) => m.role)).toEqual([
      'system',
      'system',
      'system',
      'user',
      'assistant',
      'user',
    ])
  })
})
