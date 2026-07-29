/**
 * Chats API v1 - Markdown Transcript Export Action
 *
 * GET /api/v1/chats/[id]?action=export-markdown
 *
 * Renders the chat as a single deterministic Markdown document — the readable
 * record of the conversation (see lib/export/markdown-transcript.ts for what
 * is and isn't included) — and serves it as a download.
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { notFound, serverError } from '@/lib/api/responses';
import { buildContentDisposition } from '@/lib/api/content-disposition';
import { buildMarkdownTranscript, transcriptFilename } from '@/lib/export/markdown-transcript';
import { BRAHMA_CARINA_ANSWERER_ID } from '@/lib/services/carina/brahma-answerer';
import type { AuthenticatedContext } from '@/lib/api/middleware';

export async function handleExportMarkdown(
  chatId: string,
  ctx: AuthenticatedContext
): Promise<NextResponse> {
  const { user, repos } = ctx;

  try {
    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return notFound('Chat');
    }

    const events = await repos.chats.getMessages(chatId);

    // Every character the transcript may need a name for: participants,
    // custom announcers voiced by an (possibly off-scene) character, and
    // Carina answerers. The Brahma sentinel is not a real character.
    const characterIds = new Set<string>();
    for (const p of chat.participants) {
      if (p.characterId) characterIds.add(p.characterId);
    }
    for (const event of events) {
      if (event.type !== 'message') continue;
      if (event.customAnnouncer?.characterId) {
        characterIds.add(event.customAnnouncer.characterId);
      }
      const answererId = event.carinaMeta?.answererId;
      if (answererId && answererId !== BRAHMA_CARINA_ANSWERER_ID) {
        characterIds.add(answererId);
      }
    }

    // Broken-vault characters are dropped by findByIds; their messages fall
    // back to the generic names in the transcript builder.
    const characters = await repos.characters.findByIds([...characterIds]);
    const characterNamesById = new Map(characters.map((c) => [c.id, c.name]));

    const chatSettings = await repos.chatSettings.findByUserId(user.id);

    const markdown = buildMarkdownTranscript({
      chat,
      events,
      characterNamesById,
      userName: user.name || 'User',
      defaultTimestampConfig: chatSettings?.defaultTimestampConfig ?? null,
      chatSettingsTimezone: chatSettings?.timezone ?? null,
    });

    const filename = transcriptFilename(chat);
    logger.debug('[Chats v1] Markdown transcript exported', {
      chatId,
      filename,
      eventCount: events.length,
      characterCount: characterNamesById.size,
      bytes: markdown.length,
    });

    return new NextResponse(markdown, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': buildContentDisposition(filename, 'attachment'),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    logger.error(
      '[Chats v1] Error exporting Markdown transcript',
      { chatId },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to export chat as Markdown');
  }
}
