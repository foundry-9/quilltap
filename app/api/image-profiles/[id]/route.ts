/**
 * Individual Image Profile Operations
 * Phase 6: API Endpoints
 *
 * GET    /api/image-profiles/[id]  - Get a specific profile
 * PUT    /api/image-profiles/[id]  - Update a profile
 * DELETE /api/image-profiles/[id]  - Delete a profile
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ImageProvider } from '@/lib/types/prisma'
import { getImageGenProvider } from '@/lib/image-gen/factory'

/**
 * GET /api/image-profiles/[id]
 * Get a specific image generation profile
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const profile = await prisma.imageProfile.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
      include: {
        apiKey: {
          select: {
            id: true,
            label: true,
            provider: true,
            isActive: true,
          },
        },
        tags: {
          include: {
            tag: true,
          },
        },
      },
    })

    if (!profile) {
      return NextResponse.json(
        { error: 'Image profile not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(profile)
  } catch (error) {
    console.error('Failed to fetch image profile:', error)
    return NextResponse.json(
      { error: 'Failed to fetch image profile' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/image-profiles/[id]
 * Update an image generation profile
 *
 * Body: {
 *   name?: string,
 *   provider?: ImageProvider,
 *   apiKeyId?: string | null,
 *   baseUrl?: string | null,
 *   modelName?: string,
 *   parameters?: object,
 *   isDefault?: boolean
 * }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Verify ownership
    const existingProfile = await prisma.imageProfile.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
    })

    if (!existingProfile) {
      return NextResponse.json(
        { error: 'Image profile not found' },
        { status: 404 }
      )
    }

    const body = await req.json()
    const { name, provider, apiKeyId, baseUrl, modelName, parameters, isDefault } = body

    // Build update data
    const updateData: any = {}

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return NextResponse.json(
          { error: 'Name must be a non-empty string' },
          { status: 400 }
        )
      }

      // Check for duplicate name (excluding current profile)
      const duplicateProfile = await prisma.imageProfile.findFirst({
        where: {
          userId: session.user.id,
          name: name.trim(),
          NOT: { id },
        },
      })

      if (duplicateProfile) {
        return NextResponse.json(
          { error: 'An image profile with this name already exists' },
          { status: 409 }
        )
      }

      updateData.name = name.trim()
    }

    if (provider !== undefined) {
      if (!Object.values(ImageProvider).includes(provider as ImageProvider)) {
        return NextResponse.json(
          { error: `Invalid provider. Must be one of: ${Object.values(ImageProvider).join(', ')}` },
          { status: 400 }
        )
      }

      // Verify provider is available
      try {
        getImageGenProvider(provider)
      } catch {
        return NextResponse.json(
          { error: `Provider ${provider} is not available` },
          { status: 400 }
        )
      }

      updateData.provider = provider
    }

    if (apiKeyId !== undefined) {
      if (apiKeyId === null) {
        updateData.apiKeyId = null
      } else {
        // Validate the API key exists and belongs to user
        const apiKey = await prisma.apiKey.findFirst({
          where: {
            id: apiKeyId,
            userId: session.user.id,
          },
        })

        if (!apiKey) {
          return NextResponse.json(
            { error: 'API key not found' },
            { status: 404 }
          )
        }

        updateData.apiKeyId = apiKeyId
      }
    }

    if (baseUrl !== undefined) {
      updateData.baseUrl = baseUrl || null
    }

    if (modelName !== undefined) {
      if (typeof modelName !== 'string' || modelName.trim().length === 0) {
        return NextResponse.json(
          { error: 'Model name must be a non-empty string' },
          { status: 400 }
        )
      }
      updateData.modelName = modelName.trim()
    }

    if (parameters !== undefined) {
      if (typeof parameters !== 'object' || Array.isArray(parameters)) {
        return NextResponse.json(
          { error: 'Parameters must be an object' },
          { status: 400 }
        )
      }
      updateData.parameters = parameters
    }

    if (isDefault !== undefined) {
      if (typeof isDefault !== 'boolean') {
        return NextResponse.json(
          { error: 'isDefault must be a boolean' },
          { status: 400 }
        )
      }

      // If setting as default, unset other defaults
      if (isDefault) {
        await prisma.imageProfile.updateMany({
          where: {
            userId: session.user.id,
            isDefault: true,
            NOT: {
              id,
            },
          },
          data: {
            isDefault: false,
          },
        })
      }

      updateData.isDefault = isDefault
    }

    // Update the profile
    const updatedProfile = await prisma.imageProfile.update({
      where: {
        id,
      },
      data: updateData,
      include: {
        apiKey: {
          select: {
            id: true,
            label: true,
            provider: true,
            isActive: true,
          },
        },
        tags: {
          include: {
            tag: true,
          },
        },
      },
    })

    return NextResponse.json(updatedProfile)
  } catch (error) {
    console.error('Failed to update image profile:', error)
    return NextResponse.json(
      { error: 'Failed to update image profile' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/image-profiles/[id]
 * Delete an image generation profile
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Verify ownership
    const existingProfile = await prisma.imageProfile.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
    })

    if (!existingProfile) {
      return NextResponse.json(
        { error: 'Image profile not found' },
        { status: 404 }
      )
    }

    // Delete the profile
    await prisma.imageProfile.delete({
      where: {
        id,
      },
    })

    return NextResponse.json(
      { message: 'Image profile deleted successfully' },
      { status: 200 }
    )
  } catch (error) {
    console.error('Failed to delete image profile:', error)
    return NextResponse.json(
      { error: 'Failed to delete image profile' },
      { status: 500 }
    )
  }
}
