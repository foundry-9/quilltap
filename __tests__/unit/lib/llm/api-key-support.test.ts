/**
 * "Must this provider hold a key?" and "may it?" are two questions.
 *
 * They were one flag until bug 81, and OpenAI-Compatible is where that broke:
 * the same provider points at an unauthenticated llama.cpp on localhost *and*
 * at a hosted endpoint behind a bearer token. `requiresApiKey: false` was the
 * only workable answer, and it then removed the provider from the Add-New-API-
 * Key list and from the profile form's key field alike — a hosted
 * OpenAI-compatible endpoint could not be configured at all.
 *
 * Both defaults below are the load-bearing part. `acceptsApiKey` omitted must
 * mean "same answer as requiresApiKey", or every plugin predating the
 * capability changes behaviour the moment this module ships.
 */

import { providerAcceptsApiKey, providerRequiresApiKey } from '@/lib/llm/api-key-support'

describe('providerRequiresApiKey', () => {
  it('reads the flag when it is given', () => {
    expect(providerRequiresApiKey({ requiresApiKey: true })).toBe(true)
    expect(providerRequiresApiKey({ requiresApiKey: false })).toBe(false)
  })

  it('defaults to true when the requirements have not loaded', () => {
    expect(providerRequiresApiKey(null)).toBe(true)
    expect(providerRequiresApiKey(undefined)).toBe(true)
    expect(providerRequiresApiKey({})).toBe(true)
  })
})

describe('providerAcceptsApiKey', () => {
  it('reads the explicit capability when a plugin declares it', () => {
    expect(providerAcceptsApiKey({ requiresApiKey: false, acceptsApiKey: true })).toBe(true)
    expect(providerAcceptsApiKey({ requiresApiKey: true, acceptsApiKey: false })).toBe(false)
  })

  it('falls back to requiresApiKey for a plugin that predates the capability', () => {
    expect(providerAcceptsApiKey({ requiresApiKey: true })).toBe(true)
    expect(providerAcceptsApiKey({ requiresApiKey: false })).toBe(false)
  })

  it('defaults to true when nothing is known', () => {
    expect(providerAcceptsApiKey(null)).toBe(true)
    expect(providerAcceptsApiKey(undefined)).toBe(true)
    expect(providerAcceptsApiKey({})).toBe(true)
  })
})

describe('the three provider shapes', () => {
  it('wholly hosted (Anthropic, OpenAI, Google): must and may', () => {
    const hosted = { requiresApiKey: true }
    expect(providerRequiresApiKey(hosted)).toBe(true)
    expect(providerAcceptsApiKey(hosted)).toBe(true)
  })

  it('wholly local (Ollama): must not and may not — no field is offered', () => {
    const local = { requiresApiKey: false }
    expect(providerRequiresApiKey(local)).toBe(false)
    expect(providerAcceptsApiKey(local)).toBe(false)
  })

  it('OpenAI-Compatible (bug 81): need not, but may — the field is offered and optional', () => {
    const oac = { requiresApiKey: false, acceptsApiKey: true }
    expect(providerRequiresApiKey(oac)).toBe(false)
    expect(providerAcceptsApiKey(oac)).toBe(true)
  })
})
