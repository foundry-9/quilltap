/**
 * Fallback chains for cheap-LLM tasks.
 *
 * The cheap path speaks a different currency from the Salon: a
 * {@link CheapLLMSelection} (provider + model + baseUrl + an *optional*
 * `connectionProfileId`), not a `ConnectionProfile`. The chain logic itself is
 * identical, so this module converts between the two rather than growing a
 * second engine — the two paths drifting apart is the trap this feature was
 * warned about.
 *
 * Two shapes of selection, two answers:
 *
 *  - **Backed by a profile** — walk that profile's chain exactly as the Salon
 *    does (`fallbackProfileId`, then an optional tier pick).
 *  - **Not backed by a profile** — a pure-local Ollama pick or a
 *    provider-cheapest synthesis has nothing to hang a chain on. Those are
 *    governed by the one off-profile switch, `cheapLLMSettings.allowCheapFallback`,
 *    and draw a stand-in from the user's `isCheap` profiles.
 *
 * Everything here is a read, which is what lets it run in the forked job child
 * (whose repositories are readonly). Key decryption goes through the same
 * child-safe path the existing uncensored cheap fallback already uses.
 *
 * @module memory/cheap-llm-tasks/fallback
 */

import { buildFallbackChain, pickTierCandidate, type FallbackContext } from '@/lib/llm/fallback'
import { selectionFromProfile, type CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import type { ConnectionProfile } from '@/lib/schemas/types'

/**
 * Build the ordered list of stand-in selections for a failed cheap-LLM call.
 *
 * Returns an empty array when the route has no chain — no profile behind it
 * and `allowCheapFallback` off, or a profile that named no understudy and
 * declined a tier pick. Callers treat that as "fail as we always have".
 */
export async function buildCheapFallbackSelections(opts: {
  selection: CheapLLMSelection
  userId: string
  /** True when the failed task was itself an uncensored reroute, or the chat
   *  is dangerous — a stand-in must then be cleared for the content. */
  dangerous: boolean
  /** Profile ids already spent on this task (the primary, any uncensored retry). */
  alreadyTried: string[]
  taskType?: string
}): Promise<CheapLLMSelection[]> {
  const { selection, userId, dangerous, alreadyTried, taskType } = opts
  const repos = getRepositories()

  const context: FallbackContext = {
    userId,
    purpose: 'cheap',
    dangerous,
    // Cheap tasks are text in, text out. None of them attach an image or send
    // tools, so a stand-in needs neither capability.
    needsVision: false,
    needsTools: false,
    alreadyTried,
  }

  // --- Selection backed by a connection profile: walk its chain. ---
  if (selection.connectionProfileId) {
    const primary = await repos.connections.findById(selection.connectionProfileId)
    if (!primary) {
      logger.debug('[CheapLLM] Fallback skipped: selection names a profile that no longer exists', {
        taskType,
        connectionProfileId: selection.connectionProfileId,
      })
      return []
    }

    const chain = await buildFallbackChain(primary, repos, context)
    // The chain leads with the primary itself; it is the one route we already
    // know does not work right now.
    return chain
      .filter((candidate) => candidate.profile.id !== primary.id)
      .map((candidate) => selectionFromProfile(candidate.profile))
  }

  // --- No profile behind the selection. ---
  //
  // Read the switch here rather than threading it down through every cheap-task
  // caller: it is a single instance setting, this is the only place that wants
  // it, and `chatSettings` is a plain read the job child can make.
  const chatSettings = await repos.chatSettings.findByUserId(userId)
  const allowCheapFallback = chatSettings?.cheapLLMSettings?.allowCheapFallback === true

  if (!allowCheapFallback) {
    logger.debug('[CheapLLM] Fallback skipped: profile-less selection and allowCheapFallback is off', {
      taskType,
      provider: selection.provider,
      model: selection.modelName,
    })
    return []
  }

  const allProfiles = await repos.connections.findByUserId(userId)
  const cheapProfiles = allProfiles.filter((p) => p.isCheap)

  if (cheapProfiles.length === 0) {
    logger.debug('[CheapLLM] Fallback skipped: no isCheap profiles to draft from', {
      taskType,
      provider: selection.provider,
    })
    return []
  }

  // There is no failed *profile* to rank against, so stand in a synthetic one
  // carrying the selection's provider and no model class. Unknown-vs-unknown
  // matches and unknown-vs-known does not, which is exactly the right rule
  // here: a profile-less route has never been classified, so a classified
  // profile is not a like-for-like replacement for it.
  const syntheticFailed = {
    id: '',
    provider: selection.provider,
    modelName: selection.modelName,
    modelClass: null,
    sortIndex: 0,
  } as ConnectionProfile

  const pick = pickTierCandidate(syntheticFailed, cheapProfiles, context)
  if (!pick) return []

  logger.info('[CheapLLM] Drafted a stand-in for a profile-less cheap route', {
    taskType,
    failedProvider: selection.provider,
    failedModel: selection.modelName,
    pickedProfileId: pick.id,
    pickedProvider: pick.provider,
    pickedModel: pick.modelName,
  })

  return [selectionFromProfile(pick)]
}
