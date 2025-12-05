/**
 * Persona Avatar API Routes
 * PATCH /api/personas/:id/avatar - Set default avatar for persona
 *
 * Uses the repository pattern for file metadata management.
 * All avatars are stored as FileEntry objects with category 'AVATAR' or 'IMAGE'.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/repositories/factory';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import type { FileEntry } from '@/lib/json-store/schemas/types';

/**
 * Get the filepath for a file based on storage type
 */
function getFilePath(file: FileEntry): string {
  if (file.s3Key) {
    return `/api/files/${file.id}`;
  }
  const ext = file.originalFilename.includes('.')
    ? file.originalFilename.substring(file.originalFilename.lastIndexOf('.'))
    : '';
  return `data/files/storage/${file.id}${ext}`;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

const avatarSchema = z.object({
  imageId: z.string().nullable(),
});

/**
 * PATCH /api/personas/:id/avatar
 * Set or clear default avatar for a persona
 *
 * Only accepts file IDs from the file-manager system.
 * The file must:
 * - Belong to the authenticated user
 * - Have category 'IMAGE' or 'AVATAR'
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.debug('Unauthorized persona avatar update - no session', { context: 'personas-avatar-PATCH' });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const userId = session.user.id;
    const repos = getRepositories();

    logger.debug('Processing persona avatar update', { personaId: id, userId });

    const body = await request.json();
    const { imageId } = avatarSchema.parse(body);

    // Verify persona exists and belongs to user
    const persona = await repos.personas.findById(id);

    if (!persona || persona.userId !== userId) {
      logger.debug('Persona not found or unauthorized', { personaId: id, userId });
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
    }

    // If imageId is provided, verify it from repository
    if (imageId) {
      logger.debug('Validating file for persona avatar', { fileId: imageId, personaId: id });

      const fileEntry = await repos.files.findById(imageId);

      // Verify file exists
      if (!fileEntry) {
        logger.warn('File not found for persona avatar', { fileId: imageId, personaId: id });
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }

      // Verify file belongs to user
      if (fileEntry.userId !== userId) {
        logger.warn('File does not belong to user', {
          fileId: imageId,
          fileOwnerId: fileEntry.userId,
          userId,
        });
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }

      // Verify file category is valid for avatar
      const validCategories = ['IMAGE', 'AVATAR'];
      if (!validCategories.includes(fileEntry.category)) {
        logger.warn('File category invalid for avatar', {
          fileId: imageId,
          category: fileEntry.category,
        });
        return NextResponse.json(
          { error: `Invalid file category. Expected IMAGE or AVATAR, got ${fileEntry.category}` },
          { status: 400 }
        );
      }

      logger.debug('File validation passed for persona avatar', {
        fileId: imageId,
        filename: fileEntry.originalFilename,
        category: fileEntry.category,
      });
    } else {
      logger.debug('Clearing persona avatar', { personaId: id });
    }

    // Update persona with the file ID
    const updatedPersona = await repos.personas.update(id, { defaultImageId: imageId });

    logger.debug('Persona avatar updated successfully', {
      personaId: id,
      imageId: imageId || null,
    });

    // Build response with file info if image is set
    let defaultImage = null;
    if (updatedPersona?.defaultImageId) {
      const fileEntry = await repos.files.findById(updatedPersona.defaultImageId);
      if (fileEntry) {
        defaultImage = {
          id: fileEntry.id,
          filepath: getFilePath(fileEntry),
          url: null,
        };
        logger.debug('Built response with default image', {
          fileId: fileEntry.id,
          filename: fileEntry.originalFilename,
        });
      }
    }

    return NextResponse.json({
      data: {
        ...updatedPersona,
        defaultImage,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Validation error updating persona avatar', {
        context: 'personas-avatar-PATCH',
        errors: error.errors,
      });
      return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 });
    }

    logger.error(
      'Error updating persona avatar',
      { context: 'personas-avatar-PATCH' },
      error instanceof Error ? error : undefined
    );

    return NextResponse.json(
      { error: 'Failed to update persona avatar', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
