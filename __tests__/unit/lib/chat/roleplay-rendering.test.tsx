/**
 * @jest-environment node
 *
 * Unit + cross-renderer equivalence tests for the shared roleplay-rendering core.
 *
 * The whole point of `lib/chat/roleplay-rendering.ts` is that the client renderer
 * (React nodes) and the server renderer (HTML string) derive from ONE tokenizer,
 * so they can't drift. These tests:
 *   1. lock `tokenizeInline` / `lineMatchFor` / `compileRenderingPatterns` behavior, and
 *   2. assert the React adapter and the HTML emit-helper serialize the SAME
 *      Segment[] to identical markup.
 */

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RenderingPattern } from '@/lib/schemas/template.types'
import {
  type Segment,
  compileRenderingPatterns,
  tokenizeInline,
  lineMatchFor,
  wrapBlockMatchFor,
  segmentsToHtml,
  escapeMarkdownInBrackets,
} from '@/lib/chat/roleplay-rendering'

// Common inline rules mirroring DEFAULT_RENDERING_PATTERNS.
const INLINE_PATTERNS: RenderingPattern[] = [
  { pattern: '(?<!\\*)\\*[^*]+\\*(?!\\*)', className: 'qt-chat-narration' },
  { pattern: '\\[[^\\]]+\\](?!\\()', className: 'qt-chat-narration' },
  { pattern: '(?<!\\{)\\{[^{}]+\\}(?!\\})', className: 'qt-chat-inner-monologue' },
  { pattern: '["\\u201c][^"\\u201d]+["\\u201d]', className: 'qt-chat-dialogue' },
]

/** The React adapter, replicated from MessageContent.segmentsToReactNodes. */
function segmentsToReactNodes(segments: Segment[]): React.ReactNode[] {
  return segments.map((seg, i) =>
    seg.className ? <span key={i} className={seg.className}>{seg.text}</span> : seg.text,
  )
}

describe('roleplay-rendering core', () => {
  describe('compileRenderingPatterns', () => {
    it('strips the global flag (matching walks manually)', () => {
      const [rule] = compileRenderingPatterns([{ pattern: 'x', className: 'c', flags: 'g' }])
      expect(rule.regex.flags).not.toContain('g')
    })

    it('defaults legacy patterns (no scope) to inline', () => {
      const [rule] = compileRenderingPatterns([{ pattern: '^// .+$', className: 'qt-chat-ooc', flags: 'm' }])
      expect(rule.scope).toBe('inline')
    })

    it('preserves an explicit line scope', () => {
      const [rule] = compileRenderingPatterns([
        { pattern: '^// .+$', className: 'qt-chat-ooc', flags: 'm', scope: 'line' },
      ])
      expect(rule.scope).toBe('line')
    })

    it('keeps the u flag for unicode patterns', () => {
      const [rule] = compileRenderingPatterns([
        { pattern: '^\\[(?:[^\\p{Ll}]+)\\].*$', className: 'qt-chat-tag', flags: 'mu', scope: 'line' },
      ])
      expect(rule.regex.flags).toContain('u')
    })
  })

  describe('tokenizeInline', () => {
    const rules = compileRenderingPatterns(INLINE_PATTERNS)

    it('returns a single plain segment for unmatched text', () => {
      expect(tokenizeInline('plain text', rules)).toEqual([{ text: 'plain text' }])
    })

    it('returns [] for empty input', () => {
      expect(tokenizeInline('', rules)).toEqual([])
    })

    it('wraps a single inline match with surrounding plain runs', () => {
      expect(tokenizeInline('hello *world* end', rules)).toEqual([
        { text: 'hello ' },
        { text: '*world*', className: 'qt-chat-narration' },
        { text: ' end' },
      ])
    })

    it('picks the earliest match across rules, in document order', () => {
      expect(tokenizeInline('a [b] c *d*', rules)).toEqual([
        { text: 'a ' },
        { text: '[b]', className: 'qt-chat-narration' },
        { text: ' c ' },
        { text: '*d*', className: 'qt-chat-narration' },
      ])
    })

    it('does NOT treat a [text](url) link as bracket narration', () => {
      // The (?!\() lookahead in the bracket rule excludes markdown links.
      expect(tokenizeInline('see [docs](http://x) here', rules)).toEqual([
        { text: 'see [docs](http://x) here' },
      ])
    })

    it('ignores line-scoped rules (they are applied at the block level)', () => {
      const lineRules = compileRenderingPatterns([
        { pattern: '^// .+$', className: 'qt-chat-ooc', flags: 'm', scope: 'line' },
      ])
      expect(tokenizeInline('// an ooc line', lineRules)).toEqual([{ text: '// an ooc line' }])
    })

    it('still matches a legacy inline-scoped // pattern inline (no behavior change)', () => {
      const legacy = compileRenderingPatterns([{ pattern: '^// .+$', className: 'qt-chat-ooc', flags: 'm' }])
      expect(tokenizeInline('// an ooc line', legacy)).toEqual([
        { text: '// an ooc line', className: 'qt-chat-ooc' },
      ])
    })
  })

  describe('lineMatchFor (class projection)', () => {
    const oocRule = compileRenderingPatterns([
      { pattern: '^// .+$', className: 'qt-chat-ooc', flags: 'm', scope: 'line' },
    ])
    const tagRule = compileRenderingPatterns([
      { pattern: '^\\[(?:[^\\p{Ll}]+)\\].*$', className: 'qt-chat-tag', flags: 'mu', scope: 'line' },
    ])

    it('returns the class when the whole block is one matching line', () => {
      expect(lineMatchFor('// out of character', oocRule)?.className).toBe('qt-chat-ooc')
    })

    it('returns undefined for a mixed multi-line block', () => {
      expect(lineMatchFor('// ooc line\nnormal line', oocRule)?.className).toBeUndefined()
    })

    it('returns undefined when nothing matches', () => {
      expect(lineMatchFor('just narration', oocRule)?.className).toBeUndefined()
    })

    it('ignores inline-scoped rules', () => {
      const inlineOoc = compileRenderingPatterns([{ pattern: '^// .+$', className: 'qt-chat-ooc', flags: 'm' }])
      expect(lineMatchFor('// ooc', inlineOoc)?.className).toBeUndefined()
    })

    it('matches an uppercase tag token (the [CAPTAIN] case)', () => {
      expect(lineMatchFor('[CAPTAIN] All hands on deck!', tagRule)?.className).toBe('qt-chat-tag')
    })

    it('rejects a lowercase tag token', () => {
      expect(lineMatchFor('[captain] all hands', tagRule)?.className).toBeUndefined()
    })

    it('accepts non-Latin uppercase / non-cased tag tokens', () => {
      expect(lineMatchFor('[ÇÉ] hola', tagRule)?.className).toBe('qt-chat-tag')
      expect(lineMatchFor('[漢字] greetings', tagRule)?.className).toBe('qt-chat-tag')
    })
  })

  describe('hide delimiters', () => {
    it('emits only the inner content for a hidden inline wrap', () => {
      const rules = compileRenderingPatterns([
        { pattern: '(?<!\\+)\\+(?<rpBody>[^+]+)\\+(?!\\+)', className: 'qt-chat-narration', hideDelimiters: true },
      ])
      expect(tokenizeInline('a +narr+ b', rules)).toEqual([
        { text: 'a ' },
        { text: 'narr', className: 'qt-chat-narration' },
        { text: ' b' },
      ])
    })

    it('keeps the delimiters when hide is off', () => {
      const rules = compileRenderingPatterns([
        { pattern: '(?<!\\+)\\+(?<rpBody>[^+]+)\\+(?!\\+)', className: 'qt-chat-narration' },
      ])
      expect(tokenizeInline('a +narr+ b', rules)).toEqual([
        { text: 'a ' },
        { text: '+narr+', className: 'qt-chat-narration' },
        { text: ' b' },
      ])
    })

    it('lineMatchFor returns the prefix and stripped body for a linePrefix', () => {
      const rules = compileRenderingPatterns([
        { pattern: '^// (?<rpBody>.+)$', className: 'qt-chat-ooc', flags: 'm', scope: 'line', hideDelimiters: true },
      ])
      expect(lineMatchFor('// an ooc line', rules)).toEqual({
        className: 'qt-chat-ooc',
        hideDelimiters: true,
        prefix: '// ',
        body: 'an ooc line',
      })
    })

    it('lineMatchFor strips the [TAG] for a tagPrefix, keeping the body', () => {
      const rules = compileRenderingPatterns([
        { pattern: '^\\[(?:[^\\p{Ll}]+)\\](?<rpBody>.*)$', className: 'qt-chat-tag', flags: 'mu', scope: 'line', hideDelimiters: true },
      ])
      expect(lineMatchFor('[CAPTAIN] all hands', rules)).toEqual({
        className: 'qt-chat-tag',
        hideDelimiters: true,
        prefix: '[CAPTAIN]',
        body: ' all hands',
      })
    })

    it('projects just the class via ?.className', () => {
      const rules = compileRenderingPatterns([
        { pattern: '^// (?<rpBody>.+)$', className: 'qt-chat-ooc', flags: 'm', scope: 'line', hideDelimiters: true },
      ])
      expect(lineMatchFor('// ooc', rules)?.className).toBe('qt-chat-ooc')
    })
  })

  describe('cross-renderer equivalence (React adapter === HTML emit)', () => {
    const rules = compileRenderingPatterns(INLINE_PATTERNS)
    const cases = [
      'plain text only',
      'hello *world* end',
      'a [b] c *d*',
      'mix {thoughts} and *action* together',
    ]

    it.each(cases)('serializes identically for: %s', (input) => {
      const segments = tokenizeInline(input, rules)
      const html = segmentsToHtml(segments)
      const react = renderToStaticMarkup(<>{segmentsToReactNodes(segments)}</>)
      expect(react).toBe(html)
    })
  })

  describe('wrapBlockMatchFor (whole-block hidden wraps)', () => {
    // The "Covenant RP" narration delimiter: +…+, delimiters hidden.
    const narrationRule = compileRenderingPatterns([
      {
        pattern: '(?<!\\+)\\+(?<rpBody>[^+]+)\\+(?!\\+)',
        className: 'qt-chat-narration qt-rp-italic',
        hideDelimiters: true,
      },
    ])

    it('matches a block that is wholly a hidden wrap, returning the delimiters to strip', () => {
      expect(wrapBlockMatchFor('+the room holds its breath+', narrationRule)).toEqual({
        className: 'qt-chat-narration qt-rp-italic',
        prefix: '+',
        suffix: '+',
      })
    })

    it('trims surrounding whitespace before matching the whole block', () => {
      expect(wrapBlockMatchFor('  +narration+  ', narrationRule)?.className).toBe(
        'qt-chat-narration qt-rp-italic',
      )
    })

    it('does NOT match when the wrap is only part of the block (inline)', () => {
      expect(wrapBlockMatchFor('she said +softly+ to him', narrationRule)).toBeUndefined()
    })

    it('does NOT match a different open/close pair where they are not both present', () => {
      expect(wrapBlockMatchFor('+ unbalanced', narrationRule)).toBeUndefined()
    })

    it('ignores a wrap rule that shows its delimiters (no block restyle)', () => {
      const shown = compileRenderingPatterns([
        { pattern: '(?<!\\+)\\+(?<rpBody>[^+]+)\\+(?!\\+)', className: 'qt-chat-narration' },
      ])
      expect(wrapBlockMatchFor('+narration+', shown)).toBeUndefined()
    })

    it('ignores line-scoped rules', () => {
      const lineRule = compileRenderingPatterns([
        { pattern: '^// (?<rpBody>.+)$', className: 'qt-chat-ooc', flags: 'm', scope: 'line', hideDelimiters: true },
      ])
      expect(wrapBlockMatchFor('// ooc line', lineRule)).toBeUndefined()
    })

    it('reports a multi-character open/close pair (e.g. ((…)) )', () => {
      const oocHidden = compileRenderingPatterns([
        { pattern: '\\(\\((?<rpBody>[^)]+)\\)\\)', className: 'qt-chat-ooc', hideDelimiters: true },
      ])
      expect(wrapBlockMatchFor('((an aside))', oocHidden)).toEqual({
        className: 'qt-chat-ooc',
        prefix: '((',
        suffix: '))',
      })
    })
  })

  describe('escapeMarkdownInBrackets', () => {
    const BRACKET: RenderingPattern = { pattern: '\\[[^\\]]+\\](?!\\()', className: 'qt-chat-narration' }
    // A SHOWN-delimiter custom wrap (e.g. OOC ((…)) ): interior must be escaped.
    const OOC_SHOWN: RenderingPattern = {
      pattern: '\\(\\((?<rpBody>[^)]+)\\)\\)',
      className: 'qt-chat-ooc',
    }
    // A HIDDEN-delimiter custom wrap (e.g. +…+ narration): interior must be LEFT
    // ALONE so its markdown renders, then the block is restyled via wrapBlockMatchFor.
    const NARRATION_HIDDEN: RenderingPattern = {
      pattern: '(?<!\\+)\\+(?<rpBody>[^+]+)\\+(?!\\+)',
      className: 'qt-chat-narration qt-rp-italic',
      hideDelimiters: true,
    }

    it('returns content unchanged when no relevant patterns', () => {
      expect(escapeMarkdownInBrackets('text *with* stars', [])).toBe('text *with* stars')
    })

    it('escapes markdown chars inside [...] when bracket narration present', () => {
      const result = escapeMarkdownInBrackets('[narration with *emphasis*]', [BRACKET])
      expect(result).toContain('\\*')
    })

    it('escapes the interior of a SHOWN custom wrap (generic rpBody path)', () => {
      const result = escapeMarkdownInBrackets('((aside with *stars* and _us_))', [OOC_SHOWN])
      expect(result).toContain('\\*')
      expect(result).toContain('\\_')
      // Delimiters themselves are untouched.
      expect(result.startsWith('((')).toBe(true)
      expect(result.endsWith('))')).toBe(true)
    })

    it('leaves a HIDDEN wrap interior un-escaped so its markdown renders', () => {
      const content = '+al-Latif called his father *Father* in public+'
      expect(escapeMarkdownInBrackets(content, [NARRATION_HIDDEN])).toBe(content)
    })

    it('handles a mix: skip the hidden wrap, escape the shown one', () => {
      const content = '+narration *kept*+ and ((aside *escaped*))'
      const result = escapeMarkdownInBrackets(content, [NARRATION_HIDDEN, OOC_SHOWN])
      expect(result).toContain('+narration *kept*+') // hidden wrap untouched
      expect(result).toContain('((aside \\*escaped\\*))') // shown wrap escaped
    })

    it('preserves fenced code blocks unchanged', () => {
      const content = '[bracket] then ```[in code] *stars*``` end'
      const result = escapeMarkdownInBrackets(content, [BRACKET])
      expect(result).toContain('[in code] *stars*')
    })
  })
})
