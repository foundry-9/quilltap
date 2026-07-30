/**
 * Images API v1 - Individual Image Endpoint
 *
 * GET /api/v1/images/[id] - Get a specific image
 * DELETE /api/v1/images/[id] - Delete an image
 * POST /api/v1/images/[id]?action=add-tag - Add tag to image
 * POST /api/v1/images/[id]?action=remove-tag - Remove tag from image
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, exists } from '@/lib/api/middleware';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import { getFilePath } from '@/lib/api/middleware/file-path';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { successResponse, notFound, badRequest, serverError, forbidden } from '@/lib/api/responses';
import { getPhotoLinkSummaryBySha256 } from '@/lib/photos/photo-link-summary';

// Post-photos-Phase-3: 'CHARACTER' tag is no longer accepted here. Character
// galleries are sourced from each character's vault `photos/` folder via
// /api/v1/characters/[id]/photos — tagging an image-v2 row with a character
// id no longer affects what the Aurora gallery surfaces.
const addTagSchema = z.object({
  tagType: z.enum(['CHAT', 'THEME']),
  tagId: z.string(),
});

const removeTagSchema = z.object({
  tagId: z.string(),
});

const IMAGE_POST_ACTIONS = ['add-tag', 'remove-tag'] as const;
type ImagePostAction = typeof IMAGE_POST_ACTIONS[number];

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createContextParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  try {
    const image = await repos.files.findById(id);

    if (!image) {
      return notFound('Image');
    }

    // Verify file category
    if (image.category !== 'IMAGE' && image.category !== 'AVATAR') {
      return notFound('Image');
    }

    // Count usages by checking related entities
    const allCharacters = await repos.characters.findByUserId(user.id);

    const charactersUsingAsDefault = allCharacters.filter(c => c.defaultImageId === id).length;
    const chatAvatarOverrides = allCharacters.reduce((count, c) => {
      return count + c.avatarOverrides.filter(o => o.imageId === id).length;
    }, 0);

    // Map source to old format
    const source = image.source === 'UPLOADED' ? 'upload' :
                   image.source === 'IMPORTED' ? 'import' :
                   image.source === 'GENERATED' ? 'generated' : 'upload';

    // Determine tag types
    const characterIds = new Set(allCharacters.map(c => c.id));
    const tags = image.tags.map((tagId: string) => {
      let tagType: 'CHARACTER' | 'CHAT' | 'THEME' = 'THEME';
      if (characterIds.has(tagId)) {
        tagType = 'CHARACTER';
      }
      return { tagId, tagType };
    });

    // Build character gallery links from the photo-link-summary: which
    // character vaults contain a copy of this image's bytes?
    const characterGalleryLinks: Array<{ characterId: string; characterName: string; linkId: string }> = [];
    if (image.sha256) {
      const mountToCharacter = new Map<string, { id: string; name: string }>();
      for (const c of allCharacters) {
        if ((c as any).characterDocumentMountPointId) {
          mountToCharacter.set((c as any).characterDocumentMountPointId, { id: c.id, name: c.name });
        }
      }
      const summary = await getPhotoLinkSummaryBySha256(image.sha256, repos);
      for (const linker of summary.linkers) {
        if (linker.mountStoreType === 'character' && linker.isPhotoAlbum) {
          const char = mountToCharacter.get(linker.mountPointId);
          if (char) {
            characterGalleryLinks.push({
              characterId: char.id,
              characterName: char.name,
              linkId: linker.linkId,
            });
          }
        }
      }
    }

    return successResponse({
      data: {
        id: image.id,
        userId: user.id,
        filename: image.originalFilename,
        filepath: getFilePath(image),
        mimeType: image.mimeType,
        size: image.size,
        width: image.width,
        height: image.height,
        source,
        generationPrompt: image.generationPrompt,
        generationModel: image.generationModel,
        createdAt: image.createdAt,
        updatedAt: image.updatedAt,
        tags,
        characterGalleryLinks,
        _count: {
          charactersUsingAsDefault,
          chatAvatarOverrides,
        },
      },
    });
  } catch (error) {
    logger.error('[Images v1] Error fetching image', { imageId: (req as any).params?.id }, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch image');
  }
});

// ============================================================================
// DELETE Handler
// ============================================================================

export const DELETE = createContextParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  try {
    // Check if image exists
    const image = await repos.files.findById(id);

    if (!image) {
      return notFound('Image');
    }

    // Verify file category
    if (image.category !== 'IMAGE' && image.category !== 'AVATAR') {
      return notFound('Image');
    }

    // Check if the underlying file actually exists in storage (to detect orphaned metadata)
    let fileExists = false;
    if (image.storageKey) {
      try {
        fileExists = await fileStorageManager.fileExists(image);
      } catch {
        // Storage file does not exist (orphaned)
      }
    }

    // Count usages by checking related entities
    const allCharacters = await repos.characters.findByUserId(user.id);

    const charactersUsingAsDefault = allCharacters.filter(c => c.defaultImageId === id);
    const chatAvatarOverrides = allCharacters.reduce((acc, c) => {
      const overrides = c.avatarOverrides.filter(o => o.imageId === id);
      return overrides.length > 0 ? [...acc, { characterId: c.id, overrides }] : acc;
    }, [] as Array<{ characterId: string; overrides: Array<{ chatId: string; imageId: string }> }>);

    // Check if image is being used
    const isInUse =
      charactersUsingAsDefault.length > 0 ||
      chatAvatarOverrides.length > 0;

    // If the file is orphaned (doesn't exist), clean up references and allow deletion
    if (!fileExists && isInUse) {
      logger.info('[Images v1] Cleaning up references to orphaned image', {
        imageId: id,
        charactersUsingAsDefault: charactersUsingAsDefault.length,
        chatAvatarOverrides: chatAvatarOverrides.length,
      });

      // Clear defaultImageId on characters
      for (const character of charactersUsingAsDefault) {
        await repos.characters.update(character.id, { defaultImageId: null });
      }

      // Clear avatar overrides
      for (const { characterId, overrides } of chatAvatarOverrides) {
        const character = allCharacters.find(c => c.id === characterId);
        if (character) {
          const updatedOverrides = character.avatarOverrides.filter(o => o.imageId !== id);
          await repos.characters.update(characterId, { avatarOverrides: updatedOverrides });
        }
      }
    } else if (isInUse) {
      // File exists and is in use - don't allow deletion
      return badRequest('Image is in use', {
        message: 'This image is currently being used as an avatar or in chat overrides. Please remove all usages before deleting.',
        code: 'IMAGE_IN_USE',
        associations: {
          charactersUsingAsDefault: charactersUsingAsDefault.length,
          chatAvatarOverrides: chatAvatarOverrides.length,
        },
      });
    }

    // Delete from storage if file has storageKey
    if (image.storageKey) {
      try {
        await fileStorageManager.deleteFile(image);
      } catch (storageError) {
        logger.warn('[Images v1] Failed to delete from storage', {
          imageId: id,
          storageKey: image.storageKey,
          error: storageError instanceof Error ? storageError.message : 'Unknown error',
        });
        // Continue with metadata deletion even if storage deletion fails
      }
    }

    // Delete file metadata from repository
    const deleted = await repos.files.delete(id);

    if (!deleted) {
      logger.warn('[Images v1] Failed to delete file metadata', { imageId: id });
      return serverError('Failed to delete image');
    }

    logger.info('[Images v1] Image deleted successfully', {
      imageId: id,
      filename: image.originalFilename,
    });

    return successResponse({ success: true });
  } catch (error) {
    logger.error('[Images v1] Error deleting image', { imageId: (req as any).params?.id }, error instanceof Error ? error : undefined);
    return serverError('Failed to delete image');
  }
});

// ============================================================================
// POST Handler - Actions
// ============================================================================

export const POST = createContextParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  const action = getActionParam(req);

  // Verify ownership first
  const image = await repos.files.findById(id);
  if (!image) {
    return notFound('Image');
  }

  if (!isValidAction(action, IMAGE_POST_ACTIONS)) {
    return badRequest(`Unknown action: ${action}. Available actions: ${IMAGE_POST_ACTIONS.join(', ')}`);
  }

  const actionHandlers: Record<ImagePostAction, () => Promise<NextResponse>> = {
    'add-tag': () => handleAddTag(req, user, repos, id, image),
    'remove-tag': () => handleRemoveTag(req, user, repos, id, image),
  };

  return actionHandlers[action]();
});

// ============================================================================
// Helper: Add Tag
// ============================================================================

async function handleAddTag(req: NextRequest, user: any, repos: any, imageId: string, image: any): Promise<NextResponse> {
  const body = await req.json();
  const { tagType, tagId } = addTagSchema.parse(body);

  // Verify file is an image
  if (image.category !== 'IMAGE') {
    return badRequest('File is not an image');
  }

  // Verify the tagged entity exists and belongs to user
  const entityError = await verifyTaggedEntity(tagType, tagId, user.id, repos);
  if (entityError) {
    return entityError;
  }

  // Check if tag already exists
  const alreadyTagged = image.tags && image.tags.includes(tagId);

  if (alreadyTagged) {
    return successResponse({
      data: {
        imageId,
        tagType,
        tagId,
        alreadyTagged: true,
      },
    });
  }

  // Add tag to file using repository
  await repos.files.addTag(imageId, tagId);

  logger.info('[Images v1] Tag added to image', {
    imageId,
    tagId,
    tagType,
  });

  return successResponse(
    {
      data: {
        imageId,
        tagType,
        tagId,
      },
    },
    201
  );
}

// ============================================================================
// Helper: Remove Tag
// ============================================================================

async function handleRemoveTag(req: NextRequest, user: any, repos: any, imageId: string, image: any): Promise<NextResponse> {
  const body = await req.json();
  const { tagId } = removeTagSchema.parse(body);

  // Remove the tag using repository
  await repos.files.removeTag(imageId, tagId);

  logger.info('[Images v1] Tag removed from image', {
    imageId,
    tagId,
  });

  return successResponse({ success: true });
}

// ============================================================================
// Helper: Verify Tagged Entity
// ============================================================================

async function verifyTaggedEntity(
  tagType: 'CHAT' | 'THEME',
  tagId: string,
  userId: string,
  repos: any
): Promise<NextResponse | null> {
  if (tagType === 'CHAT') {
    const chat = await repos.chats.findById(tagId);
    if (!chat) {
      return notFound('Chat');
    }
  }

  return null;
}
