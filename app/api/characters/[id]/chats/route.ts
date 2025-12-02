// Character Chats API: Get recent chats involving this character
// GET /api/characters/:id/chats - List recent chats with this character
// Query params:
//   - search: Search in title and message content
//   - limit: Number of results (default 10)
//   - offset: Pagination offset (default 0)

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { logger } from '@/lib/logger'

// GET /api/characters/:id/chats - Get recent chats for this character
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

    // Parse query parameters
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.toLowerCase() || ''
    const limit = parseInt(searchParams.get('limit') || '10', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    // Verify character belongs to user
    const character = await repos.characters.findById(id)

    if (!character || character.userId !== user.id) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    // Get chats with this character
    const allChats = await repos.chats.findByCharacterId(id)

    // Filter by user and sort by updatedAt descending
    let userChats = allChats
      .filter((chat) => chat.userId === user.id)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

    // Pre-fetch messages for search if needed, and for enrichment
    const chatsWithMessages = await Promise.all(
      userChats.map(async (chat) => {
        const allMessages = await repos.chats.getMessages(chat.id)
        return { chat, messages: allMessages }
      })
    )

    // Apply search filter if provided
    let filteredChats = chatsWithMessages
    if (search) {
      filteredChats = chatsWithMessages.filter(({ chat, messages }) => {
        // Search in title
        if (chat.title?.toLowerCase().includes(search)) {
          return true
        }
        // Search in message content
        return messages.some(msg =>
          msg.type === 'message' && msg.content.toLowerCase().includes(search)
        )
      })
    }

    // Apply pagination
    const paginatedChats = filteredChats.slice(offset, offset + limit)

    // Enrich chats with related data
    const enrichedChats = await Promise.all(
      paginatedChats.map(async ({ chat, messages }) => {
        // Get persona participant if present
        const personaParticipant = chat.participants.find(p => p.type === 'PERSONA' && p.personaId)
        let persona = null
        if (personaParticipant?.personaId) {
          const personaData = await repos.personas.findById(personaParticipant.personaId)
          if (personaData) {
            persona = {
              id: personaData.id,
              name: personaData.name,
              title: personaData.title,
            }
          }
        }

        // Get tags
        const tagData = await Promise.all(
          (chat.tags || []).map(async (tagId) => {
            const tag = await repos.tags.findById(tagId)
            return tag ? { tag: { id: tag.id, name: tag.name } } : null
          })
        )
        logger.debug('Fetched tags for chat', { context: 'GET /api/characters/:id/chats', chatId: chat.id, tagCount: tagData.filter(Boolean).length })

        // Get all messages and count them for badge
        const messageCount = messages.filter((msg) => msg.type === 'message').length

        // Get last 3 messages for preview
        const recentMessages = messages
          .filter((msg) => msg.type === 'message')
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 3)
          .map((msg) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            createdAt: msg.createdAt,
          }))

        return {
          id: chat.id,
          title: chat.title,
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt,
          character: {
            id: character.id,
            name: character.name,
          },
          persona,
          messages: recentMessages,
          tags: tagData.filter((tag): tag is { tag: { id: string; name: string } } => tag !== null),
          _count: {
            messages: messageCount,
          },
        }
      })
    )

    return NextResponse.json({ chats: enrichedChats })
  } catch (error) {
    logger.error('Error fetching character chats', { context: 'GET /api/characters/:id/chats' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to fetch chats' },
      { status: 500 }
    )
  }
}
