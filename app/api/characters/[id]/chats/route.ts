// Character Chats API: Get recent chats involving this character
// GET /api/characters/:id/chats - List recent chats with this character

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'

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

    // Verify character belongs to user
    const character = await repos.characters.findById(id)

    if (!character || character.userId !== user.id) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    // Get chats with this character
    const allChats = await repos.chats.findByCharacterId(id)

    // Filter by user and sort by updatedAt descending, take 10
    const userChats = allChats
      .filter((chat) => chat.userId === user.id)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 10)

    // Enrich chats with related data
    const enrichedChats = await Promise.all(
      userChats.map(async (chat) => {
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

        // Get last 3 messages for preview
        const allMessages = await repos.chats.getMessages(chat.id)
        const recentMessages = allMessages
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 3)
          .filter((msg) => msg.type === 'message')
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
        }
      })
    )

    return NextResponse.json({ chats: enrichedChats })
  } catch (error) {
    console.error('Error fetching character chats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch chats' },
      { status: 500 }
    )
  }
}
