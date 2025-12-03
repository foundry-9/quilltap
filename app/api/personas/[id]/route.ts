/**
 * Individual Persona API
 * GET /api/personas/:id - Get a specific persona
 * PUT /api/personas/:id - Update a persona
 * DELETE /api/personas/:id - Delete a persona
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/json-store/repositories'
import { findFileById, getFileUrl } from '@/lib/file-manager'
import { logger } from '@/lib/logger'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const repos = getRepositories()

    const persona = await repos.personas.findById(id)

    if (!persona || persona.userId !== session.user.id) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    // Get default image from file-manager if present
    let defaultImage = null
    if (persona.defaultImageId) {
      const fileEntry = await findFileById(persona.defaultImageId)
      if (fileEntry) {
        defaultImage = {
          id: fileEntry.id,
          filepath: getFileUrl(fileEntry.id, fileEntry.originalFilename),
          url: null,
        }
      }
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
      defaultImage,
      characters: characters.filter(Boolean),
    }

    return NextResponse.json(enrichedPersona)
  } catch (error) {
    logger.error('Error fetching persona', { context: 'GET /api/personas/:id' }, error instanceof Error ? error : undefined)
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
    const session = await getServerSession()

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

    // Get default image from file-manager for response
    let defaultImage = null
    if (persona?.defaultImageId) {
      const fileEntry = await findFileById(persona.defaultImageId)
      if (fileEntry) {
        defaultImage = {
          id: fileEntry.id,
          filepath: getFileUrl(fileEntry.id, fileEntry.originalFilename),
          url: null,
        }
      }
    }

    return NextResponse.json({
      ...persona,
      defaultImage,
    })
  } catch (error) {
    logger.error('Error updating persona', { context: 'PUT /api/personas/:id' }, error instanceof Error ? error : undefined)
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
    const session = await getServerSession()

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

    // Note: We don't delete the image file when deleting a persona
    // The image may be used elsewhere or the user may want to keep it in their gallery

    await repos.personas.delete(id)

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting persona', { context: 'DELETE /api/personas/:id' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to delete persona' },
      { status: 500 }
    )
  }
}
