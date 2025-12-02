/**
 * Chat Export API
 * GET /api/chats/:id/export - Export a chat in SillyTavern format
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { exportSTChat } from '@/lib/sillytavern/chat'
import { logger } from '@/lib/logger'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const repos = getRepositories()

    // Get chat
    const chat = await repos.chats.findById(id)

    if (!chat || chat.userId !== session.user.id) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Get messages (filter for message events only, not context-summary events)
    const allEvents = await repos.chats.getMessages(id)
    const messages = allEvents.filter(event => event.type === 'message')

    // Get character from participants
    const characterParticipant = chat.participants.find(p => p.type === 'CHARACTER' && p.characterId)
    if (!characterParticipant?.characterId) {
      return NextResponse.json({ error: 'No character in chat' }, { status: 404 })
    }

    const character = await repos.characters.findById(characterParticipant.characterId)
    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    // Get persona from participants if present
    const personaParticipant = chat.participants.find(p => p.type === 'PERSONA' && p.personaId)
    let persona = null
    if (personaParticipant?.personaId) {
      persona = await repos.personas.findById(personaParticipant.personaId)
    }

    // Export to SillyTavern format
    const userName = persona?.name || session.user.name || 'User'

    // Transform messages to the format expected by exportSTChat
    const formattedMessages = messages.map(msg => ({
      id: msg.id,
      chatId: id,
      role: msg.role,
      content: msg.content,
      createdAt: new Date(msg.createdAt),
      updatedAt: new Date(msg.createdAt),
      swipeGroupId: msg.swipeGroupId || null,
      swipeIndex: msg.swipeIndex || null,
      tokenCount: msg.tokenCount || null,
      rawResponse: msg.rawResponse || null,
    }))

    // Create a chat object compatible with exportSTChat
    const chatForExport = {
      ...chat,
      createdAt: new Date(chat.createdAt),
      updatedAt: new Date(chat.updatedAt),
    }

    const stChat = exportSTChat(chatForExport, formattedMessages, character.name, userName)

    // Return as JSON with download headers
    const chatCreatedTime = new Date(chat.createdAt).getTime()
    const filename = `${character.name}_chat_${chatCreatedTime}.jsonl`

    return new NextResponse(JSON.stringify(stChat, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    logger.error('Error exporting chat', { operation: 'chatExport' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to export chat' },
      { status: 500 }
    )
  }
}
