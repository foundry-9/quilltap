/**
 * Episodic anchor resolution — one policy for turning a model's free-text
 * `when` phrase into the `occurredAt` / `narrativeTime` pair stamped on a
 * memory row.
 *
 * Shared by the per-turn extractor (`memory-processor.ts`, where the phrase
 * is resolved against the source turn's timestamp and falls back to the same
 * stamp) and the fold-episode pass (`fold-episode-pass.ts`, where it is
 * resolved against the window's newest message but falls back to its oldest).
 * Pure: no I/O, no clock — callers supply every timestamp.
 *
 * Kept apart from `episodic.ts` so it reaches `resolveWhenPhrase` through the
 * module boundary (the fold-pass suite substitutes that parser).
 *
 * @module memory/episodic-anchors
 */

import { resolveWhenPhrase } from './episodic'

export interface EpisodicAnchorInput<F extends string | null = string | null> {
  /** The model's free-text time phrase; empty/absent means "not stated". */
  when: string | null | undefined
  /** The ISO instant the phrase is relative to ("yesterday" counts back from here). */
  referenceIso: string | null
  /** `occurredAt` when the phrase is absent, unresolvable, or there is nothing to resolve against. */
  fallbackIso: F
  timelineMode: 'realtime' | 'narrative'
  /** An explicit in-story stamp the caller already holds; outranks `when` as `narrativeTime`. */
  narrativeTime?: string | null
}

/** `occurredAt` is only nullable when the fallback was. */
export interface EpisodicAnchors<F extends string | null = string | null> {
  occurredAt: string | F
  narrativeTime: string | null
}

/**
 * Resolve a memory's episodic anchors.
 *
 *  - `occurredAt` — `when` resolved against `referenceIso`; `fallbackIso`
 *    when the phrase is absent or does not resolve.
 *  - `narrativeTime` — in narrative mode the explicit stamp if given, else
 *    the raw `when` phrase (the in-story time IS the phrase); in realtime
 *    mode only the explicit stamp survives.
 */
export function resolveEpisodicAnchors<F extends string | null>(
  input: EpisodicAnchorInput<F>,
): EpisodicAnchors<F> {
  let occurredAt: string | F = input.fallbackIso
  if (input.when && input.referenceIso) {
    const resolved = resolveWhenPhrase(input.when, input.referenceIso)
    if (resolved) occurredAt = resolved
  }
  const explicit = input.narrativeTime ?? null
  const narrativeTime =
    input.timelineMode === 'narrative' ? (explicit ?? (input.when ? input.when : null)) : explicit
  return { occurredAt, narrativeTime }
}
