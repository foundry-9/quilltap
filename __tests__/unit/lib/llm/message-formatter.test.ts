import {
  getProviderNameSupport,
  supportsNameField,
  formatParticipantName,
  formatMessagesForProvider,
  normalizeContentBlockFormat,
  truncateAtForeignSpeaker,
} from '@/lib/llm/message-formatter'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
  },
}))

describe('message formatter utilities', () => {
  describe('provider name support', () => {
    it('returns provider specific configuration when known', () => {
      const support = getProviderNameSupport('OPENAI')
      expect(support.supportsNameField).toBe(true)
      expect(support.supportedRoles).toContain('assistant')
      expect(support.maxNameLength).toBe(64)
    })

    it('falls back to conservative defaults for unknown providers', () => {
      const support = getProviderNameSupport('UNKNOWN' as any)
      expect(support.supportsNameField).toBe(false)
      expect(support.supportedRoles).toHaveLength(0)
    })

    it('reports whether a role supports the name field', () => {
      expect(supportsNameField('OPENAI', 'user')).toBe(true)
      expect(supportsNameField('ANTHROPIC', 'assistant')).toBe(false)
    })
  })

  describe('formatParticipantName', () => {
    it('sanitizes invalid characters, collapses whitespace, and enforces max length', () => {
      const formatted = formatParticipantName('Dr. Strange@! Example Name', 10)
      expect(formatted).toBe('Dr_Strange')
    })

    it('returns fallback when name becomes empty', () => {
      const formatted = formatParticipantName('???', 5)
      expect(formatted).toBe('Unknown')
    })
  })

  describe('formatMessagesForProvider', () => {
    const messages = [
      { role: 'system' as const, content: 'Rules' },
      { role: 'user' as const, content: 'Hello', name: 'Alicia Keys' },
      { role: 'assistant' as const, content: 'Hi', name: 'Lyra', thoughtSignature: 'sig' },
    ]

    it('inlines [Name] prefix on user turns and uses native name field for assistant turns when supported', () => {
      const formatted = formatMessagesForProvider(messages, 'OPENAI', 'Lyra')
      expect(formatted[0]).toEqual({ role: 'system', content: 'Rules' })
      expect(formatted[1]).toMatchObject({
        role: 'user',
        name: 'Alicia_Keys',
        content: '[Alicia Keys] Hello',
      })
      expect(formatted[2]).toMatchObject({ role: 'assistant', name: 'Lyra', content: 'Hi', thoughtSignature: 'sig' })
    })

    it('prefixes content when provider lacks name field support', () => {
      const formatted = formatMessagesForProvider(messages, 'ANTHROPIC', 'Lyra')
      expect(formatted[1]).toEqual({ role: 'user', content: '[Alicia Keys] Hello' })
      expect(formatted[2]).toEqual({ role: 'assistant', content: '[Lyra] Hi', thoughtSignature: 'sig' })
    })

    it('does not double-prefix user turns whose content already starts with [Name]', () => {
      const prefixed = [
        { role: 'user' as const, content: '[Alicia Keys] Already tagged', name: 'Alicia Keys' },
      ]
      const formatted = formatMessagesForProvider(prefixed, 'OPENAI', 'Lyra')
      expect(formatted[0]).toMatchObject({
        role: 'user',
        content: '[Alicia Keys] Already tagged',
        name: 'Alicia_Keys',
      })
    })

    // DISPLAY-ONLY GUARD: a character's stored reasoning ("thinking") must never
    // be re-fed to any model via history. Even if a history message carries
    // reasoningContent, the provider-shaped output must not include it.
    it('never carries reasoningContent into the provider-shaped history', () => {
      const withReasoning = [
        { role: 'system' as const, content: 'Rules', reasoningContent: 'system should-not-appear' },
        { role: 'user' as const, content: 'Hello', name: 'Alicia Keys', reasoningContent: 'user should-not-appear' },
        { role: 'assistant' as const, content: 'Hi', name: 'Lyra', thoughtSignature: 'sig', reasoningContent: 'secret chain-of-thought' },
      ] as unknown as Parameters<typeof formatMessagesForProvider>[0]

      for (const provider of ['OPENAI', 'ANTHROPIC', 'GOOGLE', 'DEEPSEEK'] as const) {
        const formatted = formatMessagesForProvider(withReasoning, provider, 'Lyra')
        for (const m of formatted) {
          expect(m).not.toHaveProperty('reasoningContent')
          expect(JSON.stringify(m)).not.toContain('should-not-appear')
          expect(JSON.stringify(m)).not.toContain('secret chain-of-thought')
        }
      }
    })
  })

  describe('normalizeContentBlockFormat', () => {
    it('returns normal text content unchanged', () => {
      const content = 'This is a normal response from an LLM.'
      expect(normalizeContentBlockFormat(content)).toBe(content)
    })

    it('returns empty string for empty input', () => {
      expect(normalizeContentBlockFormat('')).toBe('')
    })

    it('returns null/undefined unchanged', () => {
      expect(normalizeContentBlockFormat(null as unknown as string)).toBe(null)
      expect(normalizeContentBlockFormat(undefined as unknown as string)).toBe(undefined)
    })

    it('extracts text from Python-style content block format', () => {
      const wrapped = `[{'type': 'text', 'text': "This is the actual response content."}]`
      expect(normalizeContentBlockFormat(wrapped)).toBe('This is the actual response content.')
    })

    it('extracts text from JSON-style content block format', () => {
      const wrapped = `[{"type": "text", "text": "This is the actual response content."}]`
      expect(normalizeContentBlockFormat(wrapped)).toBe('This is the actual response content.')
    })

    it('handles multiline content in Python-style format', () => {
      const multiline = `[{'type': 'text', 'text': "First line.\\n\\nSecond line with [brackets].\\n\\nThird line."}]`
      expect(normalizeContentBlockFormat(multiline)).toBe('First line.\\n\\nSecond line with [brackets].\\n\\nThird line.')
    })

    it('handles content with special characters and formatting', () => {
      const wrapped = `[{'type': 'text', 'text': "[Tina] *She smiles.* \\"Hello!\\""}]`
      expect(normalizeContentBlockFormat(wrapped)).toBe('[Tina] *She smiles.* \\"Hello!\\"')
    })

    it('does not modify content that starts with [ but is not content block format', () => {
      const content = '[Character Name] This is roleplay content with a name prefix.'
      expect(normalizeContentBlockFormat(content)).toBe(content)
    })

    it('does not modify array-like content that is not content block format', () => {
      const content = '[item1, item2, item3]'
      expect(normalizeContentBlockFormat(content)).toBe(content)
    })

    it('handles whitespace around the content block', () => {
      const wrapped = `  [{'type': 'text', 'text': "Extracted content"}]  `
      expect(normalizeContentBlockFormat(wrapped)).toBe('Extracted content')
    })
  })

  describe('truncateAtForeignSpeaker', () => {
    const others = ['Charlie', 'Friday', 'Amy']

    it('truncates at the first foreign [Name] tag and right-trims', () => {
      const input = "Abigail's own turn, fully in voice.\n\n[Charlie] I think the bug is...\n\n[Friday] The numbers hit me."
      const { text, truncatedAt } = truncateAtForeignSpeaker(input, others)
      expect(text).toBe("Abigail's own turn, fully in voice.")
      expect(truncatedAt).not.toBeNull()
    })

    it('truncates at a "Name:" speaker label at line start', () => {
      const input = 'My line here.\nCharlie: stop that.'
      const { text } = truncateAtForeignSpeaker(input, others)
      expect(text).toBe('My line here.')
    })

    it('leaves a clean single-character response untouched', () => {
      const input = 'Just my own dialogue and *actions*, no one else.'
      const { text, truncatedAt } = truncateAtForeignSpeaker(input, others)
      expect(text).toBe(input)
      expect(truncatedAt).toBeNull()
    })

    it('does not match roleplay action tags or prose mentions of a name', () => {
      const input = 'I told Charlie: meet me later. [*sighs*] [Whisper sent.]'
      const { text, truncatedAt } = truncateAtForeignSpeaker(input, others)
      // "Charlie:" is mid-line (prose), not a line-start speaker label.
      expect(text).toBe(input)
      expect(truncatedAt).toBeNull()
    })

    it('reports truncatedAt=0 when the response opens with a foreign tag', () => {
      const input = '[Charlie] hijacking from the very start.'
      const { text, truncatedAt } = truncateAtForeignSpeaker(input, others)
      expect(truncatedAt).toBe(0)
      expect(text).toBe('')
    })

    it('is a no-op with no foreign names (single-character chat)', () => {
      const input = '[Charlie] this would be a tag, but no roster supplied.'
      const { text, truncatedAt } = truncateAtForeignSpeaker(input, [])
      expect(text).toBe(input)
      expect(truncatedAt).toBeNull()
    })

    it('does not truncate on the speaker’s own name (only foreign names are passed)', () => {
      // Caller passes ONLY other participants; Abigail tagging herself isn't here.
      const input = 'A line.\n[Abigail] still me, second paragraph.'
      const { text, truncatedAt } = truncateAtForeignSpeaker(input, others)
      expect(text).toBe(input)
      expect(truncatedAt).toBeNull()
    })
  })
})
