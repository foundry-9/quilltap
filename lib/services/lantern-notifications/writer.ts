/**
 * Writer for image-pipeline chat notifications.
 *
 * When an image is produced by one of the three pipelines (story background,
 * character avatar, or the `generate_image` tool), this helper injects a
 * synthetic ASSISTANT-role chat message announcing the image and attaching
 * its file ID. Characters see the announcement in their recent-history
 * context, and vision-capable providers receive the image as multimodal
 * content on the next turn.
 *
 * Attribution by kind:
 *   - `background`      → The Lantern (atmospheric backdrops)
 *   - `avatar`          → Aurora (character model, portrait keeper)
 *   - `character-image` → The Lantern (ad-hoc image on request)
 *
 * The feature is gated by `alertCharactersOfLanternImages` (chat override)
 * and `defaultAlertCharactersOfLanternImages` (project default), falling back
 * to OFF when both are null.
 *
 * Errors never propagate — image generation must never fail because an
 * announcement couldn't be written.
 */

import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import type { MessageEvent } from '@/lib/schemas/types';
import { isLanternImageAlertEnabled } from './resolver';

export type LanternNotificationKind =
  | { kind: 'avatar'; characterName: string }
  | { kind: 'background' }
  | { kind: 'character-image'; requesterName: string };

interface PostParams {
  chatId: string;
  fileId: string;
  kind: LanternNotificationKind;
  // Generation prompt to quote in the announcement. Callers pass it in
  // because the file row is typically a still-buffered write in the
  // background-job child and not yet readable from the DB.
  prompt?: string | null;
}

function buildContent(kind: LanternNotificationKind, prompt: string | null, fileId: string): string {
  const aim = prompt?.trim();
  // Each branch surfaces the image UUID inline so any character reading the
  // announcement in chat history has the handle required to call
  // describe_image (what is in it?), keep_image (file it) or attach_image
  // (hold it up again) on it. Lantern images already ride into vision-capable
  // turns as real attachments — describe_image is for the models that can't
  // see them, and for when a character wants the particulars in words.
  switch (kind.kind) {
    case 'avatar':
      return aim
        ? `Aurora is requesting a new portrait be commissioned for ${kind.characterName}, with the following description which omits unnecessary detail: "${aim}". The previous likeness is retired with due ceremony; the new one is attached here, catalogued under uuid \`${fileId}\`, should anyone care to take a fresh look.`
        : `Aurora is requesting a new portrait be commissioned for ${kind.characterName}. The previous likeness is retired with due ceremony; the new one is attached here, catalogued under uuid \`${fileId}\`, should anyone care to take a fresh look.`;
    case 'background':
      return aim
        ? `The Lantern has projected a new backdrop behind the proceedings, aiming for: "${aim}". The resulting image (uuid \`${fileId}\`) hangs just above, attached for your perusal.`
        : `The Lantern has projected a new backdrop behind the proceedings. The resulting image (uuid \`${fileId}\`) hangs just above, attached for your perusal.`;
    case 'character-image':
      return `The Lantern, acting upon the instructions of ${kind.requesterName}, has produced the following picture, catalogued under uuid \`${fileId}\`. It is attached here, should anyone care to examine it.`;
  }
}

function buildOpaqueContent(kind: LanternNotificationKind, prompt: string | null, fileId: string): string {
  const aim = prompt?.trim();
  switch (kind.kind) {
    case 'avatar':
      return aim
        ? `A new portrait has been commissioned for ${kind.characterName}, with this description (which omits unnecessary detail): "${aim}". The previous likeness is retired; the new one is attached here, catalogued under uuid \`${fileId}\`.`
        : `A new portrait has been commissioned for ${kind.characterName}. The previous likeness is retired; the new one is attached here, catalogued under uuid \`${fileId}\`.`;
    case 'background':
      return aim
        ? `A new background has been generated for this scene, aiming for: "${aim}". The resulting image (uuid \`${fileId}\`) is attached above for your perusal.`
        : `A new background has been generated for this scene. The resulting image (uuid \`${fileId}\`) is attached above for your perusal.`;
    case 'character-image':
      return `A picture has been generated at ${kind.requesterName}'s request, catalogued under uuid \`${fileId}\`. It is attached here for your examination.`;
  }
}

function senderForKind(kind: LanternNotificationKind): 'lantern' | 'aurora' {
  return kind.kind === 'avatar' ? 'aurora' : 'lantern';
}

export async function postLanternImageNotification(params: PostParams): Promise<void> {
  const { chatId, fileId, kind, prompt = null } = params;

  try {
    const repos = getRepositories();

    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return;
    }

    const project = chat.projectId
      ? await repos.projects.findById(chat.projectId)
      : null;

    if (!isLanternImageAlertEnabled(chat, project)) {
      return;
    }

    const messageId = randomUUID();
    const now = new Date().toISOString();

    const message: MessageEvent = {
      type: 'message',
      id: messageId,
      role: 'ASSISTANT',
      content: buildContent(kind, prompt, fileId),
      opaqueContent: buildOpaqueContent(kind, prompt, fileId),
      attachments: [fileId],
      createdAt: now,
      participantId: null,
      systemSender: senderForKind(kind),
      systemKind: kind.kind,
    };

    await repos.chats.addMessage(chatId, message);

    try {
      await repos.files.addLink(fileId, messageId);
    } catch (linkError) {
      logger.warn('[LanternNotification] Could not link file to message', {
        context: 'lantern-notifications',
        chatId,
        fileId,
        messageId,
        error: getErrorMessage(linkError),
      });
    }

    logger.info('[LanternNotification] Announcement posted', {
      context: 'lantern-notifications',
      chatId,
      fileId,
      messageId,
      kind: kind.kind,
    });
  } catch (error) {
    logger.error('[LanternNotification] Failed to post announcement', {
      context: 'lantern-notifications',
      chatId,
      fileId,
      kind: kind.kind,
      error: getErrorMessage(error),
    }, error as Error);
  }
}
