/**
 * Characters API v1 - POST Handler
 *
 * POST /api/v1/characters - Create a new character
 * POST /api/v1/characters?action=ai-wizard - AI wizard generation
 * POST /api/v1/characters?action=ai-wizard-stream - AI wizard generation (streaming)
 * POST /api/v1/characters?action=import - Import SillyTavern character
 * POST /api/v1/characters?action=quick-create - Quick create minimal character
 * POST /api/v1/characters?action=reset-builtins - Reset built-in characters
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import { importSTCharacter, parseSTCharacterPNG } from '@/lib/sillytavern/character';
import { runCharacterWizard, runCharacterWizardStreaming, type WizardRequest, type WizardProgressEvent } from '@/lib/services/character-wizard.service';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, serverError } from '@/lib/api/responses';
import { executeCascadeDelete } from '@/lib/cascade-delete';
import { getSeedImports } from '@/first-startup';
import { executeImport } from '@/lib/import/quilltap-import-service';
import { reseedAvatarsForCharacters } from '@/lib/startup/seed-initial-data';
import { writeCharacterAvatarToVault } from '@/lib/file-storage/character-vault-bridge';
import type { RequestContext } from '@/lib/api/middleware';

// ============================================================================
// Schemas
// ============================================================================

const createCharacterSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  title: z.string().optional(),
  identity: z.string().optional(),
  description: z.string().optional(),
  manifesto: z.string().optional(),
  personality: z.string().optional(),
  scenarios: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        title: z.string().min(1).max(200),
        content: z.string().min(1),
      })
    )
    .optional(),
  firstMessage: z.string().optional(),
  exampleDialogues: z.string().optional(),
  defaultConnectionProfileId: z.uuid().optional(),
  controlledBy: z.enum(['llm', 'user']).optional(),
  npc: z.boolean().optional(),
  systemPrompts: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string().min(1).max(100),
        content: z.string().min(1),
        isDefault: z.boolean().prefault(false),
        createdAt: z.string(),
        updatedAt: z.string(),
      })
    )
    .optional(),
  physicalDescription: z
    .object({
      id: z.uuid(),
      name: z.string().min(1),
      usageContext: z.string().max(200).nullable().optional(),
      shortPrompt: z.string().max(350).nullable().optional(),
      mediumPrompt: z.string().max(500).nullable().optional(),
      longPrompt: z.string().max(750).nullable().optional(),
      completePrompt: z.string().max(1000).nullable().optional(),
      fullDescription: z.string().nullable().optional(),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
    .nullable()
    .optional(),
  characterDocumentMountPointId: z.uuid()
    .optional()
    .or(z.literal('').transform(() => undefined))
    .nullable(),
});

const quickCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  defaultConnectionProfileId: z.uuid().optional(),
});

const wizardRequestSchema = z.object({
  primaryProfileId: z.uuid(),
  visionProfileId: z.uuid().optional(),
  sourceType: z.enum(['existing', 'upload', 'gallery', 'document', 'skip']),
  imageId: z.uuid().optional(),
  documentId: z.uuid().optional(),
  characterName: z.string(),
  existingData: z
    .object({
      title: z.string().optional(),
      identity: z.string().optional(),
      description: z.string().optional(),
      manifesto: z.string().optional(),
      personality: z.string().optional(),
      scenarios: z.array(z.object({ id: z.string(), title: z.string(), content: z.string() })).optional(),
      exampleDialogues: z.string().optional(),
      systemPrompt: z.string().optional(),
    })
    .optional(),
  background: z.string(),
  fieldsToGenerate: z.array(
    z.enum([
      'name',
      'title',
      'identity',
      'description',
      'manifesto',
      'personality',
      'scenarios',
      'exampleDialogues',
      'systemPrompt',
      'physicalDescription',
    ])
  ),
  characterId: z.uuid().optional(),
});

// ============================================================================
// Action List
// ============================================================================

const CHARACTERS_POST_ACTIONS = ['ai-wizard', 'ai-wizard-stream', 'import', 'quick-create', 'reset-builtins'] as const;
type CharactersPostAction = typeof CHARACTERS_POST_ACTIONS[number];

// ============================================================================
// Helper Functions
// ============================================================================

const BUILTIN_CHARACTER_NAMES = ['Lorian', 'Riya'] as const;

function findBuiltinCharacterIds(seedImportData: unknown): Record<string, string> {
  if (!seedImportData || typeof seedImportData !== 'object') {
    return {};
  }

  const dataContainer = (seedImportData as { data?: unknown }).data;
  if (!dataContainer || typeof dataContainer !== 'object') {
    return {};
  }

  const seedCharacters = (dataContainer as { characters?: unknown }).characters;
  if (!Array.isArray(seedCharacters)) {
    return {};
  }

  const seedIdByName: Record<string, string> = {};

  for (const entry of seedCharacters) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const name = (entry as { name?: unknown }).name;
    const id = (entry as { id?: unknown }).id;

    if (typeof name === 'string' && typeof id === 'string') {
      seedIdByName[name] = id;
    }
  }

  return seedIdByName;
}

function replaceMappedIdsRecursively(value: unknown, idMapping: Map<string, string>): unknown {
  if (typeof value === 'string') {
    return idMapping.get(value) ?? value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => replaceMappedIdsRecursively(item, idMapping));
  }

  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      next[key] = replaceMappedIdsRecursively(nestedValue, idMapping);
    }
    return next;
  }

  return value;
}

// ============================================================================
// Named Handlers
// ============================================================================

async function handleResetBuiltins(_req: NextRequest, context: RequestContext) {
  const { user, repos } = context;
  const actionContext = 'characters-reset-builtins';

  try {
    const allCharacters = await repos.characters.findByUserId(user.id);
    const existingByName = new Map(
      allCharacters
        .filter(character => BUILTIN_CHARACTER_NAMES.some(name => name.toLowerCase() === character.name.toLowerCase()))
        .map(character => [character.name.toLowerCase(), character])
    );

    const preservedIds: Record<string, string | null> = {
      Lorian: existingByName.get('lorian')?.id ?? null,
      Riya: existingByName.get('riya')?.id ?? null,
    };

    logger.info('[Characters v1] Reset built-ins started', {
      context: actionContext,
      userId: user.id,
      preservedIds,
    });

    const deletedCharacters: string[] = [];

    for (const characterName of BUILTIN_CHARACTER_NAMES) {
      const existingCharacter = existingByName.get(characterName.toLowerCase());
      if (!existingCharacter) {
        continue;
      }

      const deleteResult = await executeCascadeDelete(existingCharacter.id, {
        deleteExclusiveChats: false,
        deleteExclusiveImages: false,
      });

      if (!deleteResult.success) {
        logger.error('[Characters v1] Failed deleting built-in character during reset', {
          context: actionContext,
          characterName,
          characterId: existingCharacter.id,
        });
        return serverError(`Failed to delete ${characterName} during reset`);
      }

      deletedCharacters.push(existingCharacter.id);
    }

    const seedImport = getSeedImports().find(entry => entry.filename === 'lorian-and-riya.qtap');
    if (!seedImport) {
      logger.error('[Characters v1] Built-in seed import missing', { context: actionContext });
      return badRequest('Built-in character seed data is unavailable');
    }

    const seedIdByName = findBuiltinCharacterIds(seedImport.data);

    const idMapping = new Map<string, string>();
    for (const characterName of BUILTIN_CHARACTER_NAMES) {
      const originalSeedId = seedIdByName[characterName];
      const preservedId = preservedIds[characterName];

      if (originalSeedId && preservedId && originalSeedId !== preservedId) {
        idMapping.set(originalSeedId, preservedId);
      }
    }

    const remappedImportData = replaceMappedIdsRecursively(seedImport.data, idMapping);
    const importResult = await executeImport(user.id, remappedImportData as typeof seedImport.data, {
      conflictStrategy: 'skip',
      includeMemories: true,
      includeRelatedEntities: false,
    });

    await reseedAvatarsForCharacters([...BUILTIN_CHARACTER_NAMES], actionContext);

    const refreshedCharacters = await repos.characters.findByUserId(user.id);
    const postResetIds: Record<string, string | null> = {
      Lorian: refreshedCharacters.find(character => character.name.toLowerCase() === 'lorian')?.id ?? null,
      Riya: refreshedCharacters.find(character => character.name.toLowerCase() === 'riya')?.id ?? null,
    };

    logger.info('[Characters v1] Reset built-ins completed', {
      context: actionContext,
      userId: user.id,
      deletedCharacterIds: deletedCharacters,
      preservedIds,
      postResetIds,
      importResult,
      remappedIdCount: idMapping.size,
    });

    return NextResponse.json({
      success: true,
      deletedCharacterIds: deletedCharacters,
      preservedIds,
      postResetIds,
      remappedIdCount: idMapping.size,
      importResult,
    });
  } catch (error) {
    logger.error('[Characters v1] Error resetting built-ins', {
      context: actionContext,
      userId: user.id,
    }, error instanceof Error ? error : undefined);
    return serverError('Failed to reset built-in characters');
  }
}

async function handleCreate(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  const body = await req.json();
  const validatedData = createCharacterSchema.parse(body);

  // Normalize scenarios: fill in missing id/createdAt/updatedAt
  const now = new Date().toISOString();
  const normalizedScenarios = (validatedData.scenarios || []).map(s => ({
    id: s.id ?? crypto.randomUUID(),
    title: s.title,
    content: s.content,
    createdAt: now,
    updatedAt: now,
  }));

  const character = await repos.characters.create({
    userId: user.id,
    name: validatedData.name,
    title: validatedData.title || null,
    identity: validatedData.identity || null,
    description: validatedData.description || null,
    manifesto: validatedData.manifesto || null,
    personality: validatedData.personality || null,
    scenarios: normalizedScenarios,
    firstMessage: validatedData.firstMessage || null,
    exampleDialogues: validatedData.exampleDialogues || null,
    defaultConnectionProfileId: validatedData.defaultConnectionProfileId || null,
    controlledBy: validatedData.controlledBy || 'llm',
    isFavorite: false,
    npc: validatedData.npc ?? false,
    tags: [] as string[],
    partnerLinks: [] as { partnerId: string; isDefault: boolean }[],
    avatarOverrides: [] as { chatId: string; imageId: string }[],
    defaultImageId: null,
    physicalDescription: validatedData.physicalDescription ?? null,
    systemPrompts: validatedData.systemPrompts || [],
  });

  logger.info('[Characters v1] Character created', {
    characterId: character.id,
    name: character.name,
    controlledBy: character.controlledBy || 'llm',
    npc: character.npc,
  });

  return NextResponse.json({ character }, { status: 201 });
}

async function handleQuickCreate(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  const body = await req.json();
  const validatedData = quickCreateSchema.parse(body);

  logger.info('[Characters v1] Quick creating character', {
    userId: user.id,
    name: validatedData.name,
  });

  const character = await repos.characters.create({
    userId: user.id,
    name: validatedData.name,
    title: null,
    description: 'Character created during chat import',
    manifesto: null,
    personality: null,
    scenarios: [],
    firstMessage: null,
    exampleDialogues: null,
    defaultConnectionProfileId: validatedData.defaultConnectionProfileId || null,
    isFavorite: false,
    tags: [] as string[],
    partnerLinks: [] as { partnerId: string; isDefault: boolean }[],
    avatarOverrides: [] as { chatId: string; imageId: string }[],
    defaultImageId: null,
    physicalDescription: null,
  });

  logger.info('[Characters v1] Quick create completed', {
    characterId: character.id,
    name: character.name,
  });

  return NextResponse.json({ character }, { status: 201 });
}

async function handleImport(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  try {
    const contentType = req.headers.get('content-type');

    let characterData = null;
    // SillyTavern character cards embed their JSON metadata in a PNG tEXt chunk;
    // the same PNG is the character's portrait. Keep the bytes so we can land
    // them in the new vault as the imported avatar.
    let pngAvatarBytes: Buffer | null = null;

    if (contentType?.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File;

      if (!file) {
        return badRequest('No file provided');
      }

      const buffer = Buffer.from(await file.arrayBuffer());

      if (file.type === 'image/png' || file.name.endsWith('.png')) {
        characterData = await parseSTCharacterPNG(buffer);

        if (!characterData) {
          return badRequest('Invalid SillyTavern PNG file');
        }

        pngAvatarBytes = buffer;
      } else if (file.type === 'application/json' || file.name.endsWith('.json')) {
        const jsonText = buffer.toString('utf-8');
        characterData = JSON.parse(jsonText);
      } else {
        return badRequest('Unsupported file type. Please upload PNG or JSON');
      }
    } else if (contentType?.includes('application/json')) {
      const body = await req.json();
      characterData = body.characterData || body;

      if (!characterData) {
        return badRequest('Character data is required');
      }
    } else {
      return badRequest('Unsupported content type');
    }

    const importedData = importSTCharacter(characterData);

    const character = await repos.characters.create({
      userId: user.id,
      ...importedData,
      isFavorite: false,
      tags: [] as string[],
      partnerLinks: [] as { partnerId: string; isDefault: boolean }[],
      avatarOverrides: [] as { chatId: string; imageId: string }[],
      defaultImageId: null,
      physicalDescription: null,
    });

    let defaultImageId: string | null = null;
    if (pngAvatarBytes) {
      // create() has already provisioned the vault; land the imported PNG
      // portrait inside it. No disk fallback: if the vault write fails the
      // character is still created (avatar regen from the UI can recover),
      // but bytes never leak into the catch-all _general/ space.
      try {
        const filename = `${character.name || 'avatar'}.png`;
        const written = await writeCharacterAvatarToVault({
          characterId: character.id,
          kind: 'main',
          filename,
          content: pngAvatarBytes,
          contentType: 'image/png',
        });
        // Post-Phase-3: defaultImageId is a doc_mount_file_links id pointing
        // at the avatar in the character's vault. The legacy `files` row
        // (and its CHARACTER tag) is no longer created.
        await repos.characters.update(character.id, { defaultImageId: written.linkId });
        defaultImageId = written.linkId;
      } catch (avatarError) {
        logger.error(
          '[Characters v1] Failed to persist imported SillyTavern avatar; character kept without portrait',
          {
            characterId: character.id,
            error: avatarError instanceof Error ? avatarError.message : String(avatarError),
          },
        );
      }
    }

    const chats = await repos.chats.findByCharacterId(character.id);

    logger.info('[Characters v1] Character imported', {
      characterId: character.id,
      name: character.name,
      hasAvatar: defaultImageId !== null,
    });

    return NextResponse.json(
      {
        character: {
          id: character.id,
          name: character.name,
          description: character.description,
          defaultImageId,
          createdAt: character.createdAt,
          updatedAt: character.updatedAt,
          _count: {
            chats: chats.length,
          },
        },
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error('[Characters v1] Error importing character', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to import character');
  }
}

async function handleAiWizard(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  const body = await req.json();
  const request = wizardRequestSchema.parse(body) as WizardRequest;

  logger.info('[Characters v1] AI Wizard starting', {
    userId: user.id,
    characterName: request.characterName,
    fieldsToGenerate: request.fieldsToGenerate,
    sourceType: request.sourceType,
  });

  const result = await runCharacterWizard(request, user.id, repos);

  return NextResponse.json(result);
}

async function handleAiWizardStream(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  const body = await req.json();
  const request = wizardRequestSchema.parse(body) as WizardRequest;

  logger.info('[Characters v1] AI Wizard starting (streaming)', {
    userId: user.id,
    characterName: request.characterName,
    fieldsToGenerate: request.fieldsToGenerate,
    sourceType: request.sourceType,
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (event: WizardProgressEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Stream may be closed
        }
      };

      await runCharacterWizardStreaming(request, user.id, repos, enqueue);

      try {
        controller.close();
      } catch {
        // Stream may already be closed
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

// ============================================================================
// Dispatch
// ============================================================================

export async function handlePost(
  req: NextRequest,
  ctx: RequestContext
): Promise<NextResponse> {
  const action = getActionParam(req);

  if (!action || !isValidAction(action, CHARACTERS_POST_ACTIONS)) {
    return handleCreate(req, ctx);
  }

  const actionHandlers: Record<CharactersPostAction, () => Promise<NextResponse>> = {
    'ai-wizard': () => handleAiWizard(req, ctx),
    'ai-wizard-stream': () => handleAiWizardStream(req, ctx),
    import: () => handleImport(req, ctx),
    'quick-create': () => handleQuickCreate(req, ctx),
    'reset-builtins': () => handleResetBuiltins(req, ctx),
  };

  return actionHandlers[action]();
}
