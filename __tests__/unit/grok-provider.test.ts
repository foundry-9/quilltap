/**
 * GrokProvider attachment tests.
 *
 * Bug 33 regression: Grok's mime gate was images-only and ran first, making the
 * text/* and PDF branches behind it dead code. The gate now admits text/* (sent
 * inline) and PDF (routed to the honest Files-API message), while genuinely
 * unsupported binaries still get the generic rejection.
 *
 * Bug 34 regression: a text attachment's base64 decode relied on a try/catch
 * that never fires (Buffer.from(s,'base64') mangles rather than throws). A
 * newline-free, base64-charset text file must now arrive verbatim, while a
 * genuine base64 payload still decodes.
 *
 * The `openai` default export is already a jest.fn (mocked in jest.setup.ts);
 * we override its implementation per test to supply a `responses.create` mock
 * that records the request the provider builds.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import OpenAI from 'openai'
import { GrokProvider } from '@/plugins/dist/qtap-plugin-grok/provider'
import type { LLMParams } from '@/plugins/dist/qtap-plugin-grok/types'

/** Install a fresh mock client and return its `responses.create` mock. */
function primeClient(): jest.Mock {
  const create = jest.fn().mockResolvedValue({
    output_text: 'ok',
    output: [],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    status: 'completed',
  })
  ;(OpenAI as unknown as jest.Mock).mockImplementation(() => ({
    responses: { create },
    models: { list: jest.fn() },
  }))
  return create
}

function paramsWithAttachment(mimeType: string, data: string, filename: string): LLMParams {
  return {
    model: 'grok-4',
    messages: [
      {
        role: 'user',
        content: 'Here is a file',
        attachments: [{ id: 'att-1', filename, mimeType, size: data.length, data }],
      },
    ],
  } as unknown as LLMParams
}

/** The text of the user message's input_text parts in the captured request. */
function sentUserTexts(create: jest.Mock): string[] {
  const req = create.mock.calls[0][0] as { input: any[] }
  const userItem = req.input.find((i) => i.type === 'message' && i.role === 'user')
  return (userItem?.content ?? [])
    .filter((p: any) => p.type === 'input_text')
    .map((p: any) => p.text)
}

describe('GrokProvider attachments (Bugs 33, 34)', () => {
  let provider: GrokProvider

  beforeEach(() => {
    jest.clearAllMocks()
    provider = new GrokProvider()
  })

  it('ships a text/* attachment inline (Bug 33 gate now admits text)', async () => {
    const create = primeClient()
    const res = await provider.sendMessage(
      paramsWithAttachment('text/markdown', 'a plain note', 'note.md'),
      'sk-test'
    )

    expect(res.attachmentResults?.sent).toContain('att-1')
    expect(res.attachmentResults?.failed).toHaveLength(0)
    expect(sentUserTexts(create).some((t) => t.includes('a plain note'))).toBe(true)
  })

  it('routes a PDF to the honest Files-API message, not the generic rejection (Bug 33)', async () => {
    primeClient()
    const res = await provider.sendMessage(
      paramsWithAttachment('application/pdf', 'JVBERi0=', 'doc.pdf'),
      'sk-test'
    )

    expect(res.attachmentResults?.sent).not.toContain('att-1')
    const failure = res.attachmentResults?.failed.find((f) => f.id === 'att-1')
    expect(failure?.error).toMatch(/Grok Files API/i)
  })

  it('still gives a genuinely unsupported binary the generic rejection (Bug 33)', async () => {
    primeClient()
    const res = await provider.sendMessage(
      paramsWithAttachment('application/zip', 'UEsDBAo=', 'archive.zip'),
      'sk-test'
    )

    const failure = res.attachmentResults?.failed.find((f) => f.id === 'att-1')
    expect(failure?.error).toMatch(/Unsupported file type/i)
  })

  it.each(['hello', 'x=1'])('keeps base64-charset text %p verbatim (Bug 34)', async (raw) => {
    const create = primeClient()
    await provider.sendMessage(paramsWithAttachment('text/plain', raw, 'note.txt'), 'sk-test')
    expect(sentUserTexts(create).some((t) => t.includes(raw))).toBe(true)
  })

  it('still decodes a genuine base64 text payload (Bug 34)', async () => {
    const create = primeClient()
    const encoded = Buffer.from('the quick brown fox', 'utf-8').toString('base64')
    await provider.sendMessage(paramsWithAttachment('text/plain', encoded, 'note.txt'), 'sk-test')
    const texts = sentUserTexts(create)
    expect(texts.some((t) => t.includes('the quick brown fox'))).toBe(true)
    // The raw base64 must not leak through as literal text.
    expect(texts.some((t) => t.includes(encoded))).toBe(false)
  })
})
