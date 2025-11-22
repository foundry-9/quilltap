/**
 * Image Profile Management Routes
 * Phase 6: API Endpoints
 *
 * GET    /api/image-profiles   - List all image profiles for current user
 * POST   /api/image-profiles   - Create a new image profile
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ImageProvider } from '@/lib/types/prisma'
import { getImageGenProvider } from '@/lib/image-gen/factory'

/**
 * GET /api/image-profiles
 * List all image generation profiles for the authenticated user
 * Query params:
 *   - sortByCharacter: Character ID to sort profiles by matching tags
 *   - sortByPersona: Persona ID to sort profiles by matching tags (used with sortByCharacter)
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

    let profiles = await prisma.imageProfile.findMany({
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
        const aMatchingTags = a.tags.filter(ipt => allTagIds.has(ipt.tagId)).length
        const bMatchingTags = b.tags.filter(ipt => allTagIds.has(ipt.tagId)).length

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
          .filter(ipt => allTagIds.has(ipt.tagId))
          .map(ipt => ipt.tag),
        matchingTagCount: profile.tags.filter(ipt => allTagIds.has(ipt.tagId)).length,
      }))

      return NextResponse.json(profilesWithMatches)
    }

    return NextResponse.json(profiles)
  } catch (error) {
    console.error('Failed to fetch image profiles:', error)
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

    // Validate provider
    if (!provider || !Object.values(ImageProvider).includes(provider as ImageProvider)) {
      return NextResponse.json(
        { error: `Invalid provider. Must be one of: ${Object.values(ImageProvider).join(', ')}` },
        { status: 400 }
      )
    }

    // Verify provider is available (can instantiate)
    try {
      getImageGenProvider(provider)
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

      // Check if this API key provider matches an image provider
      // Image providers have different provider types (OPENAI, GROK are in LLM Provider enum too)
      // But Google Imagen uses a different key type
    }

    // Check for duplicate name
    const existingProfile = await prisma.imageProfile.findFirst({
      where: {
        userId: session.user.id,
        name: name.trim(),
      },
    })

    if (existingProfile) {
      return NextResponse.json(
        { error: 'An image profile with this name already exists' },
        { status: 409 }
      )
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      await prisma.imageProfile.updateMany({
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
    const profile = await prisma.imageProfile.create({
      data: {
        userId: session.user.id,
        name: name.trim(),
        provider: provider as ImageProvider,
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
    console.error('Failed to create image profile:', error)
    return NextResponse.json(
      { error: 'Failed to create image profile' },
      { status: 500 }
    )
  }
}
