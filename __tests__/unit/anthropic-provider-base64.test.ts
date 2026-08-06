/**
 * AnthropicProvider text-attachment base64 tests.
 *
 * Bug 34 regression: a text/plain attachment's decode relied on a try/catch
 * that never fires (Buffer.from(s,'base64') mangles rather than throws), so a
 * newline-free, base64-charset text file shipped as mojibake. The round-trip
 * check keeps genuine plain text verbatim while still decoding real base64.
 *
 * The @anthropic-ai/sdk default export is already a jest.fn (mocked in
 * jest.setup.ts). We override its implementation per test so a captured
 * `create` mock records the exact request the provider builds.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import Anthropic from '@anthropic-ai/sdk'
import { AnthropicProvider } from '@/plugins/dist/qtap-plugin-anthropic/provider'
import type { LLMParams } from '@/plugins/dist/qtap-plugin-anthropic/types'

function textParams(data: string): LLMParams {
  return {
    model: 'claude-3-5-sonnet',
    messages: [
      {
        role: 'user',
        content: 'Here is a file',
        attachments: [{ id: 'att-1', filename: 'note.txt', mimeType: 'text/plain', size: data.length, data }],
      },
    ],
  } as unknown as LLMParams
}

/** Install a fresh mock client and return its `create` mock. */
function primeClient(): jest.Mock {
  const create = jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'ok' }],
    usage: { input_tokens: 1, output_tokens: 1 },
    stop_reason: 'end_turn',
  })
  ;(Anthropic as unknown as jest.Mock).mockImplementation(() => ({
    apiKey: 'x',
    messages: { create, stream: jest.fn() },
  }))
  return create
}

/** The `data` of the text/plain document blocks in the captured request. */
function sentTextDocuments(create: jest.Mock): string[] {
  const req = create.mock.calls[0][0] as { messages: any[] }
  const out: string[] = []
  for (const m of req.messages) {
    if (!Array.isArray(m.content)) continue
    for (const block of m.content) {
      if (block.type === 'document' && block.source?.type === 'text') {
        out.push(block.source.data)
      }
    }
  }
  return out
}

describe('AnthropicProvider text attachments (Bug 34)', () => {
  let provider: AnthropicProvider

  beforeEach(() => {
    jest.clearAllMocks()
    provider = new AnthropicProvider()
  })

  it.each(['hello', 'x=1'])('keeps base64-charset plain text %p verbatim', async (raw) => {
    const create = primeClient()
    await provider.sendMessage(textParams(raw), 'sk-test')
    expect(sentTextDocuments(create)).toContain(raw)
  })

  it('still decodes a genuine base64 text payload', async () => {
    const create = primeClient()
    const encoded = Buffer.from('the quick brown fox', 'utf-8').toString('base64')
    await provider.sendMessage(textParams(encoded), 'sk-test')
    const docs = sentTextDocuments(create)
    expect(docs).toContain('the quick brown fox')
    expect(docs).not.toContain(encoded)
  })
})
