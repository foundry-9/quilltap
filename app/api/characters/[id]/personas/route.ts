/**
 * Character-Persona Linking API
 * GET /api/characters/:id/personas - List personas linked to a character
 * POST /api/characters/:id/personas - Link a persona to a character
 * DELETE /api/characters/:id/personas - Unlink a persona from a character
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify character belongs to user
    const character = await prisma.character.findFirst({
      where: {
        id: params.id,
        userId: session.user.id,
      },
      include: {
        personas: {
          include: {
            persona: true,
          },
        },
      },
    })

    if (!character) {
      return NextResponse.json(
        { error: 'Character not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(character.personas)
  } catch (error) {
    console.error('Error fetching character personas:', error)
    return NextResponse.json(
      { error: 'Failed to fetch character personas' },
      { status: 500 }
    )
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { personaId, isDefault } = body

    if (!personaId) {
      return NextResponse.json(
        { error: 'Persona ID is required' },
        { status: 400 }
      )
    }

    // Verify character belongs to user
    const character = await prisma.character.findFirst({
      where: {
        id: params.id,
        userId: session.user.id,
      },
    })

    if (!character) {
      return NextResponse.json(
        { error: 'Character not found' },
        { status: 404 }
      )
    }

    // Verify persona belongs to user
    const persona = await prisma.persona.findFirst({
      where: {
        id: personaId,
        userId: session.user.id,
      },
    })

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    // If setting as default, unset any existing default
    if (isDefault) {
      await prisma.characterPersona.updateMany({
        where: {
          characterId: params.id,
        },
        data: {
          isDefault: false,
        },
      })
    }

    // Create or update the link
    const link = await prisma.characterPersona.upsert({
      where: {
        characterId_personaId: {
          characterId: params.id,
          personaId,
        },
      },
      create: {
        characterId: params.id,
        personaId,
        isDefault: isDefault || false,
      },
      update: {
        isDefault: isDefault !== undefined ? isDefault : undefined,
      },
      include: {
        persona: true,
      },
    })

    return NextResponse.json(link, { status: 201 })
  } catch (error) {
    console.error('Error linking persona to character:', error)
    return NextResponse.json(
      { error: 'Failed to link persona to character' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const personaId = searchParams.get('personaId')

    if (!personaId) {
      return NextResponse.json(
        { error: 'Persona ID is required' },
        { status: 400 }
      )
    }

    // Verify character belongs to user
    const character = await prisma.character.findFirst({
      where: {
        id: params.id,
        userId: session.user.id,
      },
    })

    if (!character) {
      return NextResponse.json(
        { error: 'Character not found' },
        { status: 404 }
      )
    }

    // Delete the link
    await prisma.characterPersona.delete({
      where: {
        characterId_personaId: {
          characterId: params.id,
          personaId,
        },
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error unlinking persona from character:', error)
    return NextResponse.json(
      { error: 'Failed to unlink persona from character' },
      { status: 500 }
    )
  }
}
