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
import { getRepositories } from '@/lib/json-store/repositories'
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

    const repos = getRepositories()
    const profile = await repos.imageProfiles.findById(id)

    if (!profile || profile.userId !== session.user.id) {
      return NextResponse.json(
        { error: 'Image profile not found' },
        { status: 404 }
      )
    }

    // Enrich with API key info
    let apiKey = null
    if (profile.apiKeyId) {
      const key = await repos.connections.findApiKeyById(profile.apiKeyId)
      if (key) {
        apiKey = {
          id: key.id,
          label: key.label,
          provider: key.provider,
          isActive: key.isActive,
        }
      }
    }

    // Get tag details
    const tagDetails = await Promise.all(
      profile.tags.map(async (tagId) => {
        const tag = await repos.tags.findById(tagId)
        return tag ? { tagId, tag } : null
      })
    )

    return NextResponse.json({
      ...profile,
      apiKey,
      tags: tagDetails.filter(Boolean),
    })
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

    const repos = getRepositories()

    // Verify ownership
    const existingProfile = await repos.imageProfiles.findById(id)

    if (!existingProfile || existingProfile.userId !== session.user.id) {
      return NextResponse.json(
        { error: 'Image profile not found' },
        { status: 404 }
      )
    }

    const body = await req.json()
    const { name, provider, apiKeyId, baseUrl, modelName, parameters, isDefault } = body

    // Build update data
    const updateData: Record<string, any> = {}

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return NextResponse.json(
          { error: 'Name must be a non-empty string' },
          { status: 400 }
        )
      }

      // Check for duplicate name (excluding current profile)
      const duplicateProfile = await repos.imageProfiles.findByName(session.user.id, name.trim())

      if (duplicateProfile && duplicateProfile.id !== id) {
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
        // Validate the API key exists
        const apiKey = await repos.connections.findApiKeyById(apiKeyId)

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
        await repos.imageProfiles.unsetAllDefaults(session.user.id)
      }

      updateData.isDefault = isDefault
    }

    // Update the profile
    const updatedProfile = await repos.imageProfiles.update(id, updateData)

    if (!updatedProfile) {
      return NextResponse.json(
        { error: 'Failed to update profile' },
        { status: 500 }
      )
    }

    // Enrich with API key info
    let apiKey = null
    if (updatedProfile.apiKeyId) {
      const key = await repos.connections.findApiKeyById(updatedProfile.apiKeyId)
      if (key) {
        apiKey = {
          id: key.id,
          label: key.label,
          provider: key.provider,
          isActive: key.isActive,
        }
      }
    }

    // Get tag details
    const tagDetails = await Promise.all(
      updatedProfile.tags.map(async (tagId) => {
        const tag = await repos.tags.findById(tagId)
        return tag ? { tagId, tag } : null
      })
    )

    return NextResponse.json({
      ...updatedProfile,
      apiKey,
      tags: tagDetails.filter(Boolean),
    })
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

    const repos = getRepositories()

    // Verify ownership
    const existingProfile = await repos.imageProfiles.findById(id)

    if (!existingProfile || existingProfile.userId !== session.user.id) {
      return NextResponse.json(
        { error: 'Image profile not found' },
        { status: 404 }
      )
    }

    // Delete the profile
    await repos.imageProfiles.delete(id)

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
