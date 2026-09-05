/**
 * Fallback engine — shared types.
 *
 * The engine answers two questions for every LLM call in Quilltap:
 * *is this failure worth trying someone else for?* and *who is next?*
 * Both answers are the same regardless of which currency the caller holds
 * (a `ConnectionProfile` in the Salon, a `CheapLLMSelection` in the job
 * child), which is the whole reason the machinery lives at the provider layer
 * rather than inside the chat-message services.
 *
 * @module llm/fallback/types
 */

import type { ConnectionProfile } from '@/lib/schemas/types'

/**
 * Why a call failed, in the only granularity the chain cares about.
 *
 * Everything here means "the provider could not answer" — an availability
 * problem, which a different provider might not have. The two content-shaped
 * entries (`empty-response`, `moderation-refusal`) are included because a
 * refusal is still a call that produced nothing, and Quilltap has always
 * rerouted those; they simply arrive as an *outcome* rather than a throw.
 */
export type FallbackTrigger =
  | 'auth'
  | 'rate-limit'
  | 'network'
  | 'model-missing'
  | 'provider-error'
  | 'empty-response'
  | 'moderation-refusal'

/**
 * What a call needs from any profile that stands in for the failed one.
 *
 * `alreadyTried` is the loop guard. It is carried rather than derived because
 * a chain can be entered more than once in a single turn — the empty-response
 * path may run a same-profile retry and an uncensored reroute before the
 * chain proper — and every one of those attempts has to count.
 */
export interface FallbackContext {
  userId: string
  /**
   * Which call site is asking. Logged, and used by the failure summary; it
   * does not change candidate selection, which is driven by the capability
   * flags below.
   */
  purpose: 'chat' | 'cheap' | 'vision' | 'carina' | 'console' | 'help'
  /**
   * Whether this call is running in dangerous-routed territory. When true, an
   * auto-picked tier candidate MUST be `isDangerousCompatible` — the whole
   * point of the reroute is that the content needs a provider the user has
   * explicitly cleared for it, and quietly drafting a mainstream model would
   * hand the content straight back to the moderation that refused it.
   */
  dangerous: boolean
  /** The call carries image attachments; a stand-in must be able to see them. */
  needsVision: boolean
  /** The call sends tools; a stand-in must be able to receive them. */
  needsTools: boolean
  /** Profile ids already attempted on this call. Never re-offered. */
  alreadyTried: string[]
}

/** One attempt in a chain walk, recorded for logging and the failure summary. */
export interface FallbackAttempt {
  profileId: string
  profileName: string
  provider: string
  modelName: string
  trigger: FallbackTrigger
  /** Human-readable reason, taken from the underlying error where there was one. */
  error: string
}

/** How a candidate came to be in the chain. */
export type FallbackCandidateKind = 'primary' | 'configured' | 'tier-pick'

export interface FallbackCandidate {
  profile: ConnectionProfile
  kind: FallbackCandidateKind
}

/** The result of walking a chain to its end. */
export interface FallbackOutcome<T> {
  /** Set when some candidate answered. */
  success?: T
  /** Every attempt that failed, in order. */
  attempts: FallbackAttempt[]
  /** The profile that answered, when one did. */
  succeededWith?: ConnectionProfile
}
