/**
 * OllamaProvider streaming decoder tests.
 *
 * Bug 35 regression: the stream decoder split each network read on '\n' with no
 * cross-read buffer, so a JSON object straddling two reads was silently lost.
 * Feeding the same body chopped at arbitrary byte boundaries must yield the same
 * content as feeding it whole.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

import { OllamaProvider } from '@/plugins/dist/qtap-plugin-ollama/provider'
import type { LLMParams } from '@/plugins/dist/qtap-plugin-ollama/types'

const NDJSON_LINES = [
  { model: 'llama3', message: { role: 'assistant', content: 'Hello ' }, done: false },
  { model: 'llama3', message: { role: 'assistant', content: 'strange ' }, done: false },
  { model: 'llama3', message: { role: 'assistant', content: 'new world' }, done: false },
  {
    model: 'llama3',
    message: { role: 'assistant', content: '!' },
    done: true,
    prompt_eval_count: 11,
    eval_count: 4,
  },
]

const BODY = NDJSON_LINES.map((l) => JSON.stringify(l)).join('\n') + '\n'

/** A fake reader that hands out the given byte chunks, then done. */
function fakeReaderFromChunks(chunks: Uint8Array[]) {
  let i = 0
  return {
    read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }),
    releaseLock: () => {},
  }
}

/** Slice a string's UTF-8 bytes into fixed-size chunks (straddles object boundaries). */
function chopIntoChunks(text: string, size: number): Uint8Array[] {
  const bytes = new TextEncoder().encode(text)
  const chunks: Uint8Array[] = []
  for (let o = 0; o < bytes.length; o += size) {
    chunks.push(bytes.slice(o, o + size))
  }
  return chunks
}

function mockFetchWithChunks(chunks: Uint8Array[]) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    body: { getReader: () => fakeReaderFromChunks(chunks) },
    text: async () => '',
  })
}

async function collectStream(provider: OllamaProvider) {
  const params = { model: 'llama3', messages: [{ role: 'user', content: 'hi' }] } as unknown as LLMParams
  let content = ''
  let finalUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined
  for await (const chunk of provider.streamMessage(params, '')) {
    content += chunk.content
    if (chunk.done && chunk.usage) finalUsage = chunk.usage
  }
  return { content, finalUsage }
}

describe('OllamaProvider streaming decoder (Bug 35)', () => {
  const originalFetch = global.fetch
  let provider: OllamaProvider

  beforeEach(() => {
    provider = new OllamaProvider('http://localhost:11434')
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('loses no content when the body arrives in one chunk', async () => {
    global.fetch = mockFetchWithChunks(chopIntoChunks(BODY, BODY.length + 10)) as unknown as typeof fetch
    const { content, finalUsage } = await collectStream(provider)
    expect(content).toBe('Hello strange new world!')
    expect(finalUsage).toEqual({ promptTokens: 11, completionTokens: 4, totalTokens: 15 })
  })

  it.each([1, 3, 7, 13, 29])('loses no content when the body is chopped every %d bytes', async (size) => {
    global.fetch = mockFetchWithChunks(chopIntoChunks(BODY, size)) as unknown as typeof fetch
    const { content, finalUsage } = await collectStream(provider)
    expect(content).toBe('Hello strange new world!')
    expect(finalUsage).toEqual({ promptTokens: 11, completionTokens: 4, totalTokens: 15 })
  })

  it('flushes a final newline-less tail', async () => {
    // Same body without the trailing newline — the last object must still flush.
    const noTrailingNewline = BODY.replace(/\n$/, '')
    global.fetch = mockFetchWithChunks(chopIntoChunks(noTrailingNewline, 5)) as unknown as typeof fetch
    const { content, finalUsage } = await collectStream(provider)
    expect(content).toBe('Hello strange new world!')
    expect(finalUsage).toEqual({ promptTokens: 11, completionTokens: 4, totalTokens: 15 })
  })
})
