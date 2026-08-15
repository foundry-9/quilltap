/**
 * The generated opening greeting runs through the provider's streaming
 * endpoint like any other turn, so a thinking model reasons before it speaks.
 * That reasoning used to be dropped on the floor: the chunk loop read
 * `chunk.content` and nothing else, so a greeting could cost thousands of
 * reasoning characters and render no thinking fold at all.
 */

import { generateGreetingMessage } from '@/lib/chat/initial-greeting'

const streamMessage = jest.fn()

jest.mock('@/lib/llm', () => ({
  createLLMProvider: jest.fn(async () => ({
    streamMessage: (...args: unknown[]) => streamMessage(...args),
  })),
}))

jest.mock('@/lib/llm/cache-key', () => ({
  buildCharacterCacheKey: jest.fn(() => 'cache-key'),
}))

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('@/lib/services/llm-logging.service', () => ({
  logLLMCall: jest.fn(async () => undefined),
}))

function stream(chunks: Array<Record<string, unknown>>) {
  streamMessage.mockImplementation(async function* () {
    for (const chunk of chunks) yield chunk
  })
}

const request = {
  systemPrompt: 'You are Marie.',
  characterName: 'Marie',
  provider: 'OLLAMA',
  modelName: 'qwen3',
}

describe('generateGreetingMessage — reasoning capture', () => {
  beforeEach(() => {
    streamMessage.mockReset()
  })

  it('keeps the last cumulative reasoning value, not a concatenation of them', async () => {
    // Providers emit reasoningContent CUMULATIVELY — the full thinking-so-far
    // on every chunk that grows it. Concatenating would triple the text.
    stream([
      { reasoningContent: 'Let me' },
      { reasoningContent: 'Let me think' },
      { reasoningContent: 'Let me think about it.' },
      { content: 'Well hello there.' },
    ])

    const result = await generateGreetingMessage(request)

    expect(result.reasoningContent).toBe('Let me think about it.')
    expect(result.content).toBe('Well hello there.')
  })

  it('interleaves reasoning and content without either polluting the other', async () => {
    stream([
      { reasoningContent: 'thinking' },
      { content: 'Well ' },
      { reasoningContent: 'thinking harder' },
      { content: 'hello.' },
    ])

    const result = await generateGreetingMessage(request)

    expect(result.reasoningContent).toBe('thinking harder')
    expect(result.content).toBe('Well hello.')
  })

  it('returns empty reasoning for a model that produced none', async () => {
    stream([{ content: 'Well hello there.' }])

    const result = await generateGreetingMessage(request)

    expect(result.reasoningContent).toBe('')
    expect(result.content).toBe('Well hello there.')
  })

  it('still reports a content-filter hit, with reasoning captured', async () => {
    stream([
      { reasoningContent: 'deliberating' },
      { usage: { promptTokens: 100, completionTokens: 40, totalTokens: 140 } },
    ])

    const result = await generateGreetingMessage(request)

    expect(result.content).toBe('')
    expect(result.contentFilterDetected).toBe(true)
    expect(result.reasoningContent).toBe('deliberating')
  })
})
