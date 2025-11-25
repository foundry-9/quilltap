/**
 * Connection Profile Management Routes
 * Phase 0.3: Core Infrastructure
 *
 * GET    /api/profiles   - List all connection profiles for current user
 * POST   /api/profiles   - Create a new connection profile
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { Provider, ProviderEnum } from '@/lib/json-store/schemas/types'
import { supportsImageGeneration } from '@/lib/llm/image-capable'

// Get the list of valid providers from the Zod enum
const VALID_PROVIDERS = ProviderEnum.options

/**
 * GET /api/profiles
 * List all connection profiles for the authenticated user
 * Query params:
 *   - sortByCharacter: Character ID to sort profiles by matching tags
 *   - sortByPersona: Persona ID to sort profiles by matching tags (used with sortByCharacter)
 *   - imageCapable: 'true' to filter only image-generation-capable providers
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

    const { searchParams } = new URL(req.url)
    const sortByCharacter = searchParams.get('sortByCharacter')
    const sortByPersona = searchParams.get('sortByPersona')
    const imageCapable = searchParams.get('imageCapable') === 'true'

    const repos = getRepositories()

    // Get all connection profiles for user
    let profiles = await repos.connections.findByUserId(session.user.id)

    // Enrich with API key info and tags
    let enrichedProfiles = await Promise.all(
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

    // Filter to image-capable providers if requested
    if (imageCapable) {
      enrichedProfiles = enrichedProfiles.filter(profile => supportsImageGeneration(profile.provider))
    }

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
    console.error('Failed to fetch connection profiles:', error)
    return NextResponse.json(
      { error: 'Failed to fetch connection profiles' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/profiles
 * Create a new connection profile
 *
 * Body: {
 *   name: string,
 *   provider: Provider,
 *   apiKeyId?: string,
 *   baseUrl?: string,
 *   modelName: string,
 *   parameters?: {
 *     temperature?: number,
 *     max_tokens?: number,
 *     top_p?: number,
 *     ...
 *   },
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

    if (!provider || !VALID_PROVIDERS.includes(provider)) {
      return NextResponse.json(
        { error: 'Invalid provider' },
        { status: 400 }
      )
    }

    if (!modelName || typeof modelName !== 'string' || modelName.trim().length === 0) {
      return NextResponse.json(
        { error: 'Model name is required' },
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

      // Ensure provider matches
      if (apiKey.provider !== provider) {
        return NextResponse.json(
          { error: 'API key provider does not match profile provider' },
          { status: 400 }
        )
      }
    }

    // Validate baseUrl for providers that need it
    if ((provider === 'OLLAMA' || provider === 'OPENAI_COMPATIBLE') && !baseUrl) {
      return NextResponse.json(
        { error: `Base URL is required for ${provider}` },
        { status: 400 }
      )
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      const existingProfiles = await repos.connections.findByUserId(session.user.id)
      for (const existingProfile of existingProfiles) {
        if (existingProfile.isDefault) {
          await repos.connections.update(existingProfile.id, { isDefault: false })
        }
      }
    }

    // Create profile
    const profile = await repos.connections.create({
      userId: session.user.id,
      name: name.trim(),
      provider: provider as Provider,
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
    console.error('Failed to create connection profile:', error)
    return NextResponse.json(
      { error: 'Failed to create connection profile' },
      { status: 500 }
    )
  }
}
