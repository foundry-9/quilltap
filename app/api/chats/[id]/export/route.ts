/**
 * Chat Export API
 * GET /api/chats/:id/export - Export a chat in SillyTavern format
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { exportSTChat } from '@/lib/sillytavern/chat'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get chat with messages
    const chat = await prisma.chat.findFirst({
      where: {
        id: params.id,
        userId: session.user.id,
      },
      include: {
        messages: {
          orderBy: {
            createdAt: 'asc',
          },
        },
        character: true,
        persona: true,
      },
    })

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Export to SillyTavern format
    const userName = chat.persona?.name || session.user.name || 'User'
    const stChat = exportSTChat(chat, chat.messages, chat.character.name, userName)

    // Return as JSON with download headers
    const filename = `${chat.character.name}_chat_${chat.createdAt.getTime()}.jsonl`

    return new NextResponse(JSON.stringify(stChat, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('Error exporting chat:', error)
    return NextResponse.json(
      { error: 'Failed to export chat' },
      { status: 500 }
    )
  }
}
