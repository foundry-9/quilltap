/**
 * Character-Persona Linking API
 * GET /api/characters/:id/personas - List personas linked to a character
 * POST /api/characters/:id/personas - Link a persona to a character
 * DELETE /api/characters/:id/personas - Unlink a persona from a character
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
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

    // Verify character belongs to user
    const character = await repos.characters.findById(id)

    if (!character || character.userId !== session.user.id) {
      return NextResponse.json(
        { error: 'Character not found' },
        { status: 404 }
      )
    }

    // Get persona details for each linked persona
    const personaLinks = await Promise.all(
      character.personaLinks.map(async (link) => {
        const persona = await repos.personas.findById(link.personaId)
        return persona
          ? {
              personaId: link.personaId,
              isDefault: link.isDefault,
              persona,
            }
          : null
      })
    )

    // Filter out null values (personas that no longer exist)
    const validLinks = personaLinks.filter(Boolean)

    return NextResponse.json(validLinks)
  } catch (error) {
    logger.error('Error fetching character personas', { context: 'GET /api/characters/[id]/personas' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to fetch character personas' },
      { status: 500 }
    )
  }
}

export async function POST(
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

    const body = await req.json()
    const { personaId, isDefault } = body

    if (!personaId) {
      return NextResponse.json(
        { error: 'Persona ID is required' },
        { status: 400 }
      )
    }

    // Verify character belongs to user
    const character = await repos.characters.findById(id)

    if (!character || character.userId !== session.user.id) {
      return NextResponse.json(
        { error: 'Character not found' },
        { status: 404 }
      )
    }

    // Verify persona belongs to user
    const persona = await repos.personas.findById(personaId)

    if (!persona || persona.userId !== session.user.id) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    // If setting as default, unset any existing default
    if (isDefault) {
      const updatedLinks = character.personaLinks.map((link) => ({
        ...link,
        isDefault: false,
      }))
      await repos.characters.update(id, { personaLinks: updatedLinks })
    }

    // Add persona link using repository method
    await repos.characters.addPersona(id, personaId, isDefault || false)

    // Get updated character to return the link
    const updatedCharacter = await repos.characters.findById(id)
    const link = updatedCharacter?.personaLinks.find((l) => l.personaId === personaId)

    return NextResponse.json(
      {
        personaId,
        isDefault: link?.isDefault || false,
        persona,
      },
      { status: 201 }
    )
  } catch (error) {
    logger.error('Error linking persona to character', { context: 'POST /api/characters/[id]/personas' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to link persona to character' },
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

    const { searchParams } = new URL(req.url)
    const personaId = searchParams.get('personaId')

    if (!personaId) {
      return NextResponse.json(
        { error: 'Persona ID is required' },
        { status: 400 }
      )
    }

    // Verify character belongs to user
    const character = await repos.characters.findById(id)

    if (!character || character.userId !== session.user.id) {
      return NextResponse.json(
        { error: 'Character not found' },
        { status: 404 }
      )
    }

    // Remove the persona link
    await repos.characters.removePersona(id, personaId)

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error unlinking persona from character', { context: 'DELETE /api/characters/[id]/personas' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to unlink persona from character' },
      { status: 500 }
    )
  }
}
