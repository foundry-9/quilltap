/**
 * Embedding Profile Management Routes
 *
 * GET    /api/embedding-profiles   - List all embedding profiles for current user
 * POST   /api/embedding-profiles   - Create a new embedding profile
 *
 * Embedding profiles are used for text embedding connections.
 * Supported providers: OpenAI, Ollama
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { EmbeddingProfileProviderEnum, type EmbeddingProfileProvider } from '@/lib/json-store/schemas/types'

/**
 * GET /api/embedding-profiles
 * List all embedding profiles for the authenticated user
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const repos = getRepositories()

    // Get all embedding profiles for user
    const profiles = await repos.embeddingProfiles.findByUserId(session.user.id)

    // Enrich with API key info and tags
    const enrichedProfiles = await Promise.all(
      profiles.map(async (profile) => {
        // Get API key info if exists
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

        return {
          ...profile,
          apiKey,
          tags: tagDetails.filter(Boolean),
        }
      })
    )

    // Sort by default first, then by creation date
    enrichedProfiles.sort((a, b) => {
      if (a.isDefault !== b.isDefault) {
        return b.isDefault ? 1 : -1
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })

    return NextResponse.json(enrichedProfiles)
  } catch (error) {
    console.error('Failed to fetch embedding profiles:', error)
    return NextResponse.json(
      { error: 'Failed to fetch embedding profiles' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/embedding-profiles
 * Create a new embedding profile
 *
 * Body: {
 *   name: string,
 *   provider: 'OPENAI' | 'OLLAMA',
 *   apiKeyId?: string,
 *   baseUrl?: string,
 *   modelName: string,
 *   dimensions?: number,
 *   isDefault?: boolean
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await req.json()
    const {
      name,
      provider,
      apiKeyId,
      baseUrl,
      modelName,
      dimensions,
      isDefault = false,
    } = body

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      )
    }

    // Validate provider
    const validProviders = EmbeddingProfileProviderEnum.options
    if (!provider || !validProviders.includes(provider)) {
      return NextResponse.json(
        { error: `Invalid provider. Must be one of: ${validProviders.join(', ')}` },
        { status: 400 }
      )
    }

    if (!modelName || typeof modelName !== 'string' || modelName.trim().length === 0) {
      return NextResponse.json(
        { error: 'Model name is required' },
        { status: 400 }
      )
    }

    // Validate dimensions if provided
    if (dimensions !== undefined && (typeof dimensions !== 'number' || dimensions <= 0)) {
      return NextResponse.json(
        { error: 'Dimensions must be a positive number' },
        { status: 400 }
      )
    }

    const repos = getRepositories()

    // Validate apiKeyId if provided
    if (apiKeyId) {
      const apiKey = await repos.connections.findApiKeyById(apiKeyId)

      if (!apiKey) {
        return NextResponse.json(
          { error: 'API key not found' },
          { status: 404 }
        )
      }
    }

    // Check for duplicate name
    const existingProfile = await repos.embeddingProfiles.findByName(session.user.id, name.trim())

    if (existingProfile) {
      return NextResponse.json(
        { error: 'An embedding profile with this name already exists' },
        { status: 409 }
      )
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      await repos.embeddingProfiles.unsetAllDefaults(session.user.id)
    }

    // Create profile
    const profile = await repos.embeddingProfiles.create({
      userId: session.user.id,
      name: name.trim(),
      provider: provider as EmbeddingProfileProvider,
      apiKeyId: apiKeyId || null,
      baseUrl: baseUrl || null,
      modelName: modelName.trim(),
      dimensions: dimensions || null,
      isDefault,
      tags: [],
    })

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

    return NextResponse.json({ ...profile, apiKey }, { status: 201 })
  } catch (error) {
    console.error('Failed to create embedding profile:', error)
    return NextResponse.json(
      { error: 'Failed to create embedding profile' },
      { status: 500 }
    )
  }
}
