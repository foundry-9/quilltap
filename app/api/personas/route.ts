/**
 * Personas API
 * GET /api/personas - List all personas for authenticated user
 * POST /api/personas - Create a new persona
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const sortByCharacter = searchParams.get('sortByCharacter')

    const personas = await prisma.persona.findMany({
      where: {
        userId: session.user.id,
      },
      include: {
        characters: {
          include: {
            character: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        tags: {
          include: {
            tag: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    // If sortByCharacter is specified, sort by matching tags
    if (sortByCharacter) {
      // Get character tags
      const characterTags = await prisma.characterTag.findMany({
        where: { characterId: sortByCharacter },
        select: { tagId: true },
      })
      const characterTagIds = new Set(characterTags.map(ct => ct.tagId))

      // Sort personas by number of matching tags (descending)
      personas.sort((a, b) => {
        const aMatchingTags = a.tags.filter(pt => characterTagIds.has(pt.tagId)).length
        const bMatchingTags = b.tags.filter(pt => characterTagIds.has(pt.tagId)).length
        return bMatchingTags - aMatchingTags
      })

      // Add matching tags info to each persona
      const personasWithMatches = personas.map(persona => ({
        ...persona,
        matchingTags: persona.tags
          .filter(pt => characterTagIds.has(pt.tagId))
          .map(pt => pt.tag),
        matchingTagCount: persona.tags.filter(pt => characterTagIds.has(pt.tagId)).length,
      }))

      return NextResponse.json(personasWithMatches)
    }

    return NextResponse.json(personas)
  } catch (error) {
    console.error('Error fetching personas:', error)
    return NextResponse.json(
      { error: 'Failed to fetch personas' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { name, title, description, personalityTraits, avatarUrl, sillyTavernData } =
      body

    // Validate required fields
    if (!name || !description) {
      return NextResponse.json(
        { error: 'Name and description are required' },
        { status: 400 }
      )
    }

    const persona = await prisma.persona.create({
      data: {
        userId: session.user.id,
        name,
        title: title || null,
        description,
        personalityTraits: personalityTraits || null,
        avatarUrl: avatarUrl || null,
        sillyTavernData: sillyTavernData || null,
      },
    })

    return NextResponse.json(persona, { status: 201 })
  } catch (error) {
    console.error('Error creating persona:', error)
    return NextResponse.json(
      { error: 'Failed to create persona' },
      { status: 500 }
    )
  }
}
