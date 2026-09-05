/**
 * Provider/model fallback chains.
 *
 * Public surface of the fallback engine. Consumers should import from here
 * rather than reaching into the individual modules.
 *
 * @module llm/fallback
 */

export { classifyFallbackTrigger, buildFallbackChain, recordAttempt, summarizeFallbackAttempts } from './engine'
export type { FallbackRepos } from './engine'
export { pickTierCandidate, tierMatches } from './tier-picker'
export type {
  FallbackAttempt,
  FallbackCandidate,
  FallbackCandidateKind,
  FallbackContext,
  FallbackOutcome,
  FallbackTrigger,
} from './types'
