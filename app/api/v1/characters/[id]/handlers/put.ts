/**
 * Characters API v1 - PUT Handler
 *
 * PUT /api/v1/characters/[id] - Update a character
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { exists } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { z } from 'zod';
import { PronounsSchema, PhysicalDescriptionSchema } from '@/lib/schemas/character.types';
import { JsonSchema } from '@/lib/schemas/common.types';
import { TimestampConfigSchema } from '@/lib/schemas/settings.types';
import type { Character } from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { badRequest, notFound, successResponse } from '@/lib/api/responses';
import type { RequestContext } from '@/lib/api/middleware';
import { writeStoreFile, DEPICTION_GUIDELINES_FILENAME } from '@/lib/image-gen/aesthetic';

const updateCharacterSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  title: z.string().optional(),
  identity: z.string().nullable().optional(),
  description: z.string().optional(),
  manifesto: z.string().nullable().optional(),
  personality: z.string().optional(),
  scenarios: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        title: z.string().min(1).max(200),
        content: z.string().min(1),
        createdAt: z.string().optional(),
        updatedAt: z.string().optional(),
      })
    )
    .optional(),
  firstMessage: z.string().optional(),
  exampleDialogues: z.string().optional(),
  talkativeness: z.number().min(0.1).max(1.0).optional(),
  defaultConnectionProfileId: z.uuid()
    .optional()
    .or(
      z.literal('').transform(() => undefined)
    ),
  defaultImageProfileId: z.uuid()
    .optional()
    .or(
      z.literal('').transform(() => undefined)
    )
    .nullable(),
  aliases: z.array(z.string()).optional(),
  pronouns: PronounsSchema.nullable().optional(),
  controlledBy: z.enum(['llm', 'user']).optional(),
  npc: z.boolean().optional(),
  defaultAgentModeEnabled: z.boolean().nullable().optional(),
  defaultHelpToolsEnabled: z.boolean().nullable().optional(),
  defaultTimestampConfig: TimestampConfigSchema.nullable().optional(),
  defaultScenarioId: z.uuid().nullable().optional(),
  defaultSystemPromptId: z.uuid().nullable().optional(),
  characterDocumentMountPointId: z.uuid()
    .optional()
    .or(z.literal('').transform(() => null))
    .nullable(),
  systemTransparency: z.boolean().nullable().optional(),
  coreWhisperEnabled: z.boolean().nullable().optional(),
  canBeCarina: z.boolean().nullable().optional(),
  // Vault-managed (properties.json) plain boolean — named here or the parse
  // below would strip it before update() could route it to the vault.
  canChooseOutfit: z.boolean().optional(),
  // Wardrobe-permission tri-states (null = inherit global, true/false = override).
  // Real DB columns, not vault-managed — omitting them here strips the key before
  // it reaches update(), so the editor toggles would silently never persist.
  canDressThemselves: z.boolean().nullable().optional(),
  canCreateOutfits: z.boolean().nullable().optional(),
  // The freeform fact sheet (vault `metadata.json`). This schema strips unknown
  // keys, so the field has to be named here or a PUT carrying it would be
  // silently dropped before the write overlay ever saw it. Sending `metadata`
  // REPLACES the whole object — patch a single key by reading first.
  metadata: JsonSchema.nullable().optional(),
  physicalDescription: z
    .object({
      id: z.string().uuid().optional(),
      name: z.string().min(1),
      usageContext: z.string().max(200).nullable().optional(),
      headAndShouldersPrompt: z.string().max(500).nullable().optional(),
      shortPrompt: z.string().max(350).nullable().optional(),
      mediumPrompt: z.string().max(500).nullable().optional(),
      longPrompt: z.string().max(750).nullable().optional(),
      completePrompt: z.string().max(1000).nullable().optional(),
      fullDescription: z.string().nullable().optional(),
      createdAt: z.string().optional(),
      updatedAt: z.string().optional(),
    })
    .nullable()
    .optional(),
});

export async function handlePut(
  req: NextRequest,
  ctx: RequestContext,
  id: string
): Promise<NextResponse> {
  const { user, repos } = ctx;

  // Existence/ownership check only — use the raw row so a character with a
  // broken vault can still be edited (and thereby repaired: update() routes
  // managed fields back to the vault and auto-provisions a missing one).
  // findById would throw CharacterVaultUnavailableError → 503.
  const existingCharacter = await repos.characters.findByIdRaw(id);

  if (!exists(existingCharacter)) {
    return notFound('Character');
  }

  // Action dispatch: the depiction-guidelines (Ariel Clause) file lives in the
  // character's vault root, not the character row.
  if (getActionParam(req) === 'depiction-guidelines') {
    const mountId = existingCharacter.characterDocumentMountPointId;
    if (!mountId) {
      return badRequest('Character has no document vault to store depiction guidelines');
    }
    const aestheticBody = await req.json().catch(() => ({}));
    const content = typeof aestheticBody?.content === 'string' ? aestheticBody.content : '';
    await writeStoreFile(mountId, DEPICTION_GUIDELINES_FILENAME, content);
    logger.info('[Characters v1] Depiction guidelines updated', {
      characterId: id,
      length: content.trim().length,
      deleted: content.trim().length === 0,
    });
    return successResponse({ success: true });
  }

  const body = await req.json();
  const validatedData = updateCharacterSchema.parse(body);

  // Normalize scenarios: fill in missing id/createdAt/updatedAt
  const { scenarios: rawScenarios, physicalDescription: rawPhysical, ...restValidatedData } = validatedData;
  const updatePayload: Partial<Character> = { ...restValidatedData };
  if (rawScenarios) {
    const now = new Date().toISOString();
    updatePayload.scenarios = rawScenarios.map(s => ({
      id: s.id ?? crypto.randomUUID(),
      title: s.title,
      content: s.content,
      createdAt: s.createdAt ?? now,
      updatedAt: s.updatedAt ?? now,
    }));
  }
  if (rawPhysical !== undefined) {
    if (rawPhysical === null) {
      updatePayload.physicalDescription = null;
    } else {
      const now = new Date().toISOString();
      updatePayload.physicalDescription = PhysicalDescriptionSchema.parse({
        id: rawPhysical.id ?? crypto.randomUUID(),
        name: rawPhysical.name,
        usageContext: rawPhysical.usageContext ?? null,
        headAndShouldersPrompt: rawPhysical.headAndShouldersPrompt ?? null,
        shortPrompt: rawPhysical.shortPrompt ?? null,
        mediumPrompt: rawPhysical.mediumPrompt ?? null,
        longPrompt: rawPhysical.longPrompt ?? null,
        completePrompt: rawPhysical.completePrompt ?? null,
        fullDescription: rawPhysical.fullDescription ?? null,
        createdAt: rawPhysical.createdAt ?? now,
        updatedAt: now,
      });
    }
  }

  const character = await repos.characters.update(id, updatePayload);

  revalidatePath('/');

  logger.info('[Characters v1] Character updated', { characterId: id });

  return NextResponse.json({ character });
}
