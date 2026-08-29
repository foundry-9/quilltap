/**
 * Fallback engine — trigger classification and chain building.
 *
 * Every connection profile gets an ordered chain of at most three attempts:
 *
 *   1. the profile itself,
 *   2. its configured understudy (`fallbackProfileId`),
 *   3. one auto-picked same-or-better-tier replacement, if `allowTierFallback`.
 *
 * Chains do **not** recurse. When profile A falls back to B, B's own
 * `fallbackProfileId` is not followed. That is what makes a cycle (A->B,
 * B->A) harmless config rather than an infinite loop, and it is why the worst
 * case is three calls no matter how the user has wired their profiles.
 *
 * There is no stickiness: a successful fallback applies to that call only.
 * The next message tries the primary again, so a transient outage heals
 * itself without the user having to notice it happened.
 *
 * @module llm/fallback/engine
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import {
  APIKeyError,
  ContentLimitError,
  ModelNotFoundError,
  NetworkError,
  RateLimitError,
  TokenLimitError,
  isContentLimitError,
  isTokenLimitError,
  isToolUnsupportedError,
} from '@/lib/llm/errors'
import { providerCanTransportImages } from '@/lib/llm/image-transport'
import { pickTierCandidate } from './tier-picker'
import type { ConnectionProfile } from '@/lib/schemas/types'
import type {
  FallbackAttempt,
  FallbackCandidate,
  FallbackContext,
  FallbackTrigger,
} from './types'

const logger = createServiceLogger('FallbackEngine')

/** Repository surface the engine needs. Narrow on purpose — the forked job
 * child hands over a read-through proxy, and everything here is a read. */
export interface FallbackRepos {
  connections: {
    findById(id: string): Promise<ConnectionProfile | null>
    findByUserId(userId: string): Promise<ConnectionProfile[]>
  }
}

/**
 * Message fragments that mean "the upstream is having a bad day" without
 * arriving as one of our typed errors. Providers reach us through plugins,
 * and a plugin that rethrows a bare `Error` with the HTTP status in the text
 * is common enough that matching on it is worth more than the tidiness of
 * insisting on the taxonomy.
 */
const PROVIDER_ERROR_PATTERNS = [
  /\b5\d\d\b/,
  /internal server error/i,
  /bad gateway/i,
  /service unavailable/i,
  /gateway timeout/i,
  /overloaded/i,
  /server had an error/i,
]

const NETWORK_ERROR_PATTERNS = [
  /timed? ?out/i,
  /timeout/i,
  /econnreset/i,
  /econnrefused/i,
  /enotfound/i,
  /socket hang up/i,
  /fetch failed/i,
  /network/i,
  /aborted/i,
]

/**
 * Classify a failure into the trigger class the chain acts on, or `null` when
 * the chain should stay out of it.
 *
 * The non-triggers are as important as the triggers:
 *
 * - **Token / content limits** already have their own in-character recovery
 *   (`attemptRequestLimitRecovery`), and a prompt too long for one model is
 *   very likely too long for its stand-in — burning the chain on it would
 *   turn one clear error into three slow ones.
 * - **Tool-unsupported** is already retried on the same profile with the
 *   tools stripped, which is a better answer than changing model.
 * - **Zod validation errors** are our bug, not the provider's. Failing over
 *   would hide it behind a second provider producing the same crash.
 */
export function classifyFallbackTrigger(error: unknown): FallbackTrigger | null {
  // Non-triggers first: these are checked before the typed-error ladder
  // because several of them arrive *as* LLMProviderError subclasses.
  if (error instanceof TokenLimitError || error instanceof ContentLimitError) return null
  if (isTokenLimitError(error) || isContentLimitError(error)) return null
  if (isToolUnsupportedError(error)) return null

  const name = error instanceof Error ? error.name : ''
  if (name === 'ZodError') return null

  if (error instanceof APIKeyError) return 'auth'
  if (error instanceof RateLimitError) return 'rate-limit'
  if (error instanceof NetworkError) return 'network'
  if (error instanceof ModelNotFoundError) return 'model-missing'

  const message = error instanceof Error ? error.message : String(error ?? '')

  // The cheap path's own deadline. Not an LLMProviderError — it is raised by
  // Quilltap, not the provider — but it means exactly the same thing to the
  // chain: this route did not answer in time, try another.
  if (name === 'CheapLLMTimeoutError') return 'network'

  if (NETWORK_ERROR_PATTERNS.some((p) => p.test(message))) return 'network'
  if (PROVIDER_ERROR_PATTERNS.some((p) => p.test(message))) return 'provider-error'

  if (/\b401\b|unauthoriz|invalid api key|authentication/i.test(message)) return 'auth'
  if (/\b429\b|rate limit|too many requests/i.test(message)) return 'rate-limit'
  if (/model.*(not found|does not exist|unknown)/i.test(message)) return 'model-missing'

  // A 4xx that is none of the above is a malformed request — ours to fix, and
  // it would be malformed at the next provider too.
  if (/\b4\d\d\b/.test(message)) return null

  // Anything left is an unattributed failure from a provider call. Treat it as
  // the provider's: the alternative is that the most common shape of plugin
  // error — a bare `Error` with a vendor message — never fails over at all.
  return 'provider-error'
}

/**
 * Whether a profile can actually receive the images this turn is carrying.
 *
 * Both halves matter, and for different reasons: `supportsImageUpload` is the
 * operator's assertion that the *model* can see, and
 * `providerCanTransportImages` is whether the *plugin* will put the bytes on
 * the wire. A profile failing either would answer from the prompt alone, or
 * be refused outright by the gateway.
 */
function canReceiveThisTurnsImages(profile: ConnectionProfile): boolean {
  return profile.supportsImageUpload === true && providerCanTransportImages(profile.provider)
}

/**
 * Build the ordered candidate list for a call: `[primary, understudy?, tierPick?]`.
 *
 * Candidates already tried on this call (`context.alreadyTried`) are dropped,
 * so a chain re-entered mid-turn — the empty-response path does exactly that
 * — never re-offers a profile that has already had its chance.
 */
export async function buildFallbackChain(
  primary: ConnectionProfile,
  repos: FallbackRepos,
  context: FallbackContext
): Promise<FallbackCandidate[]> {
  const chain: FallbackCandidate[] = []
  const claimed = new Set(context.alreadyTried)

  if (!claimed.has(primary.id)) {
    chain.push({ profile: primary, kind: 'primary' })
    claimed.add(primary.id)
  }

  // 2. The configured understudy.
  if (primary.fallbackProfileId && primary.fallbackProfileId !== primary.id) {
    if (claimed.has(primary.fallbackProfileId)) {
      logger.debug('Fallback chain skipped configured understudy: already tried', {
        primaryProfileId: primary.id,
        understudyId: primary.fallbackProfileId,
        purpose: context.purpose,
      })
    } else {
      const understudy = await repos.connections.findById(primary.fallbackProfileId)
      if (!understudy) {
        logger.debug('Fallback chain skipped configured understudy: profile not found', {
          primaryProfileId: primary.id,
          understudyId: primary.fallbackProfileId,
          purpose: context.purpose,
        })
      } else if (understudy.transport === 'courier') {
        logger.debug('Fallback chain skipped configured understudy: courier transport', {
          primaryProfileId: primary.id,
          understudyId: understudy.id,
          purpose: context.purpose,
        })
      } else if (context.needsVision && !canReceiveThisTurnsImages(understudy)) {
        // The one capability a *named* understudy is still filtered on.
        //
        // A chain swaps the model but reuses the message array the primary's
        // call was built against — and when that turn carries an image, the
        // raw bytes are already embedded in it. Handing that array to a
        // text-only stand-in is not a risk, it is a guaranteed 400 (bug 106,
        // the same defect in the Concierge's uncensored reroute). Skipping is
        // strictly better than spending the attempt.
        //
        // Everything else the user names is honoured, danger-compatibility
        // included: that is their call to make. This is not a policy
        // preference, it is an incompatibility.
        logger.warn('Fallback chain skipped configured understudy: cannot receive this turn\'s images', {
          primaryProfileId: primary.id,
          understudyId: understudy.id,
          understudyName: understudy.name,
          understudyProvider: understudy.provider,
          supportsImageUpload: understudy.supportsImageUpload,
          purpose: context.purpose,
        })
      } else {
        chain.push({ profile: understudy, kind: 'configured' })
        claimed.add(understudy.id)
      }
    }
  }

  // 3. One auto-picked tier replacement — the last resort, and opt-in.
  if (primary.allowTierFallback) {
    const allProfiles = await repos.connections.findByUserId(context.userId)
    const pick = pickTierCandidate(primary, allProfiles, {
      ...context,
      alreadyTried: Array.from(claimed),
    })
    if (pick) {
      chain.push({ profile: pick, kind: 'tier-pick' })
      claimed.add(pick.id)
    }
  } else {
    logger.debug('Fallback chain skipped tier pick: not enabled on the profile', {
      primaryProfileId: primary.id,
      purpose: context.purpose,
    })
  }

  logger.debug('Fallback chain built', {
    primaryProfileId: primary.id,
    purpose: context.purpose,
    dangerous: context.dangerous,
    needsVision: context.needsVision,
    needsTools: context.needsTools,
    chain: chain.map((c) => ({
      profileId: c.profile.id,
      name: c.profile.name,
      provider: c.profile.provider,
      model: c.profile.modelName,
      kind: c.kind,
    })),
  })

  return chain
}

/**
 * Record one failed attempt, for logging and for the message the user sees.
 */
export function recordAttempt(
  profile: ConnectionProfile,
  trigger: FallbackTrigger,
  error: unknown
): FallbackAttempt {
  return {
    profileId: profile.id,
    profileName: profile.name,
    provider: profile.provider,
    modelName: profile.modelName,
    trigger,
    error: error instanceof Error ? error.message : String(error ?? 'unknown error'),
  }
}

/**
 * Turn an exhausted chain into the sentence the user reads.
 *
 * Names the profiles rather than the providers: a user with three OpenAI
 * profiles needs to know *which* understudy was called, and the profile name
 * is the thing they chose themselves.
 */
export function summarizeFallbackAttempts(
  attempts: FallbackAttempt[],
  tierPickWasOffered: boolean
): string {
  if (attempts.length === 0) return ''

  const roll = attempts
    .map((a) => `${a.profileName} failed (${a.trigger})`)
    .join(', ')

  if (attempts.length === 1) return roll

  return tierPickWasOffered ? roll : `${roll}; no tier replacement qualified`
}
