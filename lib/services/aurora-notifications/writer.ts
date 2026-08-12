/**
 * Writer for Aurora chat whispers (wardrobe / appearance).
 *
 * Aurora is the personified wardrobe system. When a character's outfit is
 * established at chat-start or changes mid-chat, Aurora narrates it into the
 * transcript so both the user and the LLM see the same source of truth. This
 * replaces the per-turn `## Current Outfit`, `## Available Wardrobe`, and
 * `## ⚠️ Outfit Change Notice` blocks that previously lived in the system
 * prompt (Phase D of the system-prompt refactor).
 *
 * Each builder has a sibling `*OpaqueContent` form that drops the Aurora
 * persona. When the chat has any non-user-character with
 * systemTransparency !== true, the context-builder swaps `content` →
 * `opaqueContent` in every character's LLM context (see
 * `lib/services/chat-message/context-builder.service.ts`).
 *
 * Errors never propagate — wardrobe operations must never fail because an
 * announcement couldn't be written.
 */

import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { describeOutfit, type OutfitSlotValues } from '@/lib/wardrobe/outfit-description';
import type { MessageEvent } from '@/lib/schemas/types';

interface BuildContentParams {
  characterName: string;
  outfit: OutfitSlotValues;
}

/**
 * Opening-of-chat outfit announcement. Establishes how a character is dressed
 * before the first character speaks. Reports only what they're wearing now —
 * the LLM can call `wardrobe_list` if it needs the full register.
 */
export function buildOpeningOutfitContent(params: BuildContentParams): string {
  const { characterName, outfit } = params;
  const outfitText = describeOutfit(outfit);
  const lines: string[] = [
    `Aurora regards ${characterName} and pronounces upon their attire:`,
    '',
    '',
    outfitText.trimEnd(),
  ];
  return lines.join('\n');
}

export function buildOpeningOutfitOpaqueContent(params: BuildContentParams): string {
  const { characterName, outfit } = params;
  const outfitText = describeOutfit(outfit);
  return [
    `${characterName}'s current attire:`,
    '',
    outfitText.trimEnd(),
  ].join('\n');
}

/**
 * Mid-chat outfit-change announcement. Fires immediately when a character
 * equips or unequips an item via the sidebar. Replaces the per-turn
 * `pendingOutfitNotifications` flow.
 */
export function buildOutfitChangeContent(params: BuildContentParams): string {
  const { characterName, outfit } = params;
  const outfitText = describeOutfit(outfit);
  const lines: string[] = [
    `Aurora marks an alteration to ${characterName}'s attire. They are now turned out as follows:`,
    '',
    '',
    outfitText.trimEnd(),
  ];
  return lines.join('\n');
}

export function buildOutfitChangeOpaqueContent(params: BuildContentParams): string {
  const { characterName, outfit } = params;
  const outfitText = describeOutfit(outfit);
  return [
    `${characterName} is now wearing:`,
    '',
    outfitText.trimEnd(),
  ].join('\n');
}

interface PostParams {
  chatId: string;
  content: string;
  opaqueContent: string | null;
  /** Short label for logs — e.g. 'opening-outfit', 'outfit-change'. */
  kind: string;
  /** Optional whisper targeting. Aurora outfit announcements are public by default. */
  targetParticipantIds?: string[] | null;
}

async function postAuroraMessage(params: PostParams): Promise<MessageEvent | null> {
  const { chatId, content, opaqueContent, kind, targetParticipantIds } = params;

  if (!content || content.trim().length === 0) {
    return null;
  }

  try {
    const repos = getRepositories();
    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return null;
    }

    const message: MessageEvent = {
      type: 'message',
      id: randomUUID(),
      role: 'ASSISTANT',
      content,
      opaqueContent,
      attachments: [],
      createdAt: new Date().toISOString(),
      participantId: null,
      systemSender: 'aurora',
      systemKind: kind,
      targetParticipantIds: targetParticipantIds && targetParticipantIds.length > 0 ? targetParticipantIds : null,
    };

    await repos.chats.addMessage(chatId, message);

    logger.info('[AuroraNotification] Whisper posted', {
      context: 'aurora-notifications',
      chatId,
      messageId: message.id,
      kind,
      targetParticipantIds: targetParticipantIds ?? null,
    });

    return message;
  } catch (error) {
    logger.error('[AuroraNotification] Failed to post whisper', {
      context: 'aurora-notifications',
      chatId,
      kind,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}

export interface OpeningOutfitAnnouncement {
  chatId: string;
  characterName: string;
  outfit: OutfitSlotValues;
}

export async function postOpeningOutfitWhisper(
  params: OpeningOutfitAnnouncement,
): Promise<MessageEvent | null> {
  return postAuroraMessage({
    chatId: params.chatId,
    content: buildOpeningOutfitContent(params),
    opaqueContent: buildOpeningOutfitOpaqueContent(params),
    kind: 'opening-outfit',
  });
}

export interface OutfitChangeAnnouncement {
  chatId: string;
  characterName: string;
  outfit: OutfitSlotValues;
}

export async function postOutfitChangeWhisper(
  params: OutfitChangeAnnouncement,
): Promise<MessageEvent | null> {
  return postAuroraMessage({
    chatId: params.chatId,
    content: buildOutfitChangeContent(params),
    opaqueContent: buildOutfitChangeOpaqueContent(params),
    kind: 'outfit-change',
  });
}

