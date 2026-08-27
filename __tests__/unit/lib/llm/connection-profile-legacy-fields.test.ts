/**
 * The seeding rules for connection-profile columns an older archive cannot
 * carry. Both backup restore and `.qtap` import go through this helper, so a
 * change here moves both paths at once — which is the point of it existing.
 */

import { seedLegacyConnectionProfileFields } from '@/lib/llm/connection-profile-legacy-fields'
import { profileUsesNamePrefill } from '@/lib/llm/multi-character-prefill'

describe('seedLegacyConnectionProfileFields', () => {
  describe('supportsImageUpload (4.3+, DEFAULT 0)', () => {
    it.each(['OPENAI', 'ANTHROPIC', 'GOOGLE', 'GROK'])(
      'seeds true for %s, which had the capability before the flag existed',
      (provider) => {
        expect(seedLegacyConnectionProfileFields({ provider }).supportsImageUpload).toBe(true)
      }
    )

    it.each(['OLLAMA', 'OPENROUTER', 'CUSTOM'])(
      'seeds false for %s, which did not',
      (provider) => {
        expect(seedLegacyConnectionProfileFields({ provider }).supportsImageUpload).toBe(false)
      }
    )

    it('never overrides a stored false on an image-capable provider', () => {
      const seeded = seedLegacyConnectionProfileFields({ provider: 'OPENAI', supportsImageUpload: false })
      expect(seeded.supportsImageUpload).toBe(false)
    })

    it('never overrides a stored true on a provider outside the historic map', () => {
      const seeded = seedLegacyConnectionProfileFields({ provider: 'OLLAMA', supportsImageUpload: true })
      expect(seeded.supportsImageUpload).toBe(true)
    })

    it.each(['openai', 'Anthropic', 'gOoGlE'])(
      'matches %s case-insensitively',
      (provider) => {
        // ProviderEnum is z.string().min(1) — a plugin-supplied id, not a closed
        // enum — so an archive can carry any casing. An exact-case match would
        // quietly seed these to false and strip vision from a profile that had it.
        expect(seedLegacyConnectionProfileFields({ provider }).supportsImageUpload).toBe(true)
      }
    )

    it('seeds false rather than throwing when the archive carries no provider', () => {
      expect(seedLegacyConnectionProfileFields({}).supportsImageUpload).toBe(false)
    })

    it.each([
      ['a number', 42],
      ['a boolean', true],
      ['an object', { name: 'openai' }],
      ['an array', ['openai']],
    ])('seeds false rather than throwing when the provider is %s (bug 105)', (_label, provider) => {
      // A bundle is untrusted data. `??` guards only null/undefined, so
      // anything else reached `.toUpperCase` and threw a TypeError out of a
      // helper the import loop called outside its per-item try — one bad
      // record aborted the whole import.
      const seeded = seedLegacyConnectionProfileFields({ provider } as never)
      expect(seeded.supportsImageUpload).toBe(false)
    })
  })

  describe('multiCharacterPrefill (4.9+, DEFAULT 1)', () => {
    it('seeds an explicit null so the column reads as "never chosen"', () => {
      // Absent would let SQLite's DEFAULT 1 decide; null is the tri-state's
      // third value and the only one profileUsesNamePrefill() defers on.
      const seeded = seedLegacyConnectionProfileFields({ provider: 'ANTHROPIC' })
      expect(seeded.multiCharacterPrefill).toBeNull()
    })

    it('leaves an Anthropic profile resolving to the provider default (prefill off)', () => {
      const seeded = seedLegacyConnectionProfileFields({ provider: 'ANTHROPIC' })
      expect(profileUsesNamePrefill(seeded)).toBe(false)
    })

    it('leaves a non-hostile provider resolving to the provider default (prefill on)', () => {
      const seeded = seedLegacyConnectionProfileFields({ provider: 'OPENAI' })
      expect(profileUsesNamePrefill(seeded)).toBe(true)
    })

    it.each([true, false])('never overrides a stored %s', (stored) => {
      const seeded = seedLegacyConnectionProfileFields({
        provider: 'ANTHROPIC',
        multiCharacterPrefill: stored,
      })
      expect(seeded.multiCharacterPrefill).toBe(stored)
      expect(profileUsesNamePrefill(seeded)).toBe(stored)
    })

    it('never overrides a stored null', () => {
      const seeded = seedLegacyConnectionProfileFields({
        provider: 'OPENAI',
        multiCharacterPrefill: null,
      })
      expect(seeded.multiCharacterPrefill).toBeNull()
    })
  })

  it('returns a copy and leaves the archive record untouched', () => {
    const archived = { provider: 'OPENAI', name: 'A Profile' }
    const seeded = seedLegacyConnectionProfileFields(archived)

    expect(seeded).not.toBe(archived)
    expect(archived).toEqual({ provider: 'OPENAI', name: 'A Profile' })
    expect(seeded).toMatchObject({ provider: 'OPENAI', name: 'A Profile' })
  })
})
