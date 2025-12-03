/**
 * Individual Embedding Profile Operations
 *
 * GET    /api/embedding-profiles/[id]  - Get a specific profile
 * PUT    /api/embedding-profiles/[id]  - Update a profile
 * DELETE /api/embedding-profiles/[id]  - Delete a profile
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/json-store/repositories'
import { logger } from '@/lib/logger'

/**
 * GET /api/embedding-profiles/[id]
 * Get a specific embedding profile
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const repos = getRepositories()
    const profile = await repos.embeddingProfiles.findById(id)

    if (!profile || profile.userId !== session.user.id) {
      return NextResponse.json(
        { error: 'Embedding profile not found' },
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
    logger.error('Failed to fetch embedding profile', { endpoint: '/api/embedding-profiles/[id]', method: 'GET' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to fetch embedding profile' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/embedding-profiles/[id]
 * Update an embedding profile
 *
 * Body: {
 *   name?: string,
 *   provider?: 'OPENAI' | 'OLLAMA',
 *   apiKeyId?: string | null,
 *   baseUrl?: string | null,
 *   modelName?: string,
 *   dimensions?: number | null,
 *   isDefault?: boolean
 * }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const repos = getRepositories()

    // Verify ownership
    const existingProfile = await repos.embeddingProfiles.findById(id)

    if (!existingProfile || existingProfile.userId !== session.user.id) {
      return NextResponse.json(
        { error: 'Embedding profile not found' },
        { status: 404 }
      )
    }

    const body = await req.json()
    const { name, provider, apiKeyId, baseUrl, modelName, dimensions, isDefault } = body

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
      const duplicateProfile = await repos.embeddingProfiles.findByName(session.user.id, name.trim())

      if (duplicateProfile && duplicateProfile.id !== id) {
        return NextResponse.json(
          { error: 'An embedding profile with this name already exists' },
          { status: 409 }
        )
      }

      updateData.name = name.trim()
    }

    if (provider !== undefined) {
      if (typeof provider !== 'string' || provider.trim().length === 0) {
        return NextResponse.json(
          { error: 'Provider must be a non-empty string' },
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

    if (dimensions !== undefined) {
      if (dimensions === null) {
        updateData.dimensions = null
      } else if (typeof dimensions !== 'number' || dimensions <= 0) {
        return NextResponse.json(
          { error: 'Dimensions must be a positive number' },
          { status: 400 }
        )
      } else {
        updateData.dimensions = dimensions
      }
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
        await repos.embeddingProfiles.unsetAllDefaults(session.user.id)
      }

      updateData.isDefault = isDefault
    }

    // Update the profile
    const updatedProfile = await repos.embeddingProfiles.update(id, updateData)

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
    logger.error('Failed to update embedding profile', { endpoint: '/api/embedding-profiles/[id]', method: 'PUT' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to update embedding profile' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/embedding-profiles/[id]
 * Delete an embedding profile
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const repos = getRepositories()

    // Verify ownership
    const existingProfile = await repos.embeddingProfiles.findById(id)

    if (!existingProfile || existingProfile.userId !== session.user.id) {
      return NextResponse.json(
        { error: 'Embedding profile not found' },
        { status: 404 }
      )
    }

    // Delete the profile
    await repos.embeddingProfiles.delete(id)

    return NextResponse.json(
      { message: 'Embedding profile deleted successfully' },
      { status: 200 }
    )
  } catch (error) {
    logger.error('Failed to delete embedding profile', { endpoint: '/api/embedding-profiles/[id]', method: 'DELETE' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to delete embedding profile' },
      { status: 500 }
    )
  }
}
