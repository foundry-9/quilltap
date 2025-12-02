// Cascade Delete Preview API
// GET /api/characters/:id/cascade-preview - Get preview of what will be deleted

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { getCascadeDeletePreview } from '@/lib/cascade-delete'
import { logger } from '@/lib/logger'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify character ownership
    const character = await repos.characters.findById(id)

    if (!character || character.userId !== user.id) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    const preview = await getCascadeDeletePreview(id)

    if (!preview) {
      return NextResponse.json({ error: 'Failed to generate preview' }, { status: 500 })
    }

    // Transform to a simpler response format for the frontend
    return NextResponse.json({
      characterId: preview.characterId,
      characterName: preview.characterName,
      exclusiveChats: preview.exclusiveChats.map(c => ({
        id: c.chat.id,
        title: c.chat.title,
        messageCount: c.messageCount,
        lastMessageAt: c.chat.lastMessageAt,
      })),
      exclusiveCharacterImageCount: preview.exclusiveCharacterImages.length,
      exclusiveChatImageCount: preview.exclusiveChatImages.length,
      totalExclusiveImageCount:
        preview.exclusiveCharacterImages.length + preview.exclusiveChatImages.length,
      memoryCount: preview.memoryCount,
    })
  } catch (error) {
    logger.error('Error generating cascade delete preview', { context: 'GET /api/characters/:id/cascade-preview' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to generate preview' },
      { status: 500 }
    )
  }
}
