/**
 * Image Profile Management Routes
 * Phase 6: API Endpoints
 *
 * GET    /api/image-profiles   - List all image profiles for current user
 * POST   /api/image-profiles   - Create a new image profile
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/json-store/repositories'
import { logger } from '@/lib/logger'
import { createImageProvider } from '@/lib/llm/plugin-factory'

/**
 * GET /api/image-profiles
 * List all image generation profiles for the authenticated user
 * Query params:
 *   - sortByCharacter: Character ID to sort profiles by matching tags
 *   - sortByPersona: Persona ID to sort profiles by matching tags (used with sortByCharacter)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(req.url)
    const sortByCharacter = searchParams.get('sortByCharacter')
    const sortByPersona = searchParams.get('sortByPersona')

    const repos = getRepositories()

    // Get all image profiles for user
    let profiles = await repos.imageProfiles.findByUserId(session.user.id)

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

    // If sortByCharacter is specified, sort by matching tags
    if (sortByCharacter) {
      // Get character tags
      const character = await repos.characters.findById(sortByCharacter)
      const characterTagIds = new Set(character?.tags || [])

      // Get persona tags if sortByPersona is specified
      let personaTagIds = new Set<string>()
      if (sortByPersona) {
        const persona = await repos.personas.findById(sortByPersona)
        personaTagIds = new Set(persona?.tags || [])
      }

      // Combine tag IDs
      const allTagIds = new Set([...characterTagIds, ...personaTagIds])

      // Sort profiles by number of matching tags (descending)
      enrichedProfiles.sort((a, b) => {
        const aMatchingTags = a.tags.filter((t: any) => allTagIds.has(t.tagId)).length
        const bMatchingTags = b.tags.filter((t: any) => allTagIds.has(t.tagId)).length

        // If same number of matches, prefer default profile
        if (aMatchingTags === bMatchingTags) {
          return b.isDefault ? 1 : a.isDefault ? -1 : 0
        }

        return bMatchingTags - aMatchingTags
      })

      // Add matching tags info to each profile
      const profilesWithMatches = enrichedProfiles.map(profile => ({
        ...profile,
        matchingTags: profile.tags
          .filter((t: any) => allTagIds.has(t.tagId))
          .map((t: any) => t.tag),
        matchingTagCount: profile.tags.filter((t: any) => allTagIds.has(t.tagId)).length,
      }))

      return NextResponse.json(profilesWithMatches)
    }

    return NextResponse.json(enrichedProfiles)
  } catch (error) {
    logger.error('Failed to fetch image profiles', { endpoint: '/api/image-profiles', method: 'GET' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to fetch image profiles' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/image-profiles
 * Create a new image generation profile
 *
 * Body: {
 *   name: string,
 *   provider: ImageProvider,
 *   apiKeyId?: string,
 *   baseUrl?: string,
 *   modelName: string,
 *   parameters?: {
 *     quality?: 'standard' | 'hd',
 *     style?: 'vivid' | 'natural',
 *     aspectRatio?: string,
 *     negativePrompt?: string,
 *     ...
 *   },
 *   isDefault?: boolean
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession()
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
      parameters = {},
      isDefault = false,
    } = body

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      )
    }

    // Validate provider by attempting to get it
    if (!provider || typeof provider !== 'string') {
      return NextResponse.json(
        { error: 'Provider is required' },
        { status: 400 }
      )
    }

    try {
      createImageProvider(provider)
    } catch {
      return NextResponse.json(
        { error: `Provider ${provider} is not available` },
        { status: 400 }
      )
    }

    if (!modelName || typeof modelName !== 'string' || modelName.trim().length === 0) {
      return NextResponse.json(
        { error: 'Model name is required' },
        { status: 400 }
      )
    }

    // Validate parameters is an object
    if (typeof parameters !== 'object' || Array.isArray(parameters)) {
      return NextResponse.json(
        { error: 'Parameters must be an object' },
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

      // Check if this API key provider matches an image provider
      // Image providers have different provider types (OPENAI, GROK are in LLM Provider enum too)
      // But Google Imagen uses a different key type
    }

    // Check for duplicate name
    const existingProfile = await repos.imageProfiles.findByName(session.user.id, name.trim())

    if (existingProfile) {
      return NextResponse.json(
        { error: 'An image profile with this name already exists' },
        { status: 409 }
      )
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      await repos.imageProfiles.unsetAllDefaults(session.user.id)
    }

    // Create profile
    const profile = await repos.imageProfiles.create({
      userId: session.user.id,
      name: name.trim(),
      provider: provider,
      apiKeyId: apiKeyId || null,
      baseUrl: baseUrl || null,
      modelName: modelName.trim(),
      parameters: parameters,
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
    logger.error('Failed to create image profile', { endpoint: '/api/image-profiles', method: 'POST' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to create image profile' },
      { status: 500 }
    )
  }
}
