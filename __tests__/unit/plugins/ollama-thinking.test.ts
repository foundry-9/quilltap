/**
 * Ollama thinking support tests.
 *
 * Covers the `enable_thinking` profile option and both reasoning channels:
 * - Ollama's native `message.thinking` field (server parsed the template)
 * - inline `<think>...</think>` blocks leaking into `message.content`
 *   (community GGUF imports / older servers), including tags that straddle
 *   streaming chunk boundaries
 * plus the retry-without-think fallback for models that refuse the parameter.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

import { OllamaProvider } from '@/plugins/dist/qtap-plugin-ollama/provider'
import {
  ThinkTagStreamParser,
  extractThinkBlocks,
} from '@/plugins/dist/qtap-plugin-ollama/think-parser'
import type { LLMParams } from '@/plugins/dist/qtap-plugin-ollama/types'

describe('ThinkTagStreamParser', () => {
  it('splits a whole response into content and reasoning', () => {
    const { content, reasoning } = extractThinkBlocks(
      '<think>pondering deeply</think>\n\nHello there'
    )
    expect(content).toBe('Hello there')
    expect(reasoning).toBe('pondering deeply')
  })

  it('passes a think-free response through byte-for-byte', () => {
    const text = '  leading space kept\nand newlines too '
    const { content, reasoning } = extractThinkBlocks(text)
    expect(content).toBe(text)
    expect(reasoning).toBe('')
  })

  it('treats an unterminated think block as reasoning', () => {
    const { content, reasoning } = extractThinkBlocks('<think>cut off mid-')
    expect(content).toBe('')
    expect(reasoning).toBe('cut off mid-')
  })

  it('treats a leading orphan closing tag as a swallowed think block', () => {
    // Qwen3 GGUF no-think mode: the model reasons anyway, Ollama eats the
    // opening <think>, and only the closing tag survives in the content.
    const { content, reasoning } = extractThinkBlocks(
      "Okay, let's see. The user wants JSON.\n</think>\n\n[\"cat\", \"dog\"]"
    )
    expect(content).toBe('["cat", "dog"]')
    expect(reasoning).toBe("Okay, let's see. The user wants JSON.\n")
  })

  it('leaves a stray closing tag alone once a real think block has been seen', () => {
    const { content, reasoning } = extractThinkBlocks(
      '<think>real</think>answer </think> tail'
    )
    expect(content).toBe('answer </think> tail')
    expect(reasoning).toBe('real')
  })

  it('handles multiple think blocks', () => {
    const { content, reasoning } = extractThinkBlocks(
      '<think>first</think>Answer part one <think>second</think>and two'
    )
    expect(content).toBe('Answer part one and two')
    expect(reasoning).toBe('firstsecond')
  })

  it.each([1, 2, 3, 5, 7, 11])(
    'yields identical results when fed %d chars at a time',
    (size) => {
      const text = 'Intro <think>some\nreasoning</think> and the answer<think>more</think>!'
      const parser = new ThinkTagStreamParser()
      let content = ''
      for (let i = 0; i < text.length; i += size) {
        content += parser.push(text.slice(i, i + size))
      }
      content += parser.flush()
      expect(content).toBe('Intro  and the answer!')
      expect(parser.reasoning).toBe('some\nreasoningmore')
    }
  )

  it('holds back a partial tag that never completes, then flushes it as content', () => {
    const parser = new ThinkTagStreamParser()
    let content = parser.push('half a tag <thi')
    expect(content).toBe('half a tag ')
    content += parser.push('rd of the way')
    content += parser.flush()
    expect(content).toBe('half a tag <third of the way')
    expect(parser.reasoning).toBe('')
  })
})

/** NDJSON body → fake streaming fetch Response, as in the Bug 35 suite. */
function bodyFromLines(lines: object[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
}

function chopIntoChunks(text: string, size: number): Uint8Array[] {
  const bytes = new TextEncoder().encode(text)
  const chunks: Uint8Array[] = []
  for (let o = 0; o < bytes.length; o += size) {
    chunks.push(bytes.slice(o, o + size))
  }
  return chunks
}

function fakeReaderFromChunks(chunks: Uint8Array[]) {
  let i = 0
  return {
    read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }),
    releaseLock: () => {},
  }
}

function okStreamResponse(chunks: Uint8Array[]) {
  return {
    ok: true,
    status: 200,
    body: { getReader: () => fakeReaderFromChunks(chunks) },
    text: async () => '',
  }
}

async function collectStream(provider: OllamaProvider, params: LLMParams) {
  let content = ''
  let lastReasoning: string | undefined
  let finalReasoning: string | undefined
  for await (const chunk of provider.streamMessage(params, '')) {
    content += chunk.content
    if (chunk.reasoningContent !== undefined) lastReasoning = chunk.reasoningContent
    if (chunk.done) finalReasoning = chunk.reasoningContent
  }
  return { content, lastReasoning, finalReasoning }
}

const baseParams = {
  model: 'qwen3:8b',
  messages: [{ role: 'user', content: 'hi' }],
} as unknown as LLMParams

describe('OllamaProvider thinking', () => {
  const originalFetch = global.fetch
  let provider: OllamaProvider

  beforeEach(() => {
    provider = new OllamaProvider('http://localhost:11434')
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('sends think:false by default and think:true when the profile enables it', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okStreamResponse(chopIntoChunks(bodyFromLines([
        { message: { role: 'assistant', content: 'hi' }, done: false },
        { message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 1, eval_count: 1 },
      ]), 64))
    )
    global.fetch = fetchMock as unknown as typeof fetch

    await collectStream(provider, baseParams)
    expect(JSON.parse((fetchMock.mock.calls[0] as any[])[1].body).think).toBe(false)

    await collectStream(provider, {
      ...baseParams,
      profileParameters: { enable_thinking: true },
    } as LLMParams)
    expect(JSON.parse((fetchMock.mock.calls[1] as any[])[1].body).think).toBe(true)
  })

  it('passes profileParameters.num_ctx to the wire as options.num_ctx, omitting it otherwise', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okStreamResponse(chopIntoChunks(bodyFromLines([
        { message: { role: 'assistant', content: 'hi' }, done: false },
        { message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 1, eval_count: 1 },
      ]), 64))
    )
    global.fetch = fetchMock as unknown as typeof fetch

    await collectStream(provider, {
      ...baseParams,
      profileParameters: { num_ctx: 40960 },
    } as LLMParams)
    expect(JSON.parse((fetchMock.mock.calls[0] as any[])[1].body).options.num_ctx).toBe(40960)

    await collectStream(provider, baseParams)
    expect(JSON.parse((fetchMock.mock.calls[1] as any[])[1].body).options).not.toHaveProperty('num_ctx')
  })

  it('streams native message.thinking deltas as cumulative reasoningContent', async () => {
    const body = bodyFromLines([
      { message: { role: 'assistant', content: '', thinking: 'step one, ' }, done: false },
      { message: { role: 'assistant', content: '', thinking: 'step two' }, done: false },
      { message: { role: 'assistant', content: 'The answer' }, done: false },
      { message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 5, eval_count: 5 },
    ])
    global.fetch = jest.fn().mockResolvedValue(okStreamResponse(chopIntoChunks(body, 48))) as unknown as typeof fetch

    const { content, lastReasoning, finalReasoning } = await collectStream(provider, baseParams)
    expect(content).toBe('The answer')
    expect(lastReasoning).toBe('step one, step two')
    expect(finalReasoning).toBe('step one, step two')
  })

  it.each([3, 9, 17])(
    'routes inline <think> blocks to reasoningContent when the body is chopped every %d bytes',
    async (size) => {
      // The think tags straddle both NDJSON lines and network chunks.
      const body = bodyFromLines([
        { message: { role: 'assistant', content: '<th' }, done: false },
        { message: { role: 'assistant', content: 'ink>quiet ' }, done: false },
        { message: { role: 'assistant', content: 'scheming</th' }, done: false },
        { message: { role: 'assistant', content: 'ink>\n\nHello ' }, done: false },
        { message: { role: 'assistant', content: 'world' }, done: false },
        { message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 5, eval_count: 5 },
      ])
      global.fetch = jest.fn().mockResolvedValue(okStreamResponse(chopIntoChunks(body, size))) as unknown as typeof fetch

      const { content, lastReasoning } = await collectStream(provider, baseParams)
      expect(content).toBe('Hello world')
      expect(lastReasoning).toBe('quiet scheming')
    }
  )

  it('keeps the final rawResponse content free of think blocks', async () => {
    const body = bodyFromLines([
      { message: { role: 'assistant', content: '<think>hm</think>Clean' }, done: false },
      { message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 2, eval_count: 2 },
    ])
    global.fetch = jest.fn().mockResolvedValue(okStreamResponse(chopIntoChunks(body, 32))) as unknown as typeof fetch

    let raw: any
    for await (const chunk of provider.streamMessage(baseParams, '')) {
      if (chunk.done) raw = chunk.rawResponse
    }
    expect(raw.message.content).toBe('Clean')
  })

  it('retries once without think when the model refuses the parameter', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => '{"error":"\\"qwen3:8b\\" does not support disabling thinking"}',
      })
      .mockResolvedValueOnce(
        okStreamResponse(chopIntoChunks(bodyFromLines([
          { message: { role: 'assistant', content: 'ok' }, done: false },
          { message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 1, eval_count: 1 },
        ]), 64))
      )
    global.fetch = fetchMock as unknown as typeof fetch

    const { content } = await collectStream(provider, baseParams)
    expect(content).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse((fetchMock.mock.calls[0] as any[])[1].body)).toHaveProperty('think')
    expect(JSON.parse((fetchMock.mock.calls[1] as any[])[1].body)).not.toHaveProperty('think')
  })

  it('still fails on think-unrelated errors without retrying', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => '{"error":"model \\"nope\\" not found"}',
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(collectStream(provider, baseParams)).rejects.toThrow('Ollama API error: 404')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('recovers clean content from the swallowed-opening-tag pattern in non-streaming responses', async () => {
    // Live-reproduced against hf.co/Qwen/Qwen3-8B-GGUF:Q4_K_M with think:false —
    // the shape that was corrupting cheap-LLM JSON tasks.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        message: {
          role: 'assistant',
          content:
            'Okay, the user wants a JSON array of animals. Commas, quotes, brackets. Done.\n</think>\n\n["cat", "dog", "heron"]',
        },
        done: true,
        prompt_eval_count: 10,
        eval_count: 20,
      }),
      text: async () => '',
    }) as unknown as typeof fetch

    const response = await provider.sendMessage(baseParams, '')
    expect(response.content).toBe('["cat", "dog", "heron"]')
    expect(response.reasoningContent).toBe(
      'Okay, the user wants a JSON array of animals. Commas, quotes, brackets. Done.\n'
    )
  })

  it('separates thinking from content in non-streaming responses', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        message: {
          role: 'assistant',
          content: '<think>inline musing</think>\n\nHello',
          thinking: 'native musing. ',
        },
        done: true,
        prompt_eval_count: 3,
        eval_count: 4,
      }),
      text: async () => '',
    }) as unknown as typeof fetch

    const response = await provider.sendMessage(baseParams, '')
    expect(response.content).toBe('Hello')
    expect(response.reasoningContent).toBe('native musing. inline musing')
  })
})
