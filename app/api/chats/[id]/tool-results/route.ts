// Chat Tool Results API: Add tool result messages to chat
// POST /api/chats/:id/tool-results - Add a tool result message

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { randomUUID } from 'node:crypto'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const toolResultSchema = z.object({
  tool: z.string(),
  initiatedBy: z.enum(['user', 'character']).default('user'),
  prompt: z.string().optional(),
  result: z.any().optional(),
  images: z.array(z.object({
    id: z.string(),
    filename: z.string(),
  })).optional(),
})

export async function POST(
  request: NextRequest,
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

    const chat = await repos.chats.findById(id)
    if (!chat || chat.userId !== user.id) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    const body = await request.json()
    const validated = toolResultSchema.parse(body)

    // Create a TOOL message event
    const toolResultMessage = await repos.chats.addMessage(id, {
      type: 'message',
      id: randomUUID(),
      role: 'TOOL',
      content: JSON.stringify({
        tool: validated.tool,
        initiatedBy: validated.initiatedBy,
        prompt: validated.prompt,
        result: validated.result,
        images: validated.images,
        success: validated.initiatedBy === 'user' ? true : validated.result?.success ?? false,
      }),
      createdAt: new Date().toISOString(),
      attachments: [],
    })

    return NextResponse.json({
      success: true,
      message: toolResultMessage,
    })
  } catch (error) {
    logger.error('Error adding tool result:', {}, error as Error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to add tool result' },
      { status: 500 }
    )
  }
}
