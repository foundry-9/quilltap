/**
 * Individual Connection Profile Operations
 * Phase 0.3: Core Infrastructure
 *
 * GET    /api/profiles/[id]  - Get a specific profile
 * PUT    /api/profiles/[id]  - Update a profile
 * DELETE /api/profiles/[id]  - Delete a profile
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { ProviderEnum } from '@/lib/json-store/schemas/types'

// Get the list of valid providers from the Zod enum
const VALID_PROVIDERS = ProviderEnum.options

/**
 * GET /api/profiles/[id]
 * Get a specific connection profile
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
    const profile = await repos.connections.findById(id)

    if (!profile || profile.userId !== session.user.id) {
      return NextResponse.json(
        { error: 'Connection profile not found' },
        { status: 404 }
      )
    }

    // Get associated API key if present
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

    return NextResponse.json({
      ...profile,
      apiKey,
    })
  } catch (error) {
    console.error('Failed to fetch connection profile:', error)
    return NextResponse.json(
      { error: 'Failed to fetch connection profile' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/profiles/[id]
 * Update a connection profile
 *
 * Body: {
 *   name?: string,
 *   apiKeyId?: string,
 *   baseUrl?: string,
 *   modelName?: string,
 *   parameters?: object,
 *   isDefault?: boolean,
 *   isCheap?: boolean
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
    const existingProfile = await repos.connections.findById(id)

    if (!existingProfile || existingProfile.userId !== session.user.id) {
      return NextResponse.json(
        { error: 'Connection profile not found' },
        { status: 404 }
      )
    }

    const body = await req.json()
    const { name, provider, apiKeyId, baseUrl, modelName, parameters, isDefault, isCheap } = body

    // Build update data
    const updateData: any = {}

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return NextResponse.json(
          { error: 'Name must be a non-empty string' },
          { status: 400 }
        )
      }
      updateData.name = name.trim()
    }

    if (provider !== undefined) {
      if (!provider || !VALID_PROVIDERS.includes(provider)) {
        return NextResponse.json(
          { error: 'Invalid provider' },
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

        // Ensure provider matches - use new provider if being updated, otherwise use existing
        const providerToCheck = provider !== undefined ? provider : existingProfile.provider
        if (apiKey.provider !== providerToCheck) {
          return NextResponse.json(
            { error: 'API key provider does not match profile provider' },
            { status: 400 }
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
        const allProfiles = await repos.connections.findByUserId(session.user.id)
        for (const profile of allProfiles) {
          if (profile.isDefault && profile.id !== id) {
            await repos.connections.update(profile.id, { isDefault: false })
          }
        }
      }

      updateData.isDefault = isDefault
    }

    if (isCheap !== undefined) {
      if (typeof isCheap !== 'boolean') {
        return NextResponse.json(
          { error: 'isCheap must be a boolean' },
          { status: 400 }
        )
      }
      updateData.isCheap = isCheap
    }

    // Update the profile
    const updatedProfile = await repos.connections.update(id, updateData)

    if (!updatedProfile) {
      return NextResponse.json(
        { error: 'Failed to update connection profile' },
        { status: 500 }
      )
    }

    // Get associated API key if present
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

    return NextResponse.json({
      ...updatedProfile,
      apiKey,
    })
  } catch (error) {
    console.error('Failed to update connection profile:', error)
    return NextResponse.json(
      { error: 'Failed to update connection profile' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/profiles/[id]
 * Delete a connection profile
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
    const existingProfile = await repos.connections.findById(id)

    if (!existingProfile || existingProfile.userId !== session.user.id) {
      return NextResponse.json(
        { error: 'Connection profile not found' },
        { status: 404 }
      )
    }

    // Delete the profile
    await repos.connections.delete(id)

    return NextResponse.json(
      { message: 'Connection profile deleted successfully' },
      { status: 200 }
    )
  } catch (error) {
    console.error('Failed to delete connection profile:', error)
    return NextResponse.json(
      { error: 'Failed to delete connection profile' },
      { status: 500 }
    )
  }
}
