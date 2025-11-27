// Memories API: List and Create for a Character
// GET /api/characters/[id]/memories - List all memories for a character
// POST /api/characters/[id]/memories - Create a new memory for a character

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { z } from 'zod'

// Validation schema for creating a memory
const createMemorySchema = z.object({
  content: z.string().min(1, 'Memory content is required'),
  summary: z.string().min(1, 'Memory summary is required'),
  keywords: z.array(z.string()).default([]),
  tags: z.array(z.string().uuid()).default([]),
  importance: z.number().min(0).max(1).default(0.5),
  personaId: z.string().uuid().nullable().optional(),
  chatId: z.string().uuid().nullable().optional(),
  source: z.enum(['AUTO', 'MANUAL']).default('MANUAL'),
  sourceMessageId: z.string().uuid().nullable().optional(),
})

// GET /api/characters/[id]/memories - List all memories for a character
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: characterId } = await params
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

    // Get query params for filtering
    const searchParams = req.nextUrl.searchParams
    const search = searchParams.get('search')
    const minImportance = searchParams.get('minImportance')
    const source = searchParams.get('source')
    const sortBy = searchParams.get('sortBy') || 'createdAt'
    const sortOrder = searchParams.get('sortOrder') || 'desc'

    // Get memories
    let memories = await repos.memories.findByCharacterId(characterId)

    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase()
      memories = memories.filter(memory =>
        memory.content.toLowerCase().includes(searchLower) ||
        memory.summary.toLowerCase().includes(searchLower) ||
        memory.keywords.some(k => k.toLowerCase().includes(searchLower))
      )
    }

    // Apply importance filter
    if (minImportance) {
      const minImp = parseFloat(minImportance)
      if (!isNaN(minImp)) {
        memories = memories.filter(m => m.importance >= minImp)
      }
    }

    // Apply source filter
    if (source && (source === 'AUTO' || source === 'MANUAL')) {
      memories = memories.filter(m => m.source === source)
    }

    // Sort memories
    memories.sort((a, b) => {
      let comparison = 0
      switch (sortBy) {
        case 'importance':
          comparison = a.importance - b.importance
          break
        case 'updatedAt':
          comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
          break
        case 'createdAt':
        default:
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          break
      }
      return sortOrder === 'desc' ? -comparison : comparison
    })

    // Enrich with tag names
    const allTags = await repos.tags.findAll()
    const tagMap = new Map(allTags.map(t => [t.id, t]))

    const memoriesWithTags = memories.map(memory => ({
      ...memory,
      tagDetails: memory.tags
        .map(tagId => tagMap.get(tagId))
        .filter(Boolean),
    }))

    return NextResponse.json({
      memories: memoriesWithTags,
      count: memoriesWithTags.length,
    })
  } catch (error) {
    console.error('Error fetching memories:', error)
    return NextResponse.json(
      { error: 'Failed to fetch memories' },
      { status: 500 }
    )
  }
}

// POST /api/characters/[id]/memories - Create a new memory
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: characterId } = await params
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

    const body = await req.json()
    const validatedData = createMemorySchema.parse(body)

    const memory = await repos.memories.create({
      characterId,
      ...validatedData,
    })

    return NextResponse.json({ memory }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error creating memory:', error)
    return NextResponse.json(
      { error: 'Failed to create memory' },
      { status: 500 }
    )
  }
}
