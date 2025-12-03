/**
 * Images API Routes
 * POST /api/images - Upload or import image
 * GET /api/images - List images with optional filtering
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/json-store/repositories';
import { uploadImage, importImageFromUrl } from '@/lib/images-v2';
import { findFilesByCategory, findFilesByUserId, addFileTag, getFileUrl } from '@/lib/file-manager';
import { logger } from '@/lib/logger';
import { z } from 'zod';

const importFromUrlSchema = z.object({
  url: z.string().url(),
  tags: z
    .array(
      z.object({
        tagType: z.enum(['CHARACTER', 'PERSONA', 'CHAT', 'THEME']),
        tagId: z.string(),
      })
    )
    .optional(),
});

/**
 * GET /api/images
 * List images with optional filtering by tags
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const repos = getRepositories();
    const searchParams = request.nextUrl.searchParams;
    const tagId = searchParams.get('tagId');

    // Get all image files
    let allImages = await findFilesByCategory('IMAGE');
    let images = allImages.filter(img => img.userId === session.user.id);

    // Filter by tag if provided
    if (tagId) {
      images = images.filter(img => img.tags.includes(tagId));
    }

    // Sort by createdAt descending
    images.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Transform to match expected API response format
    // Calculate usage counts by checking related entities
    const [allCharacters, allPersonas] = await Promise.all([
      repos.characters.findByUserId(session.user.id),
      repos.personas.findByUserId(session.user.id),
    ]);

    // Build tag type lookup maps
    const characterIds = new Set(allCharacters.map(c => c.id));
    const personaIds = new Set(allPersonas.map(p => p.id));

    const data = images.map(img => {
      // Count characters using this image as default
      const charactersUsingAsDefault = allCharacters.filter(
        c => c.defaultImageId === img.id
      ).length;

      // Count personas using this image as default
      const personasUsingAsDefault = allPersonas.filter(
        p => p.defaultImageId === img.id
      ).length;

      // Count chat avatar overrides (from character avatarOverrides)
      let chatAvatarOverrides = 0;
      for (const char of allCharacters) {
        if (char.avatarOverrides) {
          chatAvatarOverrides += char.avatarOverrides.filter(
            override => override.imageId === img.id
          ).length;
        }
      }

      // Determine tag type for each tag ID
      const tags = img.tags.map(tagId => {
        let tagType: 'CHARACTER' | 'PERSONA' | 'CHAT' | 'THEME' = 'THEME';
        if (characterIds.has(tagId)) {
          tagType = 'CHARACTER';
        } else if (personaIds.has(tagId)) {
          tagType = 'PERSONA';
        }
        return { tagId, tagType };
      });

      // Map source to old format
      const source = img.source === 'UPLOADED' ? 'upload' :
                     img.source === 'IMPORTED' ? 'import' :
                     img.source === 'GENERATED' ? 'generated' : 'upload';

      return {
        id: img.id,
        userId: session.user.id,
        filename: img.originalFilename,
        filepath: getFileUrl(img.id, img.originalFilename),
        url: img.source === 'IMPORTED' ? img.description : null,
        mimeType: img.mimeType,
        size: img.size,
        width: img.width,
        height: img.height,
        source,
        generationPrompt: img.generationPrompt,
        generationModel: img.generationModel,
        createdAt: img.createdAt,
        updatedAt: img.updatedAt,
        tags,
        _count: {
          charactersUsingAsDefault,
          personasUsingAsDefault,
          chatAvatarOverrides,
        },
      };
    });

    return NextResponse.json({ data });
  } catch (error) {
    logger.error('Error fetching images:', {}, error as Error);
    return NextResponse.json(
      { error: 'Failed to fetch images', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/images
 * Upload image file or import from URL
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const contentType = request.headers.get('content-type') || '';

    // Handle URL import (JSON payload)
    if (contentType.includes('application/json')) {
      const body = await request.json();
      const { url, tags } = importFromUrlSchema.parse(body);

      // Build linkedTo array from tags
      const linkedTo = tags ? tags.map(t => t.tagId) : [];

      // Import image from URL (creates file entry automatically)
      const imageData = await importImageFromUrl(url, session.user.id, linkedTo);

      // Add tags to the file
      if (tags) {
        for (const tag of tags) {
          await addFileTag(imageData.id, tag.tagId);
        }
      }

      // Transform response to match expected format
      const responseData = {
        id: imageData.id,
        userId: session.user.id,
        filename: imageData.filename,
        filepath: imageData.filepath,
        url: url,
        mimeType: imageData.mimeType,
        size: imageData.size,
        width: imageData.width,
        height: imageData.height,
        source: 'import',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tags: tags || [],
      };

      return NextResponse.json({ data: responseData });
    }

    // Handle file upload (multipart/form-data)
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      const tagsJson = formData.get('tags') as string | null;

      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      }

      // Parse tags if provided
      let tags: Array<{ tagType: 'CHARACTER' | 'PERSONA' | 'CHAT' | 'THEME'; tagId: string }> | undefined;
      if (tagsJson) {
        try {
          tags = JSON.parse(tagsJson);
        } catch {
          return NextResponse.json({ error: 'Invalid tags JSON' }, { status: 400 });
        }
      }

      // Build linkedTo array from tags
      const linkedTo = tags ? tags.map(t => t.tagId) : [];

      // Upload image (creates file entry automatically)
      const imageData = await uploadImage(file, session.user.id, linkedTo);

      // Add tags to the file
      if (tags) {
        for (const tag of tags) {
          await addFileTag(imageData.id, tag.tagId);
        }
      }

      // Transform response to match expected format
      const responseData = {
        id: imageData.id,
        userId: session.user.id,
        filename: imageData.filename,
        filepath: imageData.filepath,
        url: null,
        mimeType: imageData.mimeType,
        size: imageData.size,
        width: imageData.width,
        height: imageData.height,
        source: 'upload',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tags: tags || [],
      };

      return NextResponse.json({ data: responseData });
    }

    return NextResponse.json({ error: 'Invalid content type' }, { status: 400 });
  } catch (error) {
    logger.error('Error uploading/importing image:', {}, error as Error);

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 });
    }

    return NextResponse.json(
      { error: 'Failed to upload/import image', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
