/**
 * Fallback engine — the tier picker.
 *
 * The last resort in a fallback chain: when a profile and its named
 * understudy have both failed, draft ONE more candidate from the rest of the
 * user's company. One, not a list — the chain is capped at three attempts on
 * purpose, so this gets a single chance and then the call fails for real.
 *
 * Only reached when the failed profile has `allowTierFallback` on, because an
 * auto-picked replacement spends money at a provider the user did not choose
 * for this call.
 *
 * The ranking mirrors `pickAutoConfigureCandidates`
 * (`lib/services/auto-configure.service.ts`) — the one place in the codebase
 * that already ranks profiles by `modelClass` for failover — rather than
 * inventing a second notion of "similar tier".
 *
 * @module llm/fallback/tier-picker
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { getModelClass } from '@/lib/llm/model-classes'
import { providerCanTransportImages } from '@/lib/llm/image-transport'
import { acceptsApiKey, requiresApiKey } from '@/lib/plugins/provider-validation'
import type { ConnectionProfile } from '@/lib/schemas/types'
import type { FallbackContext } from './types'

const logger = createServiceLogger('FallbackTierPicker')

/**
 * Quality rank of a profile's model class. `-1` means the user never set one,
 * which is a distinct state from "set to the lowest tier" — see
 * {@link tierMatches}.
 */
function qualityOf(profile: ConnectionProfile): number {
  if (!profile.modelClass) return -1
  return getModelClass(profile.modelClass)?.quality ?? -1
}

/**
 * Whether `candidate` is of the same or better tier than the profile that
 * just failed.
 *
 * An unset `modelClass` is quality-*unknown*, not quality-zero. Unknown
 * against unknown is a match — neither profile has been classified, so the
 * comparison has nothing to say and blocking on it would make tier fallback
 * useless for the many users who never fill the field in. Unknown against a
 * known tier is a non-match in both directions: promoting an unclassified
 * profile over a Deep one could quietly downgrade the call, and demanding a
 * classification the failed profile itself lacks is arbitrary.
 */
export function tierMatches(candidate: ConnectionProfile, failed: ConnectionProfile): boolean {
  const candidateQuality = qualityOf(candidate)
  const failedQuality = qualityOf(failed)

  if (candidateQuality === -1 && failedQuality === -1) return true
  if (candidateQuality === -1 || failedQuality === -1) return false

  return candidateQuality >= failedQuality
}

/**
 * Whether a profile could actually authenticate if we sent a call through it.
 *
 * Deliberately a *static* check, not a decrypt: the picker runs on a failure
 * path, sometimes inside the forked job child, and a round trip to the key
 * table per candidate would add latency to a call that is already late. A
 * provider that takes no key at all (Ollama and friends) always passes.
 */
function hasUsableCredentials(profile: ConnectionProfile): boolean {
  if (!acceptsApiKey(profile.provider)) return true
  if (profile.apiKeyId) return true
  return !requiresApiKey(profile.provider)
}

/**
 * Pick at most one replacement for a failed profile.
 *
 * @param failed        the profile whose call just failed
 * @param allProfiles   every connection profile belonging to the user
 * @param context       what the call needs from a stand-in
 * @returns the single best candidate, or null when nobody qualifies
 */
export function pickTierCandidate(
  failed: ConnectionProfile,
  allProfiles: ConnectionProfile[],
  context: FallbackContext
): ConnectionProfile | null {
  const tried = new Set(context.alreadyTried)
  const skipped: Array<{ profileId: string; name: string; reason: string }> = []

  const eligible = allProfiles.filter((candidate) => {
    const note = (reason: string) => {
      skipped.push({ profileId: candidate.id, name: candidate.name, reason })
      return false
    }

    if (candidate.id === failed.id) return note('is the failed profile')
    if (tried.has(candidate.id)) return note('already tried on this call')

    // A Courier request is rendered as Markdown for a human to carry to an
    // external LLM by hand. Whatever that is, it is not automatic failover.
    if (candidate.transport === 'courier') return note('courier transport')

    if (!hasUsableCredentials(candidate)) return note('no usable API key')

    // Danger-safe. The reroute exists precisely because the content needs a
    // provider the user has cleared for it; drafting a mainstream model here
    // would hand the content back to the moderation that just refused it.
    if (context.dangerous && !candidate.isDangerousCompatible) {
      return note('not cleared for dangerous content')
    }

    if (context.needsVision) {
      if (!candidate.supportsImageUpload) return note('does not accept image uploads')
      // Both halves matter: a describer whose plugin drops the bytes would
      // answer from the prompt alone and invent a picture.
      if (!providerCanTransportImages(candidate.provider)) {
        return note('provider cannot transport images')
      }
    }

    // Tools are the profile's own master override. Native function-calling
    // support is NOT required — a model without it is served by the
    // pseudo-tool formats, which is what `pseudoToolMode: 'auto'` resolves to.
    if (context.needsTools && candidate.allowToolUse === false) {
      return note('tool use disabled on the profile')
    }

    if (!tierMatches(candidate, failed)) return note('model class below the failed profile')

    return true
  })

  if (skipped.length > 0) {
    logger.debug('Tier picker skipped candidates', {
      failedProfileId: failed.id,
      purpose: context.purpose,
      skipped,
    })
  }

  if (eligible.length === 0) {
    logger.debug('No tier candidate qualified', {
      failedProfileId: failed.id,
      failedProvider: failed.provider,
      purpose: context.purpose,
      consideredCount: allProfiles.length,
    })
    return null
  }

  // `ProviderEnum` is an open string — a plugin-supplied id, not a closed
  // enum — so nothing guarantees the stored casing.
  const failedProvider = failed.provider.toUpperCase()

  const ranked = [...eligible].sort((a, b) => {
    // 1. A different provider first: the failure we are routing around is
    //    usually the provider's, not the model's, and a sibling profile on the
    //    same dead endpoint will fail identically.
    const aDifferent = a.provider.toUpperCase() !== failedProvider ? 1 : 0
    const bDifferent = b.provider.toUpperCase() !== failedProvider ? 1 : 0
    if (aDifferent !== bDifferent) return bDifferent - aDifferent

    // 2. Then the best model available.
    const qualityDelta = qualityOf(b) - qualityOf(a)
    if (qualityDelta !== 0) return qualityDelta

    // 3. Then the user's own ordering, so the choice is at least predictable.
    return (a.sortIndex ?? 0) - (b.sortIndex ?? 0)
  })

  const pick = ranked[0]
  logger.info('Tier picker drafted a replacement', {
    failedProfileId: failed.id,
    failedProvider: failed.provider,
    failedModel: failed.modelName,
    pickedProfileId: pick.id,
    pickedProvider: pick.provider,
    pickedModel: pick.modelName,
    differentProvider: pick.provider.toUpperCase() !== failedProvider,
    purpose: context.purpose,
    eligibleCount: eligible.length,
  })

  return pick
}
