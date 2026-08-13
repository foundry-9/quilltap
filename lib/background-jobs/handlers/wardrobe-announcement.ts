/**
 * Wardrobe Outfit Announcement Handler
 *
 * Posts a synthetic ASSISTANT-role chat message authored by Aurora summarising
 * a character's current outfit after a quiet period of wardrobe changes. The
 * job is enqueued (and rescheduled) by enqueueWardrobeOutfitAnnouncement and
 * fires once the debounce window has elapsed without further activity.
 *
 * Phase D of the system-prompt refactor: this announcement is now the single
 * source of truth for outfit state, replacing both the per-turn
 * `## Current Outfit` / `## Available Wardrobe` system-prompt blocks and the
 * `pendingOutfitNotifications` per-turn notice.
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import type { WardrobeOutfitAnnouncementPayload } from '../queue-service';
import { postOutfitChangeWhisper } from '@/lib/services/aurora-notifications/writer';
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped';
import { sharedWardrobeTiersForCharacter } from '@/lib/wardrobe/shared-tiers';
import { resolveProjectMountPointIds } from '@/lib/mount-index/tiered-mount-pool';
import {
  EquippedSlotsSchema,
  type EquippedOutfitState,
  type EquippedSlots,
} from '@/lib/schemas/wardrobe.types';

export async function handleWardrobeOutfitAnnouncement(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as WardrobeOutfitAnnouncementPayload;
  const { chatId, characterId } = payload;

  logger.info('[WardrobeAnnouncement] Starting announcement', {
    context: 'background-jobs.wardrobe-announcement',
    jobId: job.id,
    chatId,
    characterId,
  });

  const repos = getRepositories();

  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return;
  }

  // equippedOutfit is keyed by characterId → EquippedSlots (arrays-per-slot).
  // Parse defensively so legacy/null shapes can't crash the announcement job.
  const equippedOutfit = (chat.equippedOutfit as EquippedOutfitState | null) ?? {};
  const rawSlots = equippedOutfit[characterId];
  let slots: EquippedSlots | null = null;
  if (rawSlots) {
    const parsed = EquippedSlotsSchema.safeParse(rawSlots);
    if (parsed.success) {
      slots = parsed.data;
    } else {
      logger.warn('[WardrobeAnnouncement] equippedOutfit slot shape failed validation, skipping', {
        context: 'background-jobs.wardrobe-announcement',
        chatId,
        characterId,
        issues: parsed.error.issues.slice(0, 3),
      });
      return;
    }
  }

  if (!slots) {
    return;
  }

  const projectMountPointIds = await resolveProjectMountPointIds(chat.projectId);
  const resolved = await resolveEquippedOutfitForCharacter(
    repos,
    characterId,
    slots,
    await sharedWardrobeTiersForCharacter(characterId, projectMountPointIds),
  );

  const character = await repos.characters.findById(characterId);
  const charName = character?.name ?? 'A character';

  await postOutfitChangeWhisper({
    chatId,
    characterName: charName,
    outfit: resolved.outfitValues,
  });
}
