/**
 * Conversation Render Job Handler (Scriptorium)
 *
 * Handles CONVERSATION_RENDER background jobs by deterministically rendering
 * a chat conversation to Markdown and storing interchange chunks for embedding.
 * No LLM involvement - pure template-based rendering.
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { renderConversationMarkdown } from '@/lib/scriptorium/markdown-renderer';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { enqueueEmbeddingGenerate } from '../queue-service';
import type { ConversationRenderPayload } from '../queue-service';

const logger = createServiceLogger('ConversationRenderHandler');

export async function handleConversationRender(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as ConversationRenderPayload;
  const repos = getRepositories();
  const startTime = Date.now();

  // 1. Load chat
  const chat = await repos.chats.findById(payload.chatId);
  if (!chat) {
    logger.warn('[ConversationRender] Chat not found, skipping', {
      jobId: job.id,
      chatId: payload.chatId,
    });
    return;
  }

  // 2. Build participantId -> display name map
  const characterNames = new Map<string, string>();
  for (const participant of chat.participants) {
    if (participant.characterId) {
      const character = await repos.characters.findById(participant.characterId);
      if (character) {
        characterNames.set(participant.id, character.name);
      }
    }
    // User-controlled participants without a character get "User"
    if (participant.controlledBy === 'user' && !characterNames.has(participant.id)) {
      characterNames.set(participant.id, 'User');
    }
  }

  // 3. Load all messages
  const allEvents = await repos.chats.getMessages(payload.chatId);

  if (allEvents.length === 0) {
    return;
  }

  // 4. Render conversation to Markdown
  const result = renderConversationMarkdown(allEvents, chat.participants, characterNames, {
    conversationId: payload.chatId,
    title: chat.title,
    createdAt: chat.createdAt,
    lastUpdatedAt: chat.updatedAt,
  });

  // 5. Save renderedMarkdown to chat (do NOT set updatedAt - background job)
  await repos.chats.update(payload.chatId, {
    renderedMarkdown: result.markdown,
  });

  // 6. Upsert interchange chunks
  const now = new Date().toISOString();
  for (const interchange of result.interchanges) {
    await repos.conversationChunks.upsert({
      chatId: payload.chatId,
      interchangeIndex: interchange.index,
      content: interchange.content,
      participantNames: interchange.participantNames,
      messageIds: interchange.messageIds,
    });
  }

  // 7. Enqueue embedding for interchanges (if embedding profile configured)
  // When fullReembed is true, embed ALL chunks; otherwise only the newest
  if (result.interchanges.length > 0) {
    try {
      // Default profile only — every vector in the instance must come from
      // the same profile. With no default marked, chunks wait for the
      // startup reconcile rather than embedding under an arbitrary one.
      const embeddingProfiles = await repos.embeddingProfiles.findAll();
      const defaultProfile = embeddingProfiles.find(p => p.isDefault);

      if (defaultProfile) {
        // Embed all chunks that don't already have embeddings,
        // or all chunks if fullReembed is requested
        let embeddedCount = 0;
        for (const interchange of result.interchanges) {
          const chunk = await repos.conversationChunks.findByInterchangeIndex(
            payload.chatId,
            interchange.index
          );

          if (chunk && (payload.fullReembed || !chunk.embedding)) {
            await enqueueEmbeddingGenerate(job.userId, {
              entityType: 'CONVERSATION_CHUNK',
              entityId: chunk.id,
              chatId: payload.chatId,
              profileId: defaultProfile.id,
            });
            embeddedCount++;
          }
        }
      } else {
      }
    } catch (error) {
      // Don't fail the render job if embedding enqueue fails
      logger.warn('[ConversationRender] Failed to enqueue embedding, continuing', {
        jobId: job.id,
        chatId: payload.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const durationMs = Date.now() - startTime;
  logger.info('[ConversationRender] Conversation rendered successfully', {
    jobId: job.id,
    chatId: payload.chatId,
    interchangeCount: result.interchanges.length,
    markdownLength: result.markdown.length,
    durationMs,
  });
}
