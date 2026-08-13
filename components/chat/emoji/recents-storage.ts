'use client'

/**
 * Recently-used emoji — the storage ADAPTER.
 *
 * The list arithmetic lives in `lib/emoji/recents.ts` (Tier B, framework-free);
 * this file is the ~30 lines that know about `localStorage`. Keeping the split
 * means quilltap-v5 copies the arithmetic and rewrites only this.
 *
 * Every access is guarded: `localStorage` throws in private-mode Safari and in
 * any embedding that blocks storage, and a picker that explodes because it could
 * not remember your last emoji would be a poor trade.
 *
 * @module components/chat/emoji/recents-storage
 */

import { parseRecents, pushRecent, serializeRecents, RECENTS_STORAGE_KEY } from '@/lib/emoji/recents'

export function readEmojiRecents(): string[] {
  if (typeof window === 'undefined') return []
  try {
    return parseRecents(window.localStorage.getItem(RECENTS_STORAGE_KEY))
  } catch {
    return []
  }
}

/** Record a pick and return the resulting list. Never throws. */
export function recordEmojiRecent(char: string): string[] {
  const next = pushRecent(readEmojiRecents(), char)
  if (typeof window === 'undefined') return next
  try {
    window.localStorage.setItem(RECENTS_STORAGE_KEY, serializeRecents(next))
  } catch {
    // Storage is full or blocked. The pick still happened; only the memory of
    // it is lost, which is not worth interrupting the writer for.
  }
  return next
}
