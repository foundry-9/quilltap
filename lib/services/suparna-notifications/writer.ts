/**
 * Writer for Suparṇā's Post Office mail whispers.
 *
 * Suparṇā is the personified mail carrier. When a character is about to take a
 * turn, the Post Office checks that character's mailbox; any letters not yet
 * announced trigger this whisper, which reads each new letter aloud, names the
 * sender and date, and reminds the character how to read/answer/discard it.
 *
 * Unlike the Commonplace Book whisper (a per-turn snapshot that sweeps its own
 * prior whispers), this is EVENT-like: each new-mail announcement is a distinct
 * event and must not sweep earlier ones.
 *
 * Suparṇā is openly visible to characters (NOT opaque): `opaqueContent` is set
 * equal to `content` so the opaque-character swap (`opaqueContent ?? content`)
 * is a no-op and the recipient reads her announcement — and the real sender
 * name — verbatim.
 *
 * Errors never propagate — a mail-check failure must never break the turn.
 */

import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import type { MessageEvent } from '@/lib/schemas/types';
import type { DeliveredLetterSummary } from '@/lib/post-office/mailbox';
import { formatLetterActions, formatLetterDate } from '@/lib/post-office/instructions';
import { formatSelfUri } from '@/lib/doc-edit/qtap-uri';

export type SuparnaWhisperKind = 'mail-delivery';

/** Quote a letter body as a Markdown blockquote (so Suparṇā "reads it aloud"). */
function quoteBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '> (the letter is blank)';
  return trimmed
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
}

/**
 * Persona-voiced whisper for the Salon transcript / UI (and `opaqueContent`).
 * Reads each new letter aloud and appends the read/answer/discard reminders.
 */
export function buildSuparnaMailWhisper(letters: DeliveredLetterSummary[]): string {
  if (letters.length === 0) return '';
  const count = letters.length;
  const opener =
    count === 1
      ? 'Suparṇā glides in from the Post Office, a single letter held out for you.'
      : `Suparṇā glides in from the Post Office with an armful of ${count} letters for you.`;
  const parts = letters.map((letter) => {
    const head = `**A letter from ${letter.from}**, posted ${formatLetterDate(letter.sentAt)}:`;
    return `${head}\n\n${quoteBody(letter.body)}\n\n${formatLetterActions(letter)}`;
  });
  return `${opener}\n\n${parts.join('\n\n---\n\n')}`;
}

/**
 * Plain second-person framing for the LLM context, so the model reliably ACTS
 * on its mail rather than merely seeing a Salon bubble. Mirrors the Commonplace
 * Book's `buildCommonplaceLLMContext`.
 */
export function buildSuparnaMailLLMContext(letters: DeliveredLetterSummary[]): string {
  if (letters.length === 0) return '';
  const intro =
    `Suparṇā of the Post Office has delivered new mail to you` +
    `${letters.length === 1 ? '' : ` (${letters.length} letters)`}. Each letter is below.`;
  const parts = letters.map((letter) =>
    [
      `Letter from ${letter.from}, delivered ${formatLetterDate(letter.sentAt)} (${formatSelfUri(letter.path)}):`,
      letter.body.trim() || '(the letter is blank)',
    ].join('\n'),
  );
  const howto =
    `You can read any letter again with doc_read_file({ uri: "qtap://self/<its path>" }), ` +
    `answer it with send_mail (set in_reply_to to its id — its path), or discard it with doc_delete_file({ uri: "qtap://self/<its path>" }).`;
  return `${intro}\n\n${parts.join('\n\n')}\n\n${howto}`;
}

interface PostSuparnaMailWhisperParams {
  chatId: string;
  /** Participant ID this whisper is targeted at (multi-character chats), else null. */
  targetParticipantId?: string | null;
  /** Pre-built persona-voiced body (from {@link buildSuparnaMailWhisper}). */
  content: string;
}

export async function postSuparnaMailWhisper(
  params: PostSuparnaMailWhisperParams,
): Promise<MessageEvent | null> {
  const { chatId, targetParticipantId, content } = params;
  if (!content || content.trim().length === 0) return null;

  try {
    const repos = getRepositories();
    const chat = await repos.chats.findById(chatId);
    if (!chat) return null;

    const messageId = randomUUID();
    const now = new Date().toISOString();

    const message: MessageEvent = {
      type: 'message',
      id: messageId,
      role: 'ASSISTANT',
      content,
      attachments: [],
      createdAt: now,
      participantId: null,
      systemSender: 'suparna',
      systemKind: 'mail-delivery',
      targetParticipantIds: targetParticipantId ? [targetParticipantId] : null,
      // Non-opaque: see module header.
      opaqueContent: content,
    };

    await repos.chats.addMessage(chatId, message);

    logger.info('[SuparnaWhisper] Mail whisper posted', {
      context: 'suparna-notifications',
      chatId,
      messageId,
      targetParticipantId,
      contentLength: content.length,
    });

    return message;
  } catch (error) {
    logger.error(
      '[SuparnaWhisper] Failed to post mail whisper',
      {
        context: 'suparna-notifications',
        chatId,
        targetParticipantId,
        error: getErrorMessage(error),
      },
      error as Error,
    );
    return null;
  }
}
