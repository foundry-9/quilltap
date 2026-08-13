/**
 * Lazy dataset loader — the Tier B/C boundary.
 *
 * This is the ONLY file in `lib/emoji/` that touches the outside world, and it
 * is deliberately thin: fetch, `buildIndex`, cache, cool down. It holds no
 * decisions — which emoji match and in what order lives in `search.ts`.
 *
 * ⚠ The dataset must NEVER be imported statically. A static import puts a
 * quarter-megabyte of JSON in the main bundle for a feature most sessions never
 * touch; the whole point of the asset living under `public/` is that instances
 * which never type `:` never pay for it.
 *
 * Failure is silent and non-blocking: typing is never impeded, the menu simply
 * never opens. One retry, then a 60-second cooldown, and exactly one warning per
 * page load — a fetch that fails on every keystroke would be its own bug report.
 *
 * @module lib/emoji/load
 */

import { buildIndex } from './search';
import type { EmojiIndex } from './types';

/** Versioned in the filename — a v2 dataset is a new file, never an edit. */
export const EMOJI_INDEX_URL = '/emoji/emoji-index.v1.json';

const RETRY_LIMIT = 1;
const COOLDOWN_MS = 60_000;

let cached: EmojiIndex | null = null;
let inFlight: Promise<EmojiIndex | null> | null = null;
let failureCount = 0;
let cooldownUntil = 0;
let warned = false;

/** Synchronous peek — returns the index only if it is already in memory. */
export function getLoadedEmojiIndex(): EmojiIndex | null {
  return cached;
}

/** True when a load has failed and we are waiting out the cooldown. */
export function isEmojiIndexUnavailable(): boolean {
  return cached === null && failureCount > RETRY_LIMIT;
}

/**
 * Resolve the emoji index, fetching it at most once. Resolves to null (never
 * rejects) when the dataset cannot be loaded, so every caller can treat a
 * missing dataset as "the feature is closed" rather than an error path.
 */
export function loadEmojiIndex(now: number = Date.now()): Promise<EmojiIndex | null> {
  if (cached) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  if (failureCount > RETRY_LIMIT && now < cooldownUntil) return Promise.resolve(null);

  inFlight = fetch(EMOJI_INDEX_URL)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} loading ${EMOJI_INDEX_URL}`);
      }
      const index = buildIndex(await response.json());
      cached = index;
      failureCount = 0;
      return index;
    })
    .catch((error: unknown) => {
      failureCount += 1;
      if (failureCount > RETRY_LIMIT) cooldownUntil = Date.now() + COOLDOWN_MS;
      if (!warned) {
        warned = true;
        console.warn(
          "[emoji] Couldn't load the emoji index; the emoji typeahead and picker stay closed.",
          error,
        );
      }
      return null;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Test seam. Not used in app code. */
export function resetEmojiIndexForTests(): void {
  cached = null;
  inFlight = null;
  failureCount = 0;
  cooldownUntil = 0;
  warned = false;
}
