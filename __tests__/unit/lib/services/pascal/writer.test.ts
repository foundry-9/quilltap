/**
 * Pascal's outcome announcement.
 *
 * The body is the tool's title and the author's message, and nothing else.
 * These tests mostly pin what must NOT be there: the croupier's voice, the
 * roll, and any trace of who reached for the tool or what they set.
 */

import { buildPascalResultContent } from '@/lib/services/pascal/writer'

const BASE = {
  toolTitle: 'Force the Lock',
  message: 'The lock clicks open.',
}

describe('buildPascalResultContent', () => {
  it('is a heading paragraph, then the message as its own block', () => {
    expect(buildPascalResultContent(BASE).content).toBe('🎲 **Force the Lock**\n\nThe lock clicks open.')
  })

  it('names the tool by its title, never its declaration name', () => {
    const { content } = buildPascalResultContent(BASE)
    expect(content).toContain('Force the Lock')
    expect(content).not.toContain('force_the_lock')
  })

  it('renders the author\'s message verbatim', () => {
    const message = 'The lock — *reluctantly* — gives way. It reads 14 µK.'
    expect(buildPascalResultContent({ ...BASE, message }).content).toContain(message)
  })

  it('trims the message but never revoices it', () => {
    const { content } = buildPascalResultContent({ ...BASE, message: '   Still locked.   ' })
    expect(content).toBe('🎲 **Force the Lock**\n\nStill locked.')
  })

  it('lets a message that opens with a list item be a list', () => {
    // The blank line is the point of the two-block form: a leading block token
    // must start its own Markdown block, not glue inline to the bold heading.
    const { content } = buildPascalResultContent({ ...BASE, message: '- Jackie (3 nodes)\n- Marlow (1 node)' })
    expect(content).toBe('🎲 **Force the Lock**\n\n- Jackie (3 nodes)\n- Marlow (1 node)')
  })

  it('lets a message that opens with a heading be a heading', () => {
    const { content } = buildPascalResultContent({ ...BASE, message: '# Dossier' })
    expect(content).toBe('🎲 **Force the Lock**\n\n# Dossier')
  })

  describe('the chip label as heading', () => {
    it('uses the rendered chipLabel when present — one string for chip and bubble', () => {
      const { content } = buildPascalResultContent({ ...BASE, chipLabel: 'Agent lambda — Jackie' })
      expect(content).toBe('🎲 **Agent lambda — Jackie**\n\nThe lock clicks open.')
    })

    it('falls back to the title when the chipLabel renders blank', () => {
      const { content } = buildPascalResultContent({ ...BASE, chipLabel: '   ' })
      expect(content).toBe('🎲 **Force the Lock**\n\nThe lock clicks open.')
    })
  })

  describe('what the croupier no longer says', () => {
    it('does not speak in his own voice', () => {
      // The body carries no persona: no "Pascal", no wheel, no behest.
      const { content } = buildPascalResultContent(BASE)
      expect(content).not.toMatch(/Pascal/i)
      expect(content).not.toMatch(/behest|spins the wheel/i)
    })

    it('does not report what fell', () => {
      // The roll lives in pascalMeta. An author who wants the number read out
      // puts {{value}} or {{dice}} in the message themselves.
      expect(buildPascalResultContent(BASE).content).not.toMatch(/\(rolled/)
    })
  })

  describe('the opaque body', () => {
    it('is identical to the visible one', () => {
      // The dual body exists to keep Staff NAMES from an opaque character.
      // With no persona framing left there is nothing to strip.
      const { content, opaqueContent } = buildPascalResultContent(BASE)
      expect(opaqueContent).toBe(content)
    })

    it('is still populated, per the opaqueContent contract', () => {
      expect(buildPascalResultContent(BASE).opaqueContent).toBeTruthy()
    })
  })
})
