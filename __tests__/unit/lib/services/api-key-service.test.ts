/**
 * Bug 81 — `resolveConnectionProfileApiKey` asks two questions, not one.
 *
 * `requiresApiKey` used to decide both whether a call may go out without a key
 * and whether an attached key may go out at all. For OpenAI-Compatible those
 * answers differ, and reading only the first left the key the user attached for
 * a hosted endpoint sitting in the database while the request went out bare.
 */

import { resolveConnectionProfileApiKey } from '@/lib/services/api-key.service'
import { acceptsApiKey, requiresApiKey } from '@/lib/plugins/provider-validation'

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/plugins/provider-validation', () => ({
  acceptsApiKey: jest.fn(),
  requiresApiKey: jest.fn(),
}))

const mockAccepts = acceptsApiKey as jest.MockedFunction<typeof acceptsApiKey>
const mockRequires = requiresApiKey as jest.MockedFunction<typeof requiresApiKey>

/** A repos stand-in holding exactly one key row. */
function reposWith(row: { key_value: string } | null) {
  return {
    connections: { findApiKeyById: jest.fn().mockResolvedValue(row) },
  }
}

/** Teach the mocks one provider's answers to the two questions. */
function provider(required: boolean, accepted: boolean) {
  mockRequires.mockReturnValue(required)
  mockAccepts.mockReturnValue(accepted)
}

describe('resolveConnectionProfileApiKey', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('sends nothing for a provider that takes no key (Ollama)', async () => {
    provider(false, false)
    const repos = reposWith({ key_value: 'sk-stale' })

    const result = await resolveConnectionProfileApiKey(repos, {
      provider: 'OLLAMA',
      apiKeyId: 'key-1',
    })

    expect(result).toEqual({ ok: true, apiKey: '' })
    // Not even looked up — the endpoint has nowhere to put it.
    expect(repos.connections.findApiKeyById).not.toHaveBeenCalled()
  })

  it('forwards the attached key for a provider that accepts but does not require one', async () => {
    provider(false, true)
    const repos = reposWith({ key_value: 'sk-together' })

    const result = await resolveConnectionProfileApiKey(repos, {
      provider: 'OPENAI_COMPATIBLE',
      apiKeyId: 'key-oac',
    })

    expect(result).toEqual({ ok: true, apiKey: 'sk-together' })
  })

  it('proceeds keyless when an accepting provider has none attached', async () => {
    provider(false, true)
    const repos = reposWith(null)

    const result = await resolveConnectionProfileApiKey(repos, {
      provider: 'OPENAI_COMPATIBLE',
      apiKeyId: null,
    })

    expect(result).toEqual({ ok: true, apiKey: '' })
    expect(repos.connections.findApiKeyById).not.toHaveBeenCalled()
  })

  it('refuses when a requiring provider has none attached', async () => {
    provider(true, true)
    const repos = reposWith(null)

    const result = await resolveConnectionProfileApiKey(repos, {
      provider: 'ANTHROPIC',
      apiKeyId: null,
    })

    expect(result).toEqual({ ok: false, reason: 'no-api-key-configured' })
  })

  it('refuses on a dangling key id even where the key is optional', async () => {
    // The user attached it on purpose; going out unauthenticated instead is the
    // silent-wrong-answer failure this whole bug is made of.
    provider(false, true)
    const repos = reposWith(null)

    const result = await resolveConnectionProfileApiKey(repos, {
      provider: 'OPENAI_COMPATIBLE',
      apiKeyId: 'key-deleted',
    })

    expect(result).toEqual({ ok: false, reason: 'api-key-not-found' })
  })

  it('forwards the key for an ordinary hosted provider', async () => {
    provider(true, true)
    const repos = reposWith({ key_value: 'sk-ant' })

    const result = await resolveConnectionProfileApiKey(repos, {
      provider: 'ANTHROPIC',
      apiKeyId: 'key-anthropic',
    })

    expect(result).toEqual({ ok: true, apiKey: 'sk-ant' })
  })
})
