/**
 * Individual Persona API
 * GET /api/personas/:id - Get a specific persona
 * PUT /api/personas/:id - Update a persona
 * DELETE /api/personas/:id - Delete a persona
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const repos = getRepositories()

    const persona = await repos.personas.findById(id)

    if (!persona || persona.userId !== session.user.id) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    // Get default image if present
    let defaultImage = null
    if (persona.defaultImageId) {
      defaultImage = await repos.images.findById(persona.defaultImageId)
    }

    // Get character links with details
    const characters = await Promise.all(
      persona.characterLinks.map(async (characterId) => {
        const character = await repos.characters.findById(characterId)
        return character
          ? {
              character: {
                id: character.id,
                name: character.name,
                avatarUrl: character.avatarUrl,
              },
            }
          : null
      })
    )

    const enrichedPersona = {
      ...persona,
      defaultImage: defaultImage
        ? {
            id: defaultImage.id,
            filepath: defaultImage.relativePath,
            url: null,
          }
        : null,
      characters: characters.filter(Boolean),
    }

    return NextResponse.json(enrichedPersona)
  } catch (error) {
    console.error('Error fetching persona:', error)
    return NextResponse.json(
      { error: 'Failed to fetch persona' },
      { status: 500 }
    )
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const repos = getRepositories()

    // Verify persona belongs to user
    const existing = await repos.personas.findById(id)

    if (!existing || existing.userId !== session.user.id) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    const body = await req.json()
    const { name, title, description, personalityTraits, avatarUrl, sillyTavernData } =
      body

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (title !== undefined) updateData.title = title
    if (description !== undefined) updateData.description = description
    if (personalityTraits !== undefined) updateData.personalityTraits = personalityTraits
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl
    if (sillyTavernData !== undefined) updateData.sillyTavernData = sillyTavernData

    const persona = await repos.personas.update(id, updateData)

    // Get default image for response
    let defaultImage = null
    if (persona?.defaultImageId) {
      defaultImage = await repos.images.findById(persona.defaultImageId)
    }

    return NextResponse.json({
      ...persona,
      defaultImage: defaultImage
        ? {
            id: defaultImage.id,
            filepath: defaultImage.relativePath,
            url: null,
          }
        : null,
    })
  } catch (error) {
    console.error('Error updating persona:', error)
    return NextResponse.json(
      { error: 'Failed to update persona' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const repos = getRepositories()

    // Verify persona belongs to user
    const existing = await repos.personas.findById(id)

    if (!existing || existing.userId !== session.user.id) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    // Clean up any image reference if the persona has a defaultImageId
    if (existing.defaultImageId) {
      try {
        await repos.images.update(existing.defaultImageId, {
          tags: [],
        })
      } catch (err) {
        // Silently fail if image cleanup doesn't work - persona deletion is more important
        console.error('Failed to clean up image reference:', err)
      }
    }

    await repos.personas.delete(id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting persona:', error)
    return NextResponse.json(
      { error: 'Failed to delete persona' },
      { status: 500 }
    )
  }
}
