'use client'

/**
 * Recently-used characters — the storage ADAPTER.
 *
 * The list arithmetic lives in `lib/char-insert/recents.ts` (Tier B,
 * framework-free) and the key lives on the profile; this file is the ~30 lines
 * that know about `localStorage`. Keeping the split means quilltap-v5 copies the
 * arithmetic and rewrites only this.
 *
 * Every access is guarded: `localStorage` throws in private-mode Safari and in
 * any embedding that blocks storage, and a picker that explodes because it could
 * not remember your last symbol would be a poor trade.
 *
 * @module components/chat/char-insert/recents-storage
 */

import { parseRecents, pushRecent, serializeRecents } from '@/lib/char-insert/recents'
import type { CharProfile } from '@/lib/char-insert/types'

export function readRecents(profile: CharProfile): string[] {
  if (typeof window === 'undefined') return []
  try {
    return parseRecents(window.localStorage.getItem(profile.recentsStorageKey))
  } catch {
    return []
  }
}

/** Record a pick and return the resulting list. Never throws. */
export function recordRecent(profile: CharProfile, char: string): string[] {
  const next = pushRecent(readRecents(profile), char)
  if (typeof window === 'undefined') return next
  try {
    window.localStorage.setItem(profile.recentsStorageKey, serializeRecents(next))
  } catch {
    // Storage is full or blocked. The pick still happened; only the memory of
    // it is lost, which is not worth interrupting the writer for.
  }
  return next
}
