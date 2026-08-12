/**
 * Chats API v1 - Outfit Actions
 *
 * GET /api/v1/chats/[id]?action=outfit         — Get equipped outfit state
 * GET /api/v1/chats/[id]?action=outfit-summary — Per-character resolved title summary
 * POST /api/v1/chats/[id]?action=equip         — Mutate equipped state
 *
 * The POST body uses the same `mode` enum as the `wardrobe_wear`/`wardrobe_take_off` LLM
 * tool: `equip`, `add_to_slot`, `remove_from_slot`, `clear_slot`. Internally
 * each mode dispatches to the matching primitive in
 * `lib/wardrobe/outfit-displacement.ts`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { serverError, notFound, badRequest } from '@/lib/api/responses';
import type { RequestContext } from '@/lib/api/middleware';
import {
  equipItem,
  replaceItem,
  addToSlot,
  removeFromSlot,
} from '@/lib/wardrobe/outfit-displacement';
import { expandComposites } from '@/lib/wardrobe/expand-composites';
import { triggerAvatarGenerationIfEnabled } from '@/lib/wardrobe/avatar-generation';
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types';
import { WARDROBE_SLOT_TYPES, EquippedSlotsSchema } from '@/lib/schemas/wardrobe.types';
import { enqueueWardrobeOutfitAnnouncement } from '@/lib/background-jobs/queue-service';
import {
  resolveProjectMountPointIds,
  resolveProjectMountPointIdsForChat,
} from '@/lib/mount-index/tiered-mount-pool';

const equipBodySchema = z
  .object({
    characterId: z.string().min(1, 'characterId is required'),
    // `wear` honors the item's `replace` flag; `replace` force-swaps the slots
    // it covers. `equip` is a deprecated alias for `wear`.
    mode: z.enum(['wear', 'replace', 'equip', 'add_to_slot', 'remove_from_slot', 'clear_slot', 'set_all']),
    slot: z.enum(['top', 'bottom', 'footwear', 'accessories']).optional(),
    itemId: z.string().nullable().optional(),
    /** Required when mode === 'set_all'. Replaces every slot atomically. */
    slots: EquippedSlotsSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (
      (value.mode === 'add_to_slot' ||
        value.mode === 'remove_from_slot' ||
        value.mode === 'clear_slot') &&
      !value.slot
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['slot'],
        message: `slot is required for mode "${value.mode}"`,
      });
    }
    if (
      (value.mode === 'wear' ||
        value.mode === 'replace' ||
        value.mode === 'equip' ||
        value.mode === 'add_to_slot') &&
      !value.itemId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['itemId'],
        message: `itemId is required for mode "${value.mode}"`,
      });
    }
    if (value.mode === 'set_all' && !value.slots) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['slots'],
        message: 'slots is required for mode "set_all"',
      });
    }
  });

/**
 * GET ?action=outfit — Return the full equipped outfit state for this chat
 */
export async function handleGetOutfit(
  chatId: string,
  { repos }: RequestContext
): Promise<NextResponse> {
  try {

    const equippedOutfit = await repos.chats.getEquippedOutfit(chatId);

    return NextResponse.json({ equippedOutfit: equippedOutfit ?? {} });
  } catch (error) {
    logger.error('[Chats v1] Error fetching equipped outfit', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch equipped outfit');
  }
}

/**
 * GET ?action=outfit-summary — Return per-character equipped outfit with
 * resolved item titles. Each slot is an array of items (composites are
 * expanded to their leaves before mapping). Shape:
 *
 *   { summary: { [characterId]: { [slot]: [{ itemId, title }, ...] } } }
 */
export async function handleGetOutfitSummary(
  chatId: string,
  { repos }: RequestContext
): Promise<NextResponse> {
  try {

    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return notFound('Chat');
    }

    const equippedOutfit = (await repos.chats.getEquippedOutfit(chatId)) ?? {};

    // Collect every itemId across all characters/slots, then bulk-resolve.
    const allItemIds = new Set<string>();
    for (const slots of Object.values(equippedOutfit)) {
      if (!slots) continue;
      for (const slotKey of WARDROBE_SLOT_TYPES) {
        for (const id of slots[slotKey] ?? []) {
          if (typeof id === 'string' && id.length > 0) allItemIds.add(id);
        }
      }
    }

    const itemsById = new Map<string, WardrobeItem>();
    if (allItemIds.size > 0) {
      // No global wardrobe table post-cutover: seed shared items (Quilltap
      // General + the chat project's stores) so composite components that are
      // shared items resolve, then layer each participant character's own vault
      // wardrobe on top.
      const projectMountPointIds = await resolveProjectMountPointIds(chat.projectId);
      for (const arche of await repos.wardrobe.findArchetypes(true, { projectMountPointIds })) {
        itemsById.set(arche.id, arche);
      }
      for (const characterId of Object.keys(equippedOutfit)) {
        for (const item of await repos.wardrobe.findByCharacterId(characterId, true)) {
          itemsById.set(item.id, item);
        }
      }
    }

    type SummaryEntry = { itemId: string; title: string };
    const summary: Record<string, Record<string, SummaryEntry[]>> = {};

    for (const [characterId, slots] of Object.entries(equippedOutfit)) {
      const slotMap: Record<string, SummaryEntry[]> = {
        top: [],
        bottom: [],
        footwear: [],
        accessories: [],
      };

      if (slots) {
        for (const slotKey of WARDROBE_SLOT_TYPES) {
          const equippedIds = slots[slotKey] ?? [];
          if (equippedIds.length === 0) continue;

          const { leafIds } = expandComposites(equippedIds, itemsById);
          const seen = new Set<string>();
          for (const leafId of leafIds) {
            if (seen.has(leafId)) continue;
            const leaf = itemsById.get(leafId);
            if (!leaf) continue;
            // Only project the leaf into slots its own types cover.
            if (!leaf.types.includes(slotKey)) continue;
            slotMap[slotKey].push({ itemId: leaf.id, title: leaf.title });
            seen.add(leafId);
          }
        }
      }

      summary[characterId] = slotMap;
    }

    return NextResponse.json({ summary });
  } catch (error) {
    logger.error('[Chats v1] Error fetching equipped outfit summary', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch equipped outfit summary');
  }
}

/**
 * POST ?action=equip — Mutate equipped state for a character in this chat.
 *
 * Body: `{ characterId, mode, slot?, itemId? }` — same `mode` semantics as
 * the `wardrobe_wear`/`wardrobe_take_off` LLM tools.
 */
export async function handleEquipSlot(
  req: NextRequest,
  chatId: string,
  ctx: RequestContext
): Promise<NextResponse> {
  const { repos } = ctx;
  try {
    const body = await req.json();
    const { characterId, mode, slot, itemId, slots: bodySlots } = equipBodySchema.parse(body);

    // Project tier for tri-tier wardrobe resolution — lets a chat equip items
    // that live in the project's document store, not just the character vault
    // or Quilltap General.
    const projectMountPointIds = await resolveProjectMountPointIdsForChat(chatId);

    let updatedSlots;

    if (mode === 'set_all') {
      // Atomic replace — used by the dialog's "Wear this fitting" button to
      // commit a fitting-room composition all at once. Validate every id
      // resolves to an item in this character's wardrobe before persisting.
      const allIds = new Set<string>();
      for (const key of WARDROBE_SLOT_TYPES) {
        for (const id of bodySlots![key]) allIds.add(id);
      }
      if (allIds.size > 0) {
        const found = await repos.wardrobe.findByIdsForCharacter(characterId, Array.from(allIds), {
          projectMountPointIds,
        });
        const foundIds = new Set(found.map((i) => i.id));
        for (const id of allIds) {
          if (!foundIds.has(id)) {
            return badRequest(`Wardrobe item ${id} not available to this character`);
          }
        }
      }
      updatedSlots = await repos.chats.setEquippedOutfit(chatId, characterId, bodySlots!);
      logger.info('[Chats v1] Equipped outfit replaced (set_all)', {
        chatId, characterId, context: 'wardrobe',
      });
    } else if (mode === 'wear' || mode === 'equip') {
      // itemId guaranteed by schema. Validate the item resolves and covers
      // at least one slot we recognize.
      const item = await repos.wardrobe.findByIdForCharacter(characterId, itemId!, {
        projectMountPointIds,
      });
      if (!item) {
        return notFound('Wardrobe item');
      }
      updatedSlots = await equipItem(repos, chatId, characterId, item);
      logger.info('[Chats v1] Wardrobe item worn', {
        chatId, characterId, itemId: item.id, slotsAffected: item.types,
        effect: item.replace ? 'replaced' : 'layered',
        context: 'wardrobe',
      });
    } else if (mode === 'replace') {
      const item = await repos.wardrobe.findByIdForCharacter(characterId, itemId!, {
        projectMountPointIds,
      });
      if (!item) {
        return notFound('Wardrobe item');
      }
      updatedSlots = await replaceItem(repos, chatId, characterId, item);
      logger.info('[Chats v1] Wardrobe item force-replaced', {
        chatId, characterId, itemId: item.id, slotsAffected: item.types,
        effect: 'replaced',
        context: 'wardrobe',
      });
    } else if (mode === 'add_to_slot') {
      const item = await repos.wardrobe.findByIdForCharacter(characterId, itemId!, {
        projectMountPointIds,
      });
      if (!item) {
        return notFound('Wardrobe item');
      }
      if (!item.types.includes(slot as WardrobeItemType)) {
        return badRequest(
          `Wardrobe item "${item.title}" does not cover the ${slot} slot`,
        );
      }
      updatedSlots = await addToSlot(
        repos,
        chatId,
        characterId,
        slot as WardrobeItemType,
        item,
      );
      logger.info('[Chats v1] Wardrobe item layered into slot', {
        chatId, characterId, slot, itemId: item.id, context: 'wardrobe',
      });
    } else if (mode === 'remove_from_slot') {
      updatedSlots = await removeFromSlot(
        repos,
        chatId,
        characterId,
        slot as WardrobeItemType,
        itemId ?? undefined,
      );
      logger.info('[Chats v1] Wardrobe item removed from slot', {
        chatId, characterId, slot, itemId: itemId ?? null, context: 'wardrobe',
      });
    } else {
      // mode === 'clear_slot'
      updatedSlots = await removeFromSlot(
        repos,
        chatId,
        characterId,
        slot as WardrobeItemType,
      );
      logger.info('[Chats v1] Wardrobe slot cleared', {
        chatId, characterId, slot, context: 'wardrobe',
      });
    }

    if (!updatedSlots) {
      return serverError('Failed to update equipped slot');
    }

    // Trigger avatar generation if enabled for this chat
    await triggerAvatarGenerationIfEnabled(repos, {
      userId: ctx.user.id,
      chatId,
      characterId,
      callerContext: '[Chats v1] outfit-equip',
    });

    // Schedule a debounced Aurora announcement (or push back the existing one)
    try {
      await enqueueWardrobeOutfitAnnouncement(ctx.user.id, { chatId, characterId });
    } catch (announceError) {
      logger.warn('[Chats v1] Failed to schedule outfit announcement', {
        chatId, characterId,
        error: announceError instanceof Error ? announceError.message : String(announceError),
      });
    }

    return NextResponse.json({ equippedSlots: updatedSlots });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return badRequest(error.issues.map((e: { message: string }) => e.message).join(', '));
    }
    logger.error('[Chats v1] Error equipping wardrobe slot', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to equip wardrobe slot');
  }
}
