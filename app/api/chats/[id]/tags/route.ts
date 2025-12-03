// Chat Tags API: Manage tags for a specific chat
// GET /api/chats/[id]/tags - Get all tags for a chat
// POST /api/chats/[id]/tags - Add a tag to a chat
// DELETE /api/chats/[id]/tags?tagId=xxx - Remove a tag from a chat

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/json-store/repositories'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const addTagSchema = z.object({
  tagId: z.string().uuid(),
})

// GET /api/chats/[id]/tags - Get all tags for a chat
export async function GET(
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

    const chatId = id

    // Verify chat exists and belongs to user
    const chat = await repos.chats.findById(chatId)

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    if (chat.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Get tags for this chat
    const allTags = await repos.tags.findAll()
    const chatTags = allTags
      .filter(tag => chat.tags.includes(tag.id))
      .map(tag => ({
        id: tag.id,
        name: tag.name,
        createdAt: tag.createdAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({ tags: chatTags })
  } catch (error) {
    logger.error('Error fetching chat tags', { endpoint: '/api/chats/[id]/tags', method: 'GET' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to fetch chat tags' },
      { status: 500 }
    )
  }
}

// POST /api/chats/[id]/tags - Add a tag to a chat
export async function POST(
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

    const chatId = id

    // Verify chat exists and belongs to user
    const chat = await repos.chats.findById(chatId)

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    if (chat.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await req.json()
    const validatedData = addTagSchema.parse(body)

    // Verify tag exists and belongs to user
    const tag = await repos.tags.findById(validatedData.tagId)

    if (!tag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
    }

    if (tag.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Add tag to chat
    await repos.chats.addTag(chatId, validatedData.tagId)

    return NextResponse.json({ tag }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Error adding tag to chat', { endpoint: '/api/chats/[id]/tags', method: 'POST' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to add tag to chat' },
      { status: 500 }
    )
  }
}

// DELETE /api/chats/[id]/tags?tagId=xxx - Remove a tag from a chat
export async function DELETE(
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

    const chatId = id
    const tagId = req.nextUrl.searchParams.get('tagId')

    if (!tagId) {
      return NextResponse.json(
        { error: 'tagId query parameter is required' },
        { status: 400 }
      )
    }

    // Verify chat exists and belongs to user
    const chat = await repos.chats.findById(chatId)

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    if (chat.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Remove tag from chat
    await repos.chats.removeTag(chatId, tagId)

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error removing tag from chat', { endpoint: '/api/chats/[id]/tags', method: 'DELETE' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to remove tag from chat' },
      { status: 500 }
    )
  }
}
