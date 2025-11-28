/**
 * Images API Routes
 * POST /api/images - Upload or import image
 * GET /api/images - List images with optional filtering
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getRepositories } from '@/lib/json-store/repositories';
import { uploadImage, importImageFromUrl } from '@/lib/images';
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
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const repos = getRepositories();
    const searchParams = request.nextUrl.searchParams;
    const tagType = searchParams.get('tagType') as 'CHARACTER' | 'PERSONA' | 'CHAT' | 'THEME' | null;
    const tagId = searchParams.get('tagId');

    // Get all images for user
    let images = await repos.images.findByUserId(session.user.id);

    // Filter by tag if provided
    // Note: In the JSON store, tags are stored as an array of tag IDs on the image
    // The tagType/tagId filtering was Prisma-specific; we filter by tagId here
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
        // Note: CHAT tags would require loading chats, but we don't currently use those
        return { tagId, tagType };
      });

      return {
        id: img.id,
        userId: img.userId,
        filename: img.filename,
        filepath: img.relativePath,
        url: null,
        mimeType: img.mimeType,
        size: img.size,
        width: img.width,
        height: img.height,
        source: img.source,
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
    console.error('Error fetching images:', error);
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
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const repos = getRepositories();
    const contentType = request.headers.get('content-type') || '';

    // Handle URL import (JSON payload)
    if (contentType.includes('application/json')) {
      const body = await request.json();
      const { url, tags } = importFromUrlSchema.parse(body);

      // Import image from URL
      const imageData = await importImageFromUrl(url, session.user.id);

      // Create image record in JSON store
      const image = await repos.images.create({
        userId: session.user.id,
        sha256: crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''),
        type: 'image',
        filename: imageData.filename,
        relativePath: imageData.filepath,
        mimeType: imageData.mimeType,
        size: imageData.size,
        width: imageData.width,
        height: imageData.height,
        source: 'import',
        tags: tags ? tags.map(t => t.tagId) : [],
      });

      // Transform response to match expected format
      const responseData = {
        id: image.id,
        userId: image.userId,
        filename: image.filename,
        filepath: image.relativePath,
        url: url,
        mimeType: image.mimeType,
        size: image.size,
        width: image.width,
        height: image.height,
        source: image.source,
        createdAt: image.createdAt,
        updatedAt: image.updatedAt,
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

      // Upload image
      const imageData = await uploadImage(file, session.user.id);

      // Create image record in JSON store
      const image = await repos.images.create({
        userId: session.user.id,
        sha256: crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''),
        type: 'image',
        filename: imageData.filename,
        relativePath: imageData.filepath,
        mimeType: imageData.mimeType,
        size: imageData.size,
        width: imageData.width,
        height: imageData.height,
        source: 'upload',
        tags: tags ? tags.map(t => t.tagId) : [],
      });

      // Transform response to match expected format
      const responseData = {
        id: image.id,
        userId: image.userId,
        filename: image.filename,
        filepath: image.relativePath,
        url: null,
        mimeType: image.mimeType,
        size: image.size,
        width: image.width,
        height: image.height,
        source: image.source,
        createdAt: image.createdAt,
        updatedAt: image.updatedAt,
        tags: tags || [],
      };

      return NextResponse.json({ data: responseData });
    }

    return NextResponse.json({ error: 'Invalid content type' }, { status: 400 });
  } catch (error) {
    console.error('Error uploading/importing image:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 });
    }

    return NextResponse.json(
      { error: 'Failed to upload/import image', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
