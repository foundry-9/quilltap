// Character Favorite API: Toggle favorite status
// PATCH /api/characters/:id/favorite - Toggle character favorite status

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// PATCH /api/characters/:id/favorite - Toggle favorite status
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify character ownership
    const existingCharacter = await prisma.character.findFirst({
      where: {
        id,
        userId: user.id,
      },
    })

    if (!existingCharacter) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    // Toggle the isFavorite property
    const character = await prisma.character.update({
      where: { id },
      data: {
        isFavorite: !existingCharacter.isFavorite,
      },
    })

    return NextResponse.json({ character })
  } catch (error) {
    console.error('Error toggling character favorite:', error)
    return NextResponse.json(
      { error: 'Failed to toggle favorite' },
      { status: 500 }
    )
  }
}
