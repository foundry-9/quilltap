/**
 * Shared constants for chat documents (Document Mode).
 *
 * @module lib/chat-documents/constants
 */

/**
 * How many recent documents the Open-Document picker holds and shows. The
 * picker lists the current chat's documents first, then recently-opened
 * documents from other chats, capped at this number.
 */
export const MAX_RECENT_DOCUMENTS = 10;

/**
 * Reserved `chatId` for standalone (chat-less) Document Mode opens. The left
 * rail's Document Mode has no conversation to attach a `chat_documents` row to,
 * so its recent-open history is recorded under this sentinel. It is a real,
 * schema-valid UUID (so the `(chatId, filePath, scope, mountPoint)` unique index
 * still dedupes reopens) that no actual chat will ever hold, and it never
 * matches a live `chatId` — so these rows surface in the cross-chat recents but
 * are never mistaken for a document open "in" some chat.
 */
export const STANDALONE_CHAT_ID = '00000000-0000-0000-0000-000000000000';
