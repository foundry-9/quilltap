// Memories API: Get, Update, and Delete individual memory
// GET /api/characters/[id]/memories/[memoryId] - Get a specific memory
// PUT /api/characters/[id]/memories/[memoryId] - Update a memory
// DELETE /api/characters/[id]/memories/[memoryId] - Delete a memory

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { z } from 'zod'

// Validation schema for updating a memory
const updateMemorySchema = z.object({
  content: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  keywords: z.array(z.string()).optional(),
  tags: z.array(z.string().uuid()).optional(),
  importance: z.number().min(0).max(1).optional(),
  personaId: z.string().uuid().nullable().optional(),
  chatId: z.string().uuid().nullable().optional(),
})

// GET /api/characters/[id]/memories/[memoryId] - Get a specific memory
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; memoryId: string }> }
) {
  try {
    const { id: characterId, memoryId } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify character exists and belongs to user
    const character = await repos.characters.findById(characterId)
    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }
    if (character.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Get the memory
    const memory = await repos.memories.findByIdForCharacter(characterId, memoryId)
    if (!memory) {
      return NextResponse.json({ error: 'Memory not found' }, { status: 404 })
    }

    // Enrich with tag names
    const allTags = await repos.tags.findAll()
    const tagMap = new Map(allTags.map(t => [t.id, t]))

    const memoryWithTags = {
      ...memory,
      tagDetails: memory.tags
        .map(tagId => tagMap.get(tagId))
        .filter(Boolean),
    }

    // Update access time (fire and forget)
    repos.memories.updateAccessTime(characterId, memoryId).catch(console.error)

    return NextResponse.json({ memory: memoryWithTags })
  } catch (error) {
    console.error('Error fetching memory:', error)
    return NextResponse.json(
      { error: 'Failed to fetch memory' },
      { status: 500 }
    )
  }
}

// PUT /api/characters/[id]/memories/[memoryId] - Update a memory
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; memoryId: string }> }
) {
  try {
    const { id: characterId, memoryId } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify character exists and belongs to user
    const character = await repos.characters.findById(characterId)
    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }
    if (character.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Verify memory exists
    const existingMemory = await repos.memories.findByIdForCharacter(characterId, memoryId)
    if (!existingMemory) {
      return NextResponse.json({ error: 'Memory not found' }, { status: 404 })
    }

    const body = await req.json()
    const validatedData = updateMemorySchema.parse(body)

    const memory = await repos.memories.updateForCharacter(characterId, memoryId, validatedData)

    if (!memory) {
      return NextResponse.json({ error: 'Memory not found' }, { status: 404 })
    }

    return NextResponse.json({ memory })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error updating memory:', error)
    return NextResponse.json(
      { error: 'Failed to update memory' },
      { status: 500 }
    )
  }
}

// DELETE /api/characters/[id]/memories/[memoryId] - Delete a memory
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; memoryId: string }> }
) {
  try {
    const { id: characterId, memoryId } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify character exists and belongs to user
    const character = await repos.characters.findById(characterId)
    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }
    if (character.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Verify memory exists
    const existingMemory = await repos.memories.findByIdForCharacter(characterId, memoryId)
    if (!existingMemory) {
      return NextResponse.json({ error: 'Memory not found' }, { status: 404 })
    }

    await repos.memories.deleteForCharacter(characterId, memoryId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting memory:', error)
    return NextResponse.json(
      { error: 'Failed to delete memory' },
      { status: 500 }
    )
  }
}
