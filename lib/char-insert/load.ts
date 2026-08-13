/**
 * Lazy dataset loader — the Tier B/C boundary.
 *
 * This is the ONLY file in `lib/char-insert/` that touches the outside world,
 * and it is deliberately thin: fetch, `buildIndex`, cache, cool down. It holds
 * no decisions — which characters match and in what order lives in `search.ts`.
 *
 * ⚠ A dataset must NEVER be imported statically. A static import puts a quarter
 * of a megabyte of JSON in the main bundle for a feature most sessions never
 * touch; the whole point of the assets living under `public/` is that instances
 * which never type `:` or `\` never pay for them.
 *
 * Failure is silent and non-blocking: typing is never impeded, the menu simply
 * never opens. One retry, then a 60-second cooldown, and exactly one warning per
 * page load per profile — a fetch that fails on every keystroke would be its own
 * bug report.
 *
 * @module lib/char-insert/load
 */

import { buildIndex } from './search';
import type { CharIndex, CharIndexLoader } from './types';

const RETRY_LIMIT = 1;
const COOLDOWN_MS = 60_000;

/**
 * Build the loader for one dataset. Called ONCE per profile, from the profile
 * module, so every surface that shows the same dataset shares one cache and one
 * in-flight promise — two pickers and two typeaheads must not each fetch.
 */
export function createIndexLoader(options: {
  /** Profile id, used only in the warning line. */
  id: string;
  /** Versioned asset path under `public/`. */
  url: string;
  /** What the warning tells the reader has stopped working. */
  warning: string;
}): CharIndexLoader {
  let cached: CharIndex | null = null;
  let inFlight: Promise<CharIndex | null> | null = null;
  let failureCount = 0;
  let cooldownUntil = 0;
  let warned = false;

  function load(now: number = Date.now()): Promise<CharIndex | null> {
    if (cached) return Promise.resolve(cached);
    if (inFlight) return inFlight;
    if (failureCount > RETRY_LIMIT && now < cooldownUntil) return Promise.resolve(null);

    inFlight = fetch(options.url)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} loading ${options.url}`);
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
          console.warn(`[${options.id}] ${options.warning}`, error);
        }
        return null;
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  }

  return {
    load,
    getLoaded: () => cached,
    isUnavailable: () => cached === null && failureCount > RETRY_LIMIT,
    resetForTests: () => {
      cached = null;
      inFlight = null;
      failureCount = 0;
      cooldownUntil = 0;
      warned = false;
    },
  };
}
