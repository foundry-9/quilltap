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

  it('is off for a profile that will run a thinking turn, on any provider', () => {
    // Bug 85: DeepSeek 400s on continuing a thinking turn whose
    // `reasoning_content` it never saw; bug 68: Ollama never opens the
    // reasoning block behind a prefilled turn.
    for (const provider of ['DEEPSEEK', 'OLLAMA', 'OPENAI', 'Z_AI']) {
      expect(defaultMultiCharacterPrefill(provider, true)).toBe(false)
    }
    expect(defaultMultiCharacterPrefill(null, true)).toBe(false)
  })

  it('keeps the prefill for a thinking-capable provider that is not thinking', () => {
    // Bug 68 rejected a blanket provider rule for precisely this: the prefill
    // is the stronger anchor, and weak non-thinking models need it most.
    expect(defaultMultiCharacterPrefill('DEEPSEEK', false)).toBe(true)
    expect(defaultMultiCharacterPrefill('OLLAMA', false)).toBe(true)
  })

  it('leaves Anthropic off whether or not it is thinking', () => {
    // Anthropic's is the one genuine provider rule: it rejects an assistant
    // tail outright, thinking or not.
    expect(defaultMultiCharacterPrefill('ANTHROPIC', false)).toBe(false)
    expect(defaultMultiCharacterPrefill('ANTHROPIC', true)).toBe(false)
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

  it('lets a stored true outrank the thinking default', () => {
    // The tri-state exists so the user may overrule us. Bug 85 seeds the
    // right default and warns in the editor; it does not veto.
    expect(
      profileUsesNamePrefill({ provider: 'DEEPSEEK', multiCharacterPrefill: true }, true)
    ).toBe(true)
  })

  it('falls back to the thinking-aware default when the profile never chose', () => {
    expect(profileUsesNamePrefill({ provider: 'DEEPSEEK' }, true)).toBe(false)
    expect(profileUsesNamePrefill({ provider: 'DEEPSEEK' }, false)).toBe(true)
    expect(profileUsesNamePrefill({ provider: 'DEEPSEEK', multiCharacterPrefill: null }, true)).toBe(
      false
    )
  })

  it('does not mistake false for absent', () => {
    // The whole point of the tri-state: an Anthropic profile the user
    // deliberately turned ON must not be silently read back as OFF, and a
    // non-Anthropic profile turned OFF must not be read back as ON.
    expect(profileUsesNamePrefill({ provider: 'OPENAI', multiCharacterPrefill: false })).toBe(false)
    expect(profileUsesNamePrefill({ provider: 'ANTHROPIC', multiCharacterPrefill: true })).toBe(true)
  })
})
