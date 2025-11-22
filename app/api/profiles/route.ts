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
import { prisma } from '@/lib/prisma'
import { Provider } from '@/lib/types/prisma'
import { supportsImageGeneration } from '@/lib/llm/image-capable'

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

    let profiles = await prisma.connectionProfile.findMany({
      where: {
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
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'desc' },
      ],
    })

    // Filter to image-capable providers if requested
    if (imageCapable) {
      profiles = profiles.filter(profile => supportsImageGeneration(profile.provider))
    }

    // If sortByCharacter is specified, sort by matching tags
    if (sortByCharacter) {
      // Get character tags
      const characterTags = await prisma.characterTag.findMany({
        where: { characterId: sortByCharacter },
        select: { tagId: true },
      })
      const characterTagIds = new Set(characterTags.map(ct => ct.tagId))

      // Get persona tags if sortByPersona is specified
      const personaTags = sortByPersona
        ? await prisma.personaTag.findMany({
            where: { personaId: sortByPersona },
            select: { tagId: true },
          })
        : []
      const personaTagIds = new Set(personaTags.map(pt => pt.tagId))

      // Combine tag IDs
      const allTagIds = new Set([...characterTagIds, ...personaTagIds])

      // Sort profiles by number of matching tags (descending)
      profiles.sort((a, b) => {
        const aMatchingTags = a.tags.filter(cpt => allTagIds.has(cpt.tagId)).length
        const bMatchingTags = b.tags.filter(cpt => allTagIds.has(cpt.tagId)).length

        // If same number of matches, prefer default profile
        if (aMatchingTags === bMatchingTags) {
          return b.isDefault ? 1 : a.isDefault ? -1 : 0
        }

        return bMatchingTags - aMatchingTags
      })

      // Add matching tags info to each profile
      const profilesWithMatches = profiles.map(profile => ({
        ...profile,
        matchingTags: profile.tags
          .filter(cpt => allTagIds.has(cpt.tagId))
          .map(cpt => cpt.tag),
        matchingTagCount: profile.tags.filter(cpt => allTagIds.has(cpt.tagId)).length,
      }))

      return NextResponse.json(profilesWithMatches)
    }

    return NextResponse.json(profiles)
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

    if (!provider || !Object.values(Provider).includes(provider as Provider)) {
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

    // Validate apiKeyId if provided
    if (apiKeyId) {
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
      await prisma.connectionProfile.updateMany({
        where: {
          userId: session.user.id,
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
      })
    }

    // Create profile
    const profile = await prisma.connectionProfile.create({
      data: {
        userId: session.user.id,
        name: name.trim(),
        provider: provider as Provider,
        apiKeyId: apiKeyId || null,
        baseUrl: baseUrl || null,
        modelName: modelName.trim(),
        parameters: parameters,
        isDefault,
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
      },
    })

    return NextResponse.json(profile, { status: 201 })
  } catch (error) {
    console.error('Failed to create connection profile:', error)
    return NextResponse.json(
      { error: 'Failed to create connection profile' },
      { status: 500 }
    )
  }
}
