import { describe, expect, it } from '@jest/globals'

import {
  defaultMultiCharacterPrefill,
  profileUsesNamePrefill,
} from '@/lib/llm/multi-character-prefill'

describe('defaultMultiCharacterPrefill', () => {
  it('is off for Anthropic — 4.6+ rejects a request ending on an assistant message', () => {
    expect(defaultMultiCharacterPrefill('ANTHROPIC')).toBe(false)
  })

  it('matches the provider case-insensitively', () => {
    expect(defaultMultiCharacterPrefill('anthropic')).toBe(false)
  })

  it('is on for every other provider — the historic behaviour', () => {
    for (const provider of ['OPENAI', 'OLLAMA', 'DEEPSEEK', 'GROK', 'Z_AI', 'OPENROUTER']) {
      expect(defaultMultiCharacterPrefill(provider)).toBe(true)
    }
  })

  it('is on when the provider is unknown', () => {
    expect(defaultMultiCharacterPrefill(null)).toBe(true)
    expect(defaultMultiCharacterPrefill(undefined)).toBe(true)
    expect(defaultMultiCharacterPrefill('')).toBe(true)
  })
})

describe('profileUsesNamePrefill', () => {
  it('honours an explicit true, even on a provider that defaults off', () => {
    expect(profileUsesNamePrefill({ provider: 'ANTHROPIC', multiCharacterPrefill: true })).toBe(true)
  })

  it('honours an explicit false, even on a provider that defaults on', () => {
    expect(profileUsesNamePrefill({ provider: 'OLLAMA', multiCharacterPrefill: false })).toBe(false)
  })

  it('falls back to the provider default when the profile never chose', () => {
    // Rows older than add-profile-multi-character-prefill-field-v1, and
    // profiles imported from a pre-4.9 bundle, arrive with null here.
    expect(profileUsesNamePrefill({ provider: 'ANTHROPIC', multiCharacterPrefill: null })).toBe(false)
    expect(profileUsesNamePrefill({ provider: 'OPENAI', multiCharacterPrefill: null })).toBe(true)
    expect(profileUsesNamePrefill({ provider: 'ANTHROPIC' })).toBe(false)
    expect(profileUsesNamePrefill({ provider: 'OPENAI' })).toBe(true)
  })

  it('does not mistake false for absent', () => {
    // The whole point of the tri-state: an Anthropic profile the user
    // deliberately turned ON must not be silently read back as OFF, and a
    // non-Anthropic profile turned OFF must not be read back as ON.
    expect(profileUsesNamePrefill({ provider: 'OPENAI', multiCharacterPrefill: false })).toBe(false)
    expect(profileUsesNamePrefill({ provider: 'ANTHROPIC', multiCharacterPrefill: true })).toBe(true)
  })
})
