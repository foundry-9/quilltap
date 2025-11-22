/**
 * Images API Routes
 * POST /api/images - Upload or import image
 * GET /api/images - List images with optional filtering
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
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

    const searchParams = request.nextUrl.searchParams;
    const tagType = searchParams.get('tagType') as 'CHARACTER' | 'PERSONA' | 'CHAT' | 'THEME' | null;
    const tagId = searchParams.get('tagId');

    const where: any = {
      userId: session.user.id,
    };

    // Filter by tags if provided
    if (tagType && tagId) {
      where.tags = {
        some: {
          tagType,
          tagId,
        },
      };
    }

    const images = await prisma.image.findMany({
      where,
      include: {
        tags: true,
        _count: {
          select: {
            charactersUsingAsDefault: true,
            personasUsingAsDefault: true,
            chatAvatarOverrides: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json({ data: images });
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

    const contentType = request.headers.get('content-type') || '';

    // Handle URL import (JSON payload)
    if (contentType.includes('application/json')) {
      const body = await request.json();
      const { url, tags } = importFromUrlSchema.parse(body);

      // Import image from URL
      const imageData = await importImageFromUrl(url, session.user.id);

      // Create image record in database
      const image = await prisma.image.create({
        data: {
          userId: session.user.id,
          filename: imageData.filename,
          filepath: imageData.filepath,
          url: url,
          mimeType: imageData.mimeType,
          size: imageData.size,
          width: imageData.width,
          height: imageData.height,
          source: 'import',
          tags: tags
            ? {
                create: tags.map((tag) => ({
                  tagType: tag.tagType,
                  tagId: tag.tagId,
                })),
              }
            : undefined,
        },
        include: {
          tags: true,
        },
      });

      return NextResponse.json({ data: image });
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
        } catch (error) {
          return NextResponse.json({ error: 'Invalid tags JSON' }, { status: 400 });
        }
      }

      // Upload image
      const imageData = await uploadImage(file, session.user.id);

      // Create image record in database
      const image = await prisma.image.create({
        data: {
          userId: session.user.id,
          filename: imageData.filename,
          filepath: imageData.filepath,
          mimeType: imageData.mimeType,
          size: imageData.size,
          width: imageData.width,
          height: imageData.height,
          source: 'upload',
          tags: tags
            ? {
                create: tags.map((tag) => ({
                  tagType: tag.tagType,
                  tagId: tag.tagId,
                })),
              }
            : undefined,
        },
        include: {
          tags: true,
        },
      });

      return NextResponse.json({ data: image });
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
