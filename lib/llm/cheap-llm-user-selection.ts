/**
 * Cheap-LLM selection for a user's whole profile set.
 *
 * `getCheapLLMProvider` (cheap-llm.ts) wants a "current profile" to fall back
 * on, but the background and tool paths that consult a cheap model outside a
 * chat turn have no such profile — they all used to read every profile, pick
 * the default-flagged one (else the first), build the config from chat
 * settings, and run the ladder with Ollama detection off. That prologue lives
 * here, once.
 *
 * Kept apart from cheap-llm.ts so the pure selection ladder stays free of
 * repository types and so tests that stub the ladder still exercise this
 * plumbing for real.
 */

import { logger } from '@/lib/logger'
import type { ConnectionProfile } from '@/lib/schemas/types'
import type { CheapLLMSettings } from '@/lib/schemas/settings.types'
import {
  buildCheapLLMConfig,
  getCheapLLMProvider,
  type CheapLLMConfig,
  type CheapLLMSelection,
} from '@/lib/llm/cheap-llm'

/** What the ladder chose, plus the inputs callers usually go on to need. */
export interface UserCheapLLMSelection {
  selection: CheapLLMSelection
  /** The profile the ladder falls back on: the default-flagged one, else the first. */
  defaultProfile: ConnectionProfile
  /** Every profile considered — for a later uncensored reroute or override lookup. */
  allProfiles: ConnectionProfile[]
}

/** The read surface `resolveCheapLLMSelectionForUser` needs. */
export interface CheapLLMSelectionRepos {
  connections: { findByUserId(userId: string): Promise<ConnectionProfile[]> }
}

/**
 * Run the cheap-LLM ladder over an already-loaded profile set, falling back on
 * the default-flagged profile (else the first). Returns null when there are no
 * profiles at all. Ollama availability is not probed (`ollamaAvailable=false`),
 * matching every caller this replaced.
 */
export function selectCheapLLMFromProfiles(
  allProfiles: ConnectionProfile[],
  config: CheapLLMConfig,
): UserCheapLLMSelection | null {
  const defaultProfile = allProfiles.find(p => p.isDefault) || allProfiles[0]
  if (!defaultProfile) {
    logger.debug('[CheapLLM] No connection profiles to select a cheap LLM from', {
      context: 'selectCheapLLMFromProfiles',
    })
    return null
  }
  const selection = getCheapLLMProvider(defaultProfile, config, allProfiles, false)
  logger.debug('[CheapLLM] Selected cheap LLM for user profile set', {
    context: 'selectCheapLLMFromProfiles',
    defaultProfileId: defaultProfile.id,
    provider: selection.provider,
    modelName: selection.modelName,
    connectionProfileId: selection.connectionProfileId,
  })
  return { selection, defaultProfile, allProfiles }
}

/**
 * Load a user's connection profiles and run {@link selectCheapLLMFromProfiles}
 * with the config derived from their chat settings. Returns null when the user
 * has no profiles.
 */
export async function resolveCheapLLMSelectionForUser(
  repos: CheapLLMSelectionRepos,
  userId: string,
  chatSettings: { cheapLLMSettings?: CheapLLMSettings | null } | null | undefined,
): Promise<UserCheapLLMSelection | null> {
  const allProfiles = await repos.connections.findByUserId(userId)
  return selectCheapLLMFromProfiles(allProfiles, buildCheapLLMConfig(chatSettings))
}
