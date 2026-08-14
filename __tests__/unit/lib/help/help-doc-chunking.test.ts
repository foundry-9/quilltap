/**
 * Help Doc Chunking Unit Tests
 *
 * Covers the slicing of a help document into section chunks, and the text
 * actually handed to the embedding provider for each one.
 */

import { describe, it, expect } from '@jest/globals'

jest.mock('@/lib/logger', () => {
  const base: Record<string, unknown> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
  base.child = jest.fn(() => base)
  return { __esModule: true, logger: base }
})

import { buildHelpDocChunks, helpChunkEmbeddingText } from '@/lib/help/help-doc-chunking'

/** A document long enough to force more than one chunk. */
function longDocument(sections: number): string {
  const filler = 'Words about the subject at hand, repeated for length. '.repeat(60)
  return Array.from({ length: sections }, (_, i) =>
    `## Section ${i}\n\n${filler}`
  ).join('\n\n')
}

describe('buildHelpDocChunks', () => {
  it('returns nothing for empty input', () => {
    expect(buildHelpDocChunks('')).toEqual([])
    expect(buildHelpDocChunks('   \n\n  ')).toEqual([])
  })

  it('keeps a short document as a single chunk', () => {
    const chunks = buildHelpDocChunks('# Title\n\nA brief paragraph.')

    expect(chunks.length).toBe(1)
    expect(chunks[0].chunkIndex).toBe(0)
    expect(chunks[0].content).toContain('A brief paragraph.')
  })

  it('splits a long document into several chunks with sequential indices', () => {
    const chunks = buildHelpDocChunks(longDocument(6))

    expect(chunks.length).toBeGreaterThan(1)
    chunks.forEach((chunk, i) => {
      expect(chunk.chunkIndex).toBe(i)
    })
  })

  it('carries the nearest heading on each chunk', () => {
    const chunks = buildHelpDocChunks(longDocument(6))

    // Every chunk of a document built entirely from `## Section N` headings
    // should know which section it came from.
    expect(chunks.every(chunk => chunk.heading?.startsWith('Section'))).toBe(true)
  })

  it('produces chunks small enough to be worth the exercise', () => {
    const chunks = buildHelpDocChunks(longDocument(8))

    // 700-token target at ~4 chars/token, plus the overlap prefix. The point of
    // the assertion is that one chunk never swallows the whole document.
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThan(4200)
    }
  })
})

describe('helpChunkEmbeddingText', () => {
  it('prefixes the document title and heading', () => {
    const text = helpChunkEmbeddingText('Chat Settings', 'Image Description Settings', 'Body text.')

    expect(text).toBe('Chat Settings › Image Description Settings\n\nBody text.')
  })

  it('falls back to the title alone when a chunk has no heading', () => {
    expect(helpChunkEmbeddingText('Chat Settings', null, 'Body text.'))
      .toBe('Chat Settings\n\nBody text.')
    expect(helpChunkEmbeddingText('Chat Settings', undefined, 'Body text.'))
      .toBe('Chat Settings\n\nBody text.')
  })
})
