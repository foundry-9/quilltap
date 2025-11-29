/**
 * Individual Image API Routes
 * GET /api/images/:id - Get single image
 * DELETE /api/images/:id - Delete image
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getRepositories } from '@/lib/json-store/repositories';
import { findFileById, deleteFile } from '@/lib/file-manager';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/images/:id
 * Get a single image by ID
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const repos = getRepositories();

    const image = await findFileById(id);

    if (!image || image.category !== 'IMAGE') {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    // Count usages by checking related entities
    const allCharacters = await repos.characters.findAll();
    const allPersonas = await repos.personas.findAll();

    const charactersUsingAsDefault = allCharacters.filter(c => c.defaultImageId === id).length;
    const personasUsingAsDefault = allPersonas.filter(p => p.defaultImageId === id).length;
    const chatAvatarOverrides = allCharacters.reduce((count, c) => {
      return count + c.avatarOverrides.filter(o => o.imageId === id).length;
    }, 0);

    // Map source to old format
    const source = image.source === 'UPLOADED' ? 'upload' :
                   image.source === 'IMPORTED' ? 'import' :
                   image.source === 'GENERATED' ? 'generated' : 'upload';

    return NextResponse.json({
      data: {
        id: image.id,
        userId: session.user.id,
        filename: image.originalFilename,
        filepath: `/data/files/storage/${id}.${image.originalFilename.split('.').pop()}`,
        mimeType: image.mimeType,
        size: image.size,
        width: image.width,
        height: image.height,
        source,
        generationPrompt: image.generationPrompt,
        generationModel: image.generationModel,
        createdAt: image.createdAt,
        updatedAt: image.updatedAt,
        tags: image.tags,
        _count: {
          charactersUsingAsDefault,
          personasUsingAsDefault,
          chatAvatarOverrides,
        },
      }
    });
  } catch (error) {
    console.error('Error fetching image:', error);
    return NextResponse.json(
      { error: 'Failed to fetch image', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/images/:id
 * Delete an image
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const repos = getRepositories();

    // Check if image exists
    const image = await findFileById(id);

    if (!image || image.category !== 'IMAGE') {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    // Count usages by checking related entities
    const allCharacters = await repos.characters.findAll();
    const allPersonas = await repos.personas.findAll();

    const charactersUsingAsDefault = allCharacters.filter(c => c.defaultImageId === id).length;
    const personasUsingAsDefault = allPersonas.filter(p => p.defaultImageId === id).length;
    const chatAvatarOverrides = allCharacters.reduce((count, c) => {
      return count + c.avatarOverrides.filter(o => o.imageId === id).length;
    }, 0);

    // Check if image is being used
    const isInUse =
      charactersUsingAsDefault > 0 ||
      personasUsingAsDefault > 0 ||
      chatAvatarOverrides > 0;

    if (isInUse) {
      return NextResponse.json(
        {
          error: 'Image is in use',
          details:
            'This image is currently being used as an avatar or in chat overrides. Please remove all usages before deleting.',
        },
        { status: 400 }
      );
    }

    // Delete file and metadata
    await deleteFile(id);

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error('Error deleting image:', error);
    return NextResponse.json(
      { error: 'Failed to delete image', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
