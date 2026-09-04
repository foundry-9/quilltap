/**
 * Shared helpers for resolving decrypted API keys from the connection-profile
 * + api-key tables. Centralizes the lookup so the cheap-LLM selection path
 * (used by both `cheap-llm-tasks/core-execution.ts` and
 * `services/dangerous-content/gatekeeper.service.ts`) doesn't carry a
 * duplicated implementation.
 *
 * `pricing-fetcher`'s `getApiKeyForProvider` and `embedding-service`'s
 * `getApiKeyForProfile` operate on different inputs (a list of profiles
 * filtered by provider; an embedding profile already in hand) and stay
 * specialized.
 */

import { getRepositories } from '@/lib/repositories/factory'
import { acceptsApiKey, requiresApiKey } from '@/lib/plugins/provider-validation'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'

/**
 * Resolve the decrypted API key for a connection profile by ID.
 * Returns null when the profile, its `apiKeyId`, or the key record itself
 * is missing.
 */
export async function getApiKeyForConnectionProfile(
  profileId: string,
  userId: string,
): Promise<string | null> {
  const repos = getRepositories()
  const profile = await repos.connections.findById(profileId)
  if (!profile?.apiKeyId) return null
  const apiKey = await repos.connections.findApiKeyByIdAndUserId(profile.apiKeyId, userId)
  return apiKey?.key_value ?? null
}

/**
 * Resolve the decrypted API key for a cheap-LLM selection.
 * Returns '' for selections that target a local model (no key needed),
 * and null when the selection has no profile or the lookup fails.
 */
export async function getApiKeyForCheapLLMSelection(
  selection: CheapLLMSelection,
  userId: string,
): Promise<string | null> {
  if (selection.isLocal) return ''
  if (!selection.connectionProfileId) return null
  return getApiKeyForConnectionProfile(selection.connectionProfileId, userId)
}

/**
 * Why a profile could not produce the API key its provider needs.
 *
 * `no-api-key-configured` — the provider demands a key and the profile names
 * none. `api-key-not-found` — the profile names one and the row is gone; a
 * dangling `apiKeyId` fails loudly even on a provider that merely *accepts* a
 * key, because the user attached it on purpose and going out unauthenticated
 * instead is the silent-wrong-answer kind of failure.
 */
export type ProfileApiKeyFailure = 'no-api-key-configured' | 'api-key-not-found'

export type ProfileApiKeyResolution =
  | { ok: true; apiKey: string }
  | { ok: false; reason: ProfileApiKeyFailure }

/**
 * The sentence adopters of {@link resolveConnectionProfileApiKey} surface for
 * a failed resolution — one wording for every console and help-chat path.
 */
export function describeProfileApiKeyFailure(reason: ProfileApiKeyFailure): string {
  return reason === 'no-api-key-configured'
    ? 'No API key configured for this connection profile'
    : 'API key not found'
}

/**
 * Resolve the decrypted API key a connection profile should send.
 *
 * Asks both questions rather than one (Bug 81): a provider that *requires* a
 * key must have one before the call goes out, and a provider that merely
 * *accepts* one — OpenAI-Compatible, whose hosted endpoints want a bearer token
 * and whose local ones do not — must still forward the key the user attached.
 * Reading only `requiresApiKey`, as every caller here once did, left an
 * OpenAI-Compatible profile's key sitting in the database while the request
 * went out bare and the endpoint answered 401.
 *
 * Returns `{ ok: true, apiKey: '' }` for a provider that takes no key at all.
 */
export async function resolveConnectionProfileApiKey(
  repos: { connections: { findApiKeyById(id: string): Promise<{ key_value: string } | null> } },
  profile: { provider: string; apiKeyId?: string | null },
): Promise<ProfileApiKeyResolution> {
  if (!acceptsApiKey(profile.provider)) return { ok: true, apiKey: '' }

  if (!profile.apiKeyId) {
    return requiresApiKey(profile.provider)
      ? { ok: false, reason: 'no-api-key-configured' }
      : { ok: true, apiKey: '' }
  }

  const apiKeyData = await repos.connections.findApiKeyById(profile.apiKeyId)
  if (!apiKeyData) return { ok: false, reason: 'api-key-not-found' }

  return { ok: true, apiKey: apiKeyData.key_value }
}
