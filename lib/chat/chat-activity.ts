/**
 * What counts as *activity* in a chat, and which timestamp the UI shows for it.
 *
 * A chat's `updatedAt` moves whenever anything about the row changes — a
 * generated story background landing, a context summary being folded, a
 * Concierge reroute, a token-cost tally. None of that is the conversation
 * moving forward, so none of it belongs in a "last updated" column the reader
 * scans to find where they left off.
 *
 * `lastMessageAt` is the answer to the question actually being asked: **when
 * did a character last post content?** — the human user or an LLM, speaking as
 * themselves. THE single source of truth for that judgement is
 * {@link isCharacterAuthoredMessage} here; the SQLite mirror of it is
 * {@link CHARACTER_AUTHORED_MESSAGE_FILTER}. Change one and you must change the
 * other, or the live bump and the backfill will disagree.
 */

import type { ChatEvent, MessageEvent } from '@/lib/schemas/types';
import type { QueryFilter } from '@/lib/database/interfaces';

/**
 * Did a character — the human user or an LLM — post this as content?
 *
 * Included, deliberately: **whispers** (`targetParticipantIds` non-empty). A
 * character murmuring to one other character is still a character speaking; a
 * room full of whispering shouldn't read as a room gone quiet.
 *
 * Excluded, deliberately:
 * - **Non-`message` events** (`context-summary`, `system`) — bookkeeping.
 * - **Staff / personified-feature announcements** (`systemSender` set: Lantern,
 *   Aurora, Librarian, Concierge, Prospero, Host, Commonplace Book, Ariel,
 *   Carina, Suparṇā, Pascal). These persist as `type: 'message'` rows, which is
 *   precisely why "any message row" is the wrong test — a background image
 *   finishing rendering would otherwise float a months-dead chat to the top of
 *   the list.
 * - **Announcement bubbles** (`customAnnouncer` set) — an announcement wearing
 *   a name is still an announcement, not the character speaking.
 * - **`SYSTEM` and `TOOL` roles** — a raw tool-result row is machinery, not
 *   posted content.
 */
export function isCharacterAuthoredMessage(event: ChatEvent): event is MessageEvent {
  if (event.type !== 'message') return false;
  const m = event as MessageEvent;
  if (m.role !== 'USER' && m.role !== 'ASSISTANT') return false;
  if (m.systemSender) return false;
  if (m.customAnnouncer) return false;
  return true;
}

/**
 * The SQLite mirror of {@link isCharacterAuthoredMessage}, for indexed lookups
 * that must not load and Zod-validate a whole transcript. Spread it alongside a
 * `chatId` — `{ chatId, ...CHARACTER_AUTHORED_MESSAGE_FILTER }`.
 *
 * `systemSender: null` / `customAnnouncer: null` translate to `IS NULL`, which
 * is how both columns record "absent" (they default to NULL).
 */
export const CHARACTER_AUTHORED_MESSAGE_FILTER = {
  type: 'message',
  role: { $in: ['USER', 'ASSISTANT'] },
  systemSender: null,
  customAnnouncer: null,
} as unknown as QueryFilter;

/**
 * The timestamp to sort and display a chat by: when a character last posted,
 * falling back to when the chat was created.
 *
 * The fallback is `createdAt`, **not** `updatedAt` — a chat where only the
 * Staff has ever spoken has had no conversational activity at all, and dating
 * it by the last background image regenerated is the very drift this module
 * exists to stop. `createdAt` is the honest, and stable, answer.
 */
export function chatActivityAt(chat: { lastMessageAt?: string | null; createdAt: string }): string {
  return chat.lastMessageAt ?? chat.createdAt;
}

/** {@link chatActivityAt} as epoch milliseconds, for comparators. */
export function chatActivityTime(chat: { lastMessageAt?: string | null; createdAt: string }): number {
  const ms = new Date(chatActivityAt(chat)).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/** Newest-activity-first comparator for chat lists. */
export function byChatActivityDesc(
  a: { lastMessageAt?: string | null; createdAt: string },
  b: { lastMessageAt?: string | null; createdAt: string },
): number {
  return chatActivityTime(b) - chatActivityTime(a);
}
