// Character Favorite API: Toggle favorite status
// PATCH /api/characters/:id/favorite - Toggle character favorite status

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'

// PATCH /api/characters/:id/favorite - Toggle favorite status
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify character ownership
    const existingCharacter = await repos.characters.findById(id)

    if (!existingCharacter || existingCharacter.userId !== user.id) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    // Toggle the isFavorite property
    const character = await repos.characters.setFavorite(id, !existingCharacter.isFavorite)

    return NextResponse.json({ character })
  } catch (error) {
    logger.error('Error toggling character favorite', { context: 'PATCH /api/characters/[id]/favorite' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to toggle favorite' },
      { status: 500 }
    )
  }
}
