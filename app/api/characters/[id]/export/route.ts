/**
 * Character Export API
 * GET /api/characters/:id/export - Export a character in SillyTavern format
 * Supports JSON and PNG (with embedded character card) formats
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { exportSTCharacter, createSTCharacterPNG } from '@/lib/sillytavern/character'

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
    const { searchParams } = new URL(req.url)
    const format = searchParams.get('format') || 'json' // json or png

    // Get character
    const character = await prisma.character.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
    })

    if (!character) {
      return NextResponse.json(
        { error: 'Character not found' },
        { status: 404 }
      )
    }

    // Export to SillyTavern format
    const stCharacter = exportSTCharacter(character)

    if (format === 'png') {
      // Export as PNG with embedded character card
      if (!character.avatarUrl) {
        return NextResponse.json(
          { error: 'Character must have an avatar for PNG export' },
          { status: 400 }
        )
      }

      try {
        // TODO: Fetch avatar image from URL or storage
        // For now, return an error that this feature needs avatar storage
        return NextResponse.json(
          {
            error:
              'PNG export requires avatar storage implementation. Use JSON export for now.',
          },
          { status: 501 }
        )

        // When avatar storage is implemented:
        // const avatarBuffer = await fetchAvatarBuffer(character.avatarUrl)
        // const pngBuffer = await createSTCharacterPNG(character, avatarBuffer)
        // return new NextResponse(pngBuffer, {
        //   headers: {
        //     'Content-Type': 'image/png',
        //     'Content-Disposition': `attachment; filename="${character.name}.png"`,
        //   },
        // })
      } catch (error) {
        console.error('Error creating PNG export:', error)
        return NextResponse.json(
          { error: 'Failed to create PNG export' },
          { status: 500 }
        )
      }
    } else {
      // Export as JSON
      return new NextResponse(JSON.stringify(stCharacter, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${character.name}.json"`,
        },
      })
    }
  } catch (error) {
    console.error('Error exporting character:', error)
    return NextResponse.json(
      { error: 'Failed to export character' },
      { status: 500 }
    )
  }
}
