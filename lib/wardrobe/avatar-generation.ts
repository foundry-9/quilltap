/**
 * Shared avatar generation trigger for wardrobe changes.
 *
 * Checks whether a chat has avatar generation enabled, resolves the
 * appropriate image profile, and enqueues a character avatar generation job.
 * Failures are caught and logged — they must never affect the caller's result.
 */

import { logger } from '@/lib/logger';
import { enqueueCharacterAvatarGeneration } from '@/lib/background-jobs/queue-service';
import type { EquippedSlots } from '@/lib/schemas/wardrobe.types';
import type { getRepositories } from '@/lib/repositories/factory';

interface AvatarGenerationParams {
  userId: string;
  chatId: string;
  characterId: string;
  /** Identifies the call site in log messages (e.g. 'wardrobe-create-item-handler') */
  callerContext: string;
  /**
   * One-shot override: use this image profile instead of the chat's default.
   * The chat's stored `imageProfileId` is NOT mutated. Used when the user
   * picks a non-default model from the wardrobe dialog.
   */
  imageProfileIdOverride?: string | null;
  /**
   * One-shot equipped-slots override: when set, the avatar prompt is built
   * from these slots instead of whatever is stored on the chat. Used by the
   * dialog's "fitting room" — a transient outfit composition that has not
   * been committed to the chat's equipped state.
   */
  equippedSlotsOverride?: EquippedSlots | null;
}

export type AvatarGenerationResult =
  | { queued: true }
  | { queued: false; reason: 'chat-not-found' | 'no-image-profile' | 'error'; message: string };

/**
 * Unconditionally trigger avatar generation. Resolves the image profile from
 * the override first, then chat-level setting, then global default. Used by
 * the manual regenerate-avatar button — the chat-level toggle does NOT gate
 * this path. Returns a structured result so callers can surface failures
 * (e.g. "no image profile configured") to the user.
 */
export async function triggerAvatarGeneration(
  repos: ReturnType<typeof getRepositories>,
  params: AvatarGenerationParams
): Promise<AvatarGenerationResult> {
  const {
    userId,
    chatId,
    characterId,
    callerContext,
    imageProfileIdOverride,
    equippedSlotsOverride,
  } = params;

  try {
    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return { queued: false, reason: 'chat-not-found', message: 'Chat not found.' };
    }

    // Resolve image profile: explicit override → chat-level → global default
    let imageProfileId: string | null = null;

    if (imageProfileIdOverride) {
      const profile = await repos.imageProfiles.findById(imageProfileIdOverride);
      if (profile) {
        imageProfileId = profile.id;
      } else {
        logger.warn('Avatar generation override profile not found, falling back', {
          context: callerContext,
          chatId,
          imageProfileIdOverride,
        });
      }
    }

    if (!imageProfileId && chat.imageProfileId) {
      const profile = await repos.imageProfiles.findById(chat.imageProfileId);
      if (profile) {
        imageProfileId = profile.id;
      }
    }

    if (!imageProfileId) {
      const allProfiles = await repos.imageProfiles.findAll();
      const defaultProfile = allProfiles.find((p) => p.isDefault) || null;
      if (defaultProfile) {
        imageProfileId = defaultProfile.id;
      }
    }

    if (!imageProfileId) {
      return {
        queued: false,
        reason: 'no-image-profile',
        message: 'No image profile is configured. Set one in Settings → Images before generating avatars.',
      };
    }

    await enqueueCharacterAvatarGeneration(userId, {
      chatId,
      characterId,
      imageProfileId,
      ...(equippedSlotsOverride ? { equippedSlotsOverride } : {}),
    });

    return { queued: true };
  } catch (error) {
    logger.warn('Failed to enqueue avatar generation', {
      context: callerContext,
      chatId,
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      queued: false,
      reason: 'error',
      message: error instanceof Error ? error.message : 'Failed to queue avatar generation.',
    };
  }
}

/**
 * Trigger avatar generation only if the chat has avatarGenerationEnabled.
 * Used by automatic triggers (wardrobe changes etc.) where the user has
 * opted in to auto-regeneration. Failures are swallowed — automatic paths
 * must never affect the caller's result.
 */
export async function triggerAvatarGenerationIfEnabled(
  repos: ReturnType<typeof getRepositories>,
  params: AvatarGenerationParams
): Promise<void> {
  try {
    const chat = await repos.chats.findById(params.chatId);
    if (!chat?.avatarGenerationEnabled) {
      return;
    }
    // Autonomous rooms (4.6 Private Character Rooms): automatic avatar refresh is
    // disabled by design — wardrobe state still advances, but no image is
    // generated. Character-invoked image-generation tool calls are unaffected.
    if (chat.chatType === 'autonomous') {
      return;
    }
    await triggerAvatarGeneration(repos, params);
  } catch (error) {
    logger.warn('Failed to enqueue avatar generation after outfit change', {
      context: params.callerContext,
      chatId: params.chatId,
      characterId: params.characterId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
